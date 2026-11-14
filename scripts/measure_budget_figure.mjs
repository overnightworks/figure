// Measures a synthetic figure at the profile's budgets: the test builder writes one with 60 000 triangles, textures filling the
// texel budget at the side budget, and as many morph targets on one mesh as the file budget leaves; the script refuses unless
// checkFigure passes it, mounts it in headless Chromium on a canvas 390 CSS pixels wide at a device scale factor of 2 (the
// highest ratio the package draws at) under the script policy of the browser layer, and reports the median and the 95th
// percentile of the frame interval over 300 frames, whether `slow` came, the WebGL renderer the browser used, and the GPU
// memory computed from what the figure uploads: its textures with their mip chains, its morph target data (three's float
// texture layout at the browser's largest texture size), its vertex buffers and its index buffers. The bone texture, the shader
// programs and the drawing buffer are not counted. `slow` ends a mount, so the frames come from as many mounts on fresh canvases
// as they take. A budget changes only on such a measurement.
// It then measures a persona's clip at the clip profile's budgets: the test builder writes a clip of every bone a clip owns, ten
// seconds long and filling the byte budget with keys, the script refuses unless checkClip passes it, and a conformant synthetic
// figure (the budget figure is slow on its own in this renderer) is mounted with it. The report gives the longest main-thread task
// after the mount (the parse), the frame interval without a clip and while the clip plays, whether `slow` came, and how many pixels
// the picture differs from the figure at rest once the figure's own wave would be over, which shows the clip plays.
// Last it measures a room at the room profile's budgets: the test builder writes one whose textures fill the texel budget at the
// side budget and whose triangle budget is spread over as many one-primitive meshes as the primitive budget allows (its file size is
// whatever those give, since the file budget has its own cases in the check's tests and stored image bytes add no parse work); the
// script refuses unless checkRoom passes it. The report gives the parse in the page through three's GLTFLoader with the package's
// refusing plugins (the time to parsed and the longest main-thread task after it began), what the parse built, and the room's computed
// GPU memory by part (its textures with their mip chains, its vertex and index buffers once for each mesh) alone and summed with the
// budget figure's. No room is drawn here, so its frame interval waits for the room loader.
// Usage: pnpm run build && node scripts/measure_budget_figure.mjs; needs `pnpm exec playwright install chromium` once.
// It runs itself through the fleet's probe-run, which starts it once the machine's load leaves room, inside a 4 GiB memory cap;
// a frame interval measured beside another browser proof is not the figure's own, so run it alone. It fetches nothing, serves
// the page by request routing, and writes the page's bundle only to a temporary directory that its outer process removes even
// when the capped one is killed (the figure stays in memory).
// Exit codes: 0 when the measurement ran (`slow` is a result, not a failure), 1 when the figure fails the check, no `drawn`
// came, fewer than 300 frames came, the browser failed or probe-run could not be started, 2 when dist/ is not built, and probe-run's
// own (`probe-run -h`) when it found no room within an hour.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'vite';
import { serveConsumer, origin } from '../tests/e2e/serve-consumer.ts';
import { buildBudgetVrm, buildConformantVrmGlb, buildGlb } from '../tests/glbBuilder.ts';
import { clipParts } from '../tests/clipBuilder.ts';
import { buildBudgetRoom } from '../tests/roomBuilder.ts';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), '..');
const guardedMarker = 'FIGURE_MEASURE_GUARDED';
const workDirectoryVariable = 'FIGURE_MEASURE_WORK_DIRECTORY';
const canvasCssWidth = 390;
const deviceScaleFactor = 2;
const frameCount = 300;
const endingSignals = ['unsupported', 'refused', 'lost', 'slow'];
/** The seconds after a gesture starts at which the figure's own wave is over and a clip of the budget's length still plays, and the seconds the parse is watched after the mount. */
const pictureSecondsAfterGesture = 4;
const parseWatchSeconds = 2;
/** The pixels a picture differs from the figure at rest, at least, for the clip to count as shown. */
const shownPixels = 500;
/** The keys' share of the byte budget that the clip's accessors fill, left to the JSON and the header the rest. */
const clipKeyBytes = { times: 4, rotation: 16 };
const rgbaBytesPerTexel = 4;
const morphTextureBytesPerTexel = 16;
const componentBytes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
const componentCounts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/**
 * Re-runs this script through probe-run and under the memory cap, unless it already runs inside them. The temporary directory
 * belongs to this process, which outlives the capped one: the cap's timeout or the kernel's memory kill ends the capped process
 * without a `finally`.
 */
function runGuarded() {
	const command = [
		'probe-run',
		'systemd-run', '--user', '--scope', '--quiet', '-p', 'MemoryMax=4G', '-p', 'MemorySwapMax=0',
		process.execPath, scriptPath
	];
	const workDirectory = mkdtempSync(join(tmpdir(), 'figure-budget-'));
	let status;
	let error;
	try {
		({ status, error } = spawnSync(command[0], command.slice(1), {
			stdio: 'inherit',
			env: { ...process.env, [guardedMarker]: '1', [workDirectoryVariable]: workDirectory }
		}));
	} finally {
		rmSync(workDirectory, { recursive: true, force: true });
	}
	if (error !== undefined) console.error(`cannot start ${command[0]}: ${error.message}`);
	process.exit(status ?? 1);
}

/** The JSON and the binary chunk of a GLB, read by the layout of glTF 2.0 section 4.4. */
function readGlb(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const jsonLength = view.getUint32(12, true);
	const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
	return { json, binary: bytes.subarray(20 + jsonLength + 8) };
}

function accessorBytes(json, accessorIndex) {
	const accessor = json.accessors[accessorIndex];
	return accessor.count * componentCounts[accessor.type] * componentBytes[accessor.componentType];
}

/** The texels of an image and of every smaller mip level down to one texel. */
function mipChainTexels(width, height) {
	let total = 0;
	for (let side = [width, height]; ; side = side.map((length) => Math.max(1, length >> 1))) {
		total += side[0] * side[1];
		if (side[0] === 1 && side[1] === 1) return total;
	}
}

/** The GPU memory of what the figure uploads, by part; `maxTextureSize` is the browser's, which shapes three's morph target texture. */
function gpuMemoryParts({ json, binary }, maxTextureSize) {
	const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
	const imageSizes = json.images.map((image) => {
		const header = json.bufferViews[image.bufferView].byteOffset + 16;
		return { width: view.getUint32(header), height: view.getUint32(header + 4) };
	});
	const primitives = json.meshes.flatMap((mesh) => mesh.primitives);
	const sum = (values) => values.reduce((total, value) => total + value, 0);
	const morphBytes = (primitive) => {
		const vertices = json.accessors[primitive.attributes.POSITION].count;
		const rows = Math.ceil(vertices / maxTextureSize);
		return Math.min(vertices, maxTextureSize) * rows * morphTextureBytesPerTexel * (primitive.targets?.length ?? 0);
	};
	return [
		{ part: 'textures with mip chains', bytes: sum(imageSizes.map(({ width, height }) => mipChainTexels(width, height) * rgbaBytesPerTexel)) },
		{ part: 'morph target data', bytes: sum(primitives.map(morphBytes)) },
		{ part: 'vertex buffers', bytes: sum(primitives.flatMap((primitive) => Object.values(primitive.attributes).map((accessor) => accessorBytes(json, accessor)))) },
		{ part: 'index buffers', bytes: sum(primitives.map((primitive) => accessorBytes(json, primitive.indices))) }
	];
}

/** A clip with a rotation track for every bone a clip owns, ten seconds long, whose keys fill the byte budget and which swings each bone about X. */
function buildBudgetClip(clipProfile, clipBones) {
	const jsonAllowanceBytes = 24 * 1024;
	const keyCount = Math.floor((clipProfile.fileBudgetBytes - jsonAllowanceBytes) / (clipBones.length * (clipKeyBytes.times + clipKeyBytes.rotation)));
	const tracks = clipBones.map((bone, index) => {
		const times = Array.from({ length: keyCount }, (_, key) => (key * clipProfile.maxSeconds) / (keyCount - 1));
		const rotations = times.map((seconds) => {
			const angle = 0.6 * Math.sin(2 * Math.PI * (0.5 + index / clipBones.length) * seconds);
			return [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
		});
		return { bone, times, rotations };
	});
	return { glb: buildGlb(clipParts(clipProfile, [tracks])), tracks: tracks.length, keyCount };
}

function percentile(sortedValues, fraction) {
	return sortedValues[Math.ceil(fraction * sortedValues.length) - 1];
}

const pageHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>budget figure</title></head>
<body><canvas id="figure"></canvas>
<script type="module" src="./main.js"></script></body></html>`;

/** The page's one function: reads the renderer, mounts the figure and records the frame intervals until `frames` came or the figure ended. */
const pageScript = `import { mount } from 'figure-draw';
import { GLTFLoader } from 'three-gltf-loader';
import { registerRefusingPlugins } from 'figure-loader';
const endingSignals = ['unsupported', 'refused', 'lost', 'slow'];

function describeRenderer() {
	const gl = document.createElement('canvas').getContext('webgl2');
	if (gl === null) return { renderer: 'no WebGL 2 context', maxTextureSize: 0 };
	const info = gl.getExtension('WEBGL_debug_renderer_info');
	const renderer = info === null ? gl.getParameter(gl.RENDERER) : gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
	const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
	gl.getExtension('WEBGL_lose_context')?.loseContext();
	return { renderer, maxTextureSize };
}

const maximumMounts = 30;

async function mountOnFreshCanvas(bytes, framesWanted, intervals) {
	const signals = [];
	const canvas = document.createElement('canvas');
	// The script policy blocks inline styles and stylesheets, so the host sizes its canvas through the CSSOM.
	Object.assign(canvas.style, { display: 'block', width: '${canvasCssWidth}px', height: '${canvasCssWidth}px' });
	document.body.append(canvas);
	const handle = await mount(canvas, bytes, { onSignal: (signal) => signals.push(signal) });
	await new Promise((resolve) => {
		let previous;
		const onFrame = (time) => {
			if (previous !== undefined) intervals.push(time - previous);
			previous = time;
			if (intervals.length >= framesWanted || signals.some((signal) => endingSignals.includes(signal))) resolve();
			else requestAnimationFrame(onFrame);
		};
		if (signals.includes('drawn')) requestAnimationFrame(onFrame);
		else resolve();
	});
	handle.dispose();
	const measuredCanvas = { clientWidth: canvas.clientWidth, bufferWidth: canvas.width };
	canvas.remove();
	return { signals, ...measuredCanvas };
}

/** Mounts the figure on a fresh canvas again and again, since a slow figure ends its mount, until enough frame intervals came. */
window.measureFigure = async (frames) => {
	const environment = describeRenderer();
	const bytes = new Uint8Array(await (await fetch('/figure.vrm')).arrayBuffer());
	document.body.style.margin = '0';
	const intervals = [];
	const mounts = [];
	while (intervals.length < frames && mounts.length < maximumMounts) {
		mounts.push(await mountOnFreshCanvas(bytes, frames, intervals));
		if (!mounts.at(-1).signals.includes('drawn')) break;
	}
	return { ...environment, mounts, intervals, devicePixelRatio: window.devicePixelRatio };
};
`;

/** The page's second function, appended to the first: it measures the clip against the same figure without one. */
const pageClipScript = `
function newCanvas() {
	const canvas = document.createElement('canvas');
	Object.assign(canvas.style, { display: 'block', width: '${canvasCssWidth}px', height: '${canvasCssWidth}px' });
	document.body.append(canvas);
	return canvas;
}

/** The next frame's time, after the figure's own frame has drawn: the figure asked for its frame first. */
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** A copy of the canvas's picture, taken in a frame callback, where the buffer still holds what the figure drew. */
function pictureOf(canvas) {
	const copy = new OffscreenCanvas(canvas.width, canvas.height);
	const context = copy.getContext('2d', { willReadFrequently: true });
	context.drawImage(canvas, 0, 0);
	return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

function differingPixels(first, second) {
	let differing = 0;
	for (let offset = 0; offset < first.length; offset += 4) {
		if ([0, 1, 2].some((channel) => Math.abs(first[offset + channel] - second[offset + channel]) > 32)) differing++;
	}
	return differing;
}

/** The intervals of the next \`frames\` frames, and what \`atSeconds\` into them the picture was. */
async function intervalsOf(canvas, frames, signals, pictureAtSeconds) {
	const intervals = [];
	let picture;
	let start;
	let previous = await nextFrame();
	start = previous;
	while (intervals.length < frames && !signals.some((signal) => endingSignals.includes(signal))) {
		const time = await nextFrame();
		intervals.push(time - previous);
		previous = time;
		if (picture === undefined && pictureAtSeconds !== undefined && time - start >= pictureAtSeconds * 1000) picture = pictureOf(canvas);
	}
	return { intervals, picture };
}

window.measureClip = async (frames, parseWatchSeconds, pictureSecondsAfterGesture) => {
	const figure = new Uint8Array(await (await fetch('/conformant.vrm')).arrayBuffer());
	const clip = new Uint8Array(await (await fetch('/budget.vrma')).arrayBuffer());
	document.body.style.margin = '0';
	const longTasks = [];
	new PerformanceObserver((list) => longTasks.push(...list.getEntries().map((entry) => entry.duration))).observe({ type: 'longtask' });

	const plainSignals = [];
	const plainCanvas = newCanvas();
	const plain = await mount(plainCanvas, figure, { onSignal: (signal) => plainSignals.push(signal) });
	const without = await intervalsOf(plainCanvas, frames, plainSignals);
	plain.dispose();
	plainCanvas.remove();

	const signals = [];
	const canvas = newCanvas();
	longTasks.length = 0;
	const handle = await mount(canvas, figure, { gestures: { wave: clip }, onSignal: (signal) => signals.push(signal) });
	await new Promise((resolve) => setTimeout(resolve, parseWatchSeconds * 1000));
	const parseLongestTask = Math.max(0, ...longTasks);
	await nextFrame();
	const resting = pictureOf(canvas);
	handle.gesture('wave');
	const withClip = await intervalsOf(canvas, frames, signals, pictureSecondsAfterGesture);
	const shownDifference = withClip.picture === undefined ? 0 : differingPixels(resting, withClip.picture);
	handle.dispose();
	canvas.remove();
	return { without: without.intervals, withClip: withClip.intervals, plainSignals, signals, parseLongestTask, shownDifference, pictureTaken: withClip.picture !== undefined };
};
`;

/** The page's third function, appended to the others: it parses the room as the package's loaders parse a file and reports what the parse built. */
const pageRoomScript = `
window.measureRoom = async (watchSeconds) => {
	const bytes = new Uint8Array(await (await fetch('/room.glb')).arrayBuffer());
	document.body.style.margin = '0';
	const longTasks = [];
	new PerformanceObserver((list) => longTasks.push(...list.getEntries().map((entry) => entry.duration))).observe({ type: 'longtask' });
	let textureFailed = false;
	const loader = new GLTFLoader();
	registerRefusingPlugins(loader, () => (textureFailed = true));
	const start = performance.now();
	const gltf = await loader.parseAsync(bytes.slice().buffer, '');
	const parsedMilliseconds = performance.now() - start;
	await new Promise((resolve) => setTimeout(resolve, watchSeconds * 1000));
	let meshes = 0;
	let triangles = 0;
	let unlitMeshes = 0;
	gltf.scene.traverse((object) => {
		if (!object.isMesh) return;
		meshes++;
		triangles += (object.geometry.index === null ? object.geometry.attributes.position.count : object.geometry.index.count) / 3;
		if (object.material.isMeshBasicMaterial) unlitMeshes++;
	});
	return { parsedMilliseconds, longestTask: Math.max(0, ...longTasks), textureFailed, meshes, triangles, unlitMeshes };
};
`;

async function bundlePage(workDirectory) {
	const pageDirectory = join(workDirectory, 'page');
	mkdirSync(pageDirectory);
	writeFileSync(join(pageDirectory, 'index.html'), pageHtml);
	writeFileSync(join(pageDirectory, 'main.js'), pageScript + pageClipScript + pageRoomScript);
	const bundleDirectory = join(workDirectory, 'bundle');
	await build({
		root: pageDirectory,
		configFile: false,
		logLevel: 'warn',
		resolve: {
			alias: {
				'figure-draw': join(repositoryRoot, 'dist/draw.js'),
				'figure-loader': join(repositoryRoot, 'dist/figureLoader.js'),
				'three-gltf-loader': join(repositoryRoot, 'node_modules/three/examples/jsm/loaders/GLTFLoader.js')
			}
		},
		build: { outDir: bundleDirectory, emptyOutDir: true }
	});
	return bundleDirectory;
}

async function measureInChromium(bundleDirectory, files, measureInPage) {
	const browser = await chromium.launch({ headless: true });
	try {
		const context = await browser.newContext({ viewport: { width: canvasCssWidth, height: 844 }, deviceScaleFactor });
		const page = await context.newPage();
		page.on('pageerror', (error) => console.error(`page error: ${error.message}`));
		await serveConsumer(page, bundleDirectory, files);
		await page.goto(`${origin}/`);
		return { chromium: browser.version(), ...(await measureInPage(page)) };
	} finally {
		await browser.close();
	}
}

const milliseconds = (value) => `${value.toFixed(1)} ms`;

/** The median, the 95th percentile and the longest of the frame intervals. */
function describeIntervals(intervals) {
	const sorted = [...intervals].sort((first, second) => first - second);
	return `median ${milliseconds(percentile(sorted, 0.5))}, 95th percentile ${milliseconds(percentile(sorted, 0.95))}, longest ${milliseconds(sorted.at(-1))} over ${sorted.length} frames`;
}

function megabytes(bytes) {
	return `${(bytes / 1e6).toFixed(1)} MB`;
}

function report(figure, fileBudgetBytes, measured, parts) {
	const slowMounts = measured.mounts.filter(({ signals }) => signals.includes('slow')).length;
	console.log(`figure: ${figure.morphTargets} morph targets on one mesh, file ${figure.glb.length} of ${fileBudgetBytes} bytes, check passes`);
	console.log(`browser: Chromium ${measured.chromium}, headless, canvas ${canvasCssWidth} CSS px wide, device scale factor ${deviceScaleFactor}, drawing buffer ${measured.mounts[0].bufferWidth} px wide`);
	console.log(`webgl renderer: ${measured.renderer}`);
	console.log(`mounts: ${measured.mounts.length}, drawn in all of them`);
	console.log(`slow came: ${slowMounts === 0 ? 'no' : 'yes'}, in ${slowMounts} of ${measured.mounts.length} mounts`);
	console.log(`frame interval: ${describeIntervals(measured.intervals)}`);
	reportGpuMemory(parts);
}

/** Prints each part and the total of a GPU memory computation, and returns the total. */
function reportGpuMemory(parts) {
	for (const { part, bytes } of parts) console.log(`gpu memory, ${part}: ${megabytes(bytes)} (${bytes} bytes)`);
	const total = parts.reduce((sum, { bytes }) => sum + bytes, 0);
	console.log(`gpu memory, total computed: ${megabytes(total)} (${total} bytes)`);
	return total;
}

function reportClip(clip, fileBudgetBytes, maxSeconds, measured) {
	console.log(`clip: ${clip.tracks} tracks of ${clip.keyCount} keys over ${maxSeconds} s, file ${clip.glb.length} of ${fileBudgetBytes} bytes, check passes`);
	console.log(`clip parse: longest main-thread task in the ${parseWatchSeconds} s after the mount ${milliseconds(measured.parseLongestTask)}`);
	console.log(`conformant figure without a clip, frame interval: ${describeIntervals(measured.without)}`);
	console.log(`conformant figure with the clip playing, frame interval: ${describeIntervals(measured.withClip)}`);
	console.log(`slow came: ${[...measured.plainSignals, ...measured.signals].includes('slow') ? 'yes' : 'no'}`);
	console.log(`picture ${pictureSecondsAfterGesture} s into the gesture differs from the figure at rest in ${measured.shownDifference} pixels (the figure's own wave is over by then)`);
}

async function main() {
	if (!existsSync(join(repositoryRoot, 'dist/draw.js'))) {
		console.error('dist/ is not built: run `pnpm run build` first');
		return 2;
	}
	const { figureProfile } = await import(join(repositoryRoot, 'dist/profile.js'));
	const { checkFigure } = await import(join(repositoryRoot, 'dist/check.js'));
	const figure = buildBudgetVrm(figureProfile, figureProfile);
	const refusals = checkFigure(figure.glb);
	if (refusals.length > 0) {
		console.error(`the budget figure fails the check: ${refusals.map(({ code }) => code).join(' ')}`);
		return 1;
	}
	const bundleDirectory = await bundlePage(process.env[workDirectoryVariable]);
	const measured = await measureInChromium(bundleDirectory, { '/figure.vrm': figure.glb }, (page) => page.evaluate((frames) => window.measureFigure(frames), frameCount));
	const failed = measured.mounts.find(({ signals, clientWidth }) => !signals.includes('drawn') || clientWidth !== canvasCssWidth);
	if (failed !== undefined) {
		console.error(`a mount was not drawn on a ${canvasCssWidth} px canvas: signals ${failed.signals.join(' ')}, canvas ${failed.clientWidth} px`);
		return 1;
	}
	if (measured.intervals.length < frameCount) {
		console.error(`only ${measured.intervals.length} of ${frameCount} frame intervals came in ${measured.mounts.length} mounts`);
		return 1;
	}
	const figureParts = gpuMemoryParts(readGlb(figure.glb), measured.maxTextureSize);
	report(figure, figureProfile.fileBudgetBytes, measured, figureParts);
	const clipStatus = await measureClip(bundleDirectory);
	if (clipStatus !== 0) return clipStatus;
	return measureRoom(bundleDirectory, figureParts.reduce((sum, { bytes }) => sum + bytes, 0), measured.maxTextureSize);
}

/** Measures the budget clip on the conformant figure; the bundle already holds the page's function. */
async function measureClip(bundleDirectory) {
	const { clipProfile, figureProfile } = await import(join(repositoryRoot, 'dist/profile.js'));
	const { checkClip } = await import(join(repositoryRoot, 'dist/check.js'));
	const { clipBones } = await import(join(repositoryRoot, 'dist/gestureClips.js'));
	const clip = buildBudgetClip(clipProfile, clipBones);
	const refusals = checkClip(clip.glb);
	if (refusals.length > 0) {
		console.error(`the budget clip fails the check: ${refusals.map(({ code }) => code).join(' ')}`);
		return 1;
	}
	const files = { '/conformant.vrm': buildConformantVrmGlb(figureProfile), '/budget.vrma': clip.glb };
	const measured = await measureInChromium(bundleDirectory, files, (page) =>
		page.evaluate(([frames, parseSeconds, pictureSeconds]) => window.measureClip(frames, parseSeconds, pictureSeconds), [frameCount, parseWatchSeconds, pictureSecondsAfterGesture])
	);
	reportClip(clip, clipProfile.fileBudgetBytes, clipProfile.maxSeconds, measured);
	const ended = [...measured.plainSignals, ...measured.signals].find((signal) => endingSignals.includes(signal));
	if (ended !== undefined || !measured.pictureTaken || measured.shownDifference < shownPixels) {
		console.error(`the clip was not measured playing: ended with ${ended ?? 'nothing'}, picture taken ${measured.pictureTaken}, ${measured.shownDifference} differing pixels`);
		return 1;
	}
	return 0;
}

/** Measures the budget room: the check must pass it, the page parses it, and its computed GPU memory is reported alone and summed with the budget figure's. */
async function measureRoom(bundleDirectory, figureGpuBytes, maxTextureSize) {
	const { roomProfile } = await import(join(repositoryRoot, 'dist/profile.js'));
	const { checkRoom } = await import(join(repositoryRoot, 'dist/check.js'));
	const room = buildBudgetRoom(roomProfile);
	const refusals = checkRoom(room.glb);
	if (refusals.length > 0) {
		console.error(`the budget room fails the check: ${refusals.map(({ code }) => code).join(' ')}`);
		return 1;
	}
	const measured = await measureInChromium(bundleDirectory, { '/room.glb': room.glb }, (page) => page.evaluate((seconds) => window.measureRoom(seconds), parseWatchSeconds));
	console.log(`room: ${room.meshes} meshes of one primitive and ${room.images} images, file ${room.glb.length} bytes (the file budget is ${roomProfile.fileBudgetBytes} and is not filled), check passes`);
	console.log(`room parse: time to parsed ${milliseconds(measured.parsedMilliseconds)}, longest main-thread task from the start to ${parseWatchSeconds} s after it ${milliseconds(measured.longestTask)}`);
	console.log(`room parsed into ${measured.meshes} meshes of ${measured.triangles} triangles, ${measured.unlitMeshes} with an unlit material`);
	const roomBytes = reportGpuMemory(gpuMemoryParts(readGlb(room.glb), maxTextureSize));
	const together = figureGpuBytes + roomBytes;
	console.log(`gpu memory, budget figure and budget room together: ${megabytes(together)} (${together} bytes)`);
	if (measured.textureFailed || measured.meshes !== room.meshes || measured.triangles !== roomProfile.maxTriangles || measured.unlitMeshes !== measured.meshes) {
		console.error(`the room was not parsed as built: texture failed ${measured.textureFailed}, ${measured.meshes} of ${room.meshes} meshes, ${measured.triangles} of ${roomProfile.maxTriangles} triangles, ${measured.unlitMeshes} unlit`);
		return 1;
	}
	return 0;
}

if (process.env[guardedMarker] === undefined) runGuarded();
process.exitCode = await main().catch((error) => {
	console.error(error);
	return 1;
});
