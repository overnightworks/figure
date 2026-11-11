// Measures a synthetic figure at the profile's budgets: the test builder writes one with 60 000 triangles, textures filling the
// texel budget at the side budget, and as many morph targets on one mesh as the file budget leaves; the script refuses unless
// checkFigure passes it, mounts it in headless Chromium on a canvas 390 CSS pixels wide at a device scale factor of 2 (the
// highest ratio the package draws at) under the script policy of the browser layer, and reports the median and the 95th
// percentile of the frame interval over 300 frames, whether `slow` came, the WebGL renderer the browser used, and the GPU
// memory computed from what the figure uploads: its textures with their mip chains, its morph target data (three's float
// texture layout at the browser's largest texture size), its vertex buffers and its index buffers. The bone texture, the shader
// programs and the drawing buffer are not counted. `slow` ends a mount, so the frames come from as many mounts on fresh canvases
// as they take. A budget changes only on such a measurement.
// Usage: pnpm run build && node scripts/measure_budget_figure.mjs; needs `pnpm exec playwright install chromium` once.
// It takes the machine's probe-stack lock and runs inside a 4 GiB memory cap on its own (a second wrapper would deadlock on
// the lock); it fetches nothing, serves the page by request routing, and writes the page's bundle only to a temporary
// directory that its outer process removes even when the capped one is killed (the figure stays in memory).
// Exit codes: 0 when the measurement ran (`slow` is a result, not a failure), 1 when the figure fails the check, no `drawn`
// came, fewer than 300 frames came or the browser failed, 2 when dist/ is not built.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'vite';
import { serveConsumer, origin } from '../tests/e2e/serve-consumer.ts';
import { buildBudgetVrm } from '../tests/glbBuilder.ts';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), '..');
const guardedMarker = 'FIGURE_MEASURE_GUARDED';
const workDirectoryVariable = 'FIGURE_MEASURE_WORK_DIRECTORY';
const canvasCssWidth = 390;
const deviceScaleFactor = 2;
const frameCount = 300;
const rgbaBytesPerTexel = 4;
const morphTextureBytesPerTexel = 16;
const componentBytes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
const componentCounts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/**
 * Re-runs this script under the probe-stack lock and the memory cap, unless it already runs inside them. The temporary directory
 * belongs to this process, which outlives the capped one: the cap's timeout or the kernel's memory kill ends the capped process
 * without a `finally`.
 */
function runGuarded() {
	const command = [
		'flock', '-o', '-w', '3600', '/tmp/probe-stack.lock',
		'setpriv', '--pdeathsig', 'TERM',
		'timeout', '-k', '30', '1800',
		'systemd-run', '--user', '--scope', '--quiet', '-p', 'MemoryMax=4G', '-p', 'MemorySwapMax=0',
		process.execPath, scriptPath
	];
	const workDirectory = mkdtempSync(join(tmpdir(), 'figure-budget-'));
	let status;
	try {
		({ status } = spawnSync(command[0], command.slice(1), {
			stdio: 'inherit',
			env: { ...process.env, [guardedMarker]: '1', [workDirectoryVariable]: workDirectory }
		}));
	} finally {
		rmSync(workDirectory, { recursive: true, force: true });
	}
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

function percentile(sortedValues, fraction) {
	return sortedValues[Math.ceil(fraction * sortedValues.length) - 1];
}

const pageHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>budget figure</title></head>
<body><canvas id="figure"></canvas>
<script type="module" src="./main.js"></script></body></html>`;

/** The page's one function: reads the renderer, mounts the figure and records the frame intervals until `frames` came or the figure ended. */
const pageScript = `import { mount } from 'figure-draw';
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

async function bundlePage(workDirectory) {
	const pageDirectory = join(workDirectory, 'page');
	mkdirSync(pageDirectory);
	writeFileSync(join(pageDirectory, 'index.html'), pageHtml);
	writeFileSync(join(pageDirectory, 'main.js'), pageScript);
	const bundleDirectory = join(workDirectory, 'bundle');
	await build({
		root: pageDirectory,
		configFile: false,
		logLevel: 'warn',
		resolve: { alias: { 'figure-draw': join(repositoryRoot, 'dist/draw.js') } },
		build: { outDir: bundleDirectory, emptyOutDir: true }
	});
	return bundleDirectory;
}

async function measureInChromium(bundleDirectory, figureBytes) {
	const browser = await chromium.launch({ headless: true });
	try {
		const context = await browser.newContext({ viewport: { width: canvasCssWidth, height: 844 }, deviceScaleFactor });
		const page = await context.newPage();
		page.on('pageerror', (error) => console.error(`page error: ${error.message}`));
		await serveConsumer(page, bundleDirectory, { '/figure.vrm': figureBytes });
		await page.goto(`${origin}/`);
		return { chromium: browser.version(), ...(await page.evaluate((frames) => window.measureFigure(frames), frameCount)) };
	} finally {
		await browser.close();
	}
}

function megabytes(bytes) {
	return `${(bytes / 1e6).toFixed(1)} MB`;
}

function report(figure, fileBudgetBytes, measured, parts) {
	const sorted = [...measured.intervals].sort((first, second) => first - second);
	const milliseconds = (value) => `${value.toFixed(1)} ms`;
	const slowMounts = measured.mounts.filter(({ signals }) => signals.includes('slow')).length;
	console.log(`figure: ${figure.morphTargets} morph targets on one mesh, file ${figure.glb.length} of ${fileBudgetBytes} bytes, check passes`);
	console.log(`browser: Chromium ${measured.chromium}, headless, canvas ${canvasCssWidth} CSS px wide, device scale factor ${deviceScaleFactor}, drawing buffer ${measured.mounts[0].bufferWidth} px wide`);
	console.log(`webgl renderer: ${measured.renderer}`);
	console.log(`mounts: ${measured.mounts.length}, drawn in all of them`);
	console.log(`slow came: ${slowMounts === 0 ? 'no' : 'yes'}, in ${slowMounts} of ${measured.mounts.length} mounts`);
	console.log(`frame interval over ${sorted.length} frames: median ${milliseconds(percentile(sorted, 0.5))}, 95th percentile ${milliseconds(percentile(sorted, 0.95))}, longest ${milliseconds(sorted.at(-1))}`);
	for (const { part, bytes } of parts) console.log(`gpu memory, ${part}: ${megabytes(bytes)} (${bytes} bytes)`);
	const total = parts.reduce((sum, { bytes }) => sum + bytes, 0);
	console.log(`gpu memory, total computed: ${megabytes(total)} (${total} bytes)`);
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
	const measured = await measureInChromium(bundleDirectory, figure.glb);
	const failed = measured.mounts.find(({ signals, clientWidth }) => !signals.includes('drawn') || clientWidth !== canvasCssWidth);
	if (failed !== undefined) {
		console.error(`a mount was not drawn on a ${canvasCssWidth} px canvas: signals ${failed.signals.join(' ')}, canvas ${failed.clientWidth} px`);
		return 1;
	}
	if (measured.intervals.length < frameCount) {
		console.error(`only ${measured.intervals.length} of ${frameCount} frame intervals came in ${measured.mounts.length} mounts`);
		return 1;
	}
	report(figure, figureProfile.fileBudgetBytes, measured, gpuMemoryParts(readGlb(figure.glb), measured.maxTextureSize));
	return 0;
}

if (process.env[guardedMarker] === undefined) runGuarded();
process.exitCode = await main().catch((error) => {
	console.error(error);
	return 1;
});
