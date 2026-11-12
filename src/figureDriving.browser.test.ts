import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cdp } from 'vitest/browser';
import { buildConformantVrm, buildVrmGlbWithImages } from '../tests/figureFixtures.js';
import { buildFigureTexturePng } from '../tests/glbBuilder.js';
import { centreOf, coversSomething, emulateReducedMotion, readPixels, spotsOf, type FaceFeature, type Spot } from '../tests/browserCanvas.js';
import { mount, type FigureHandle } from './draw.js';
import { figureSignal } from './signals.js';

/** The page's own frame request, which the tests wait on without the watcher counting it. */
const requestFrameOwn = window.requestAnimationFrame;

/** How far the nose has to move to the side or up, in pixels at a canvas 200 wide, for a test to call it turned, and how near its resting place it has to be to call it back. */
const turnedPixels = { side: 10, up: 4 };
const backPixels = 4;
/** A lowered arm hangs from its shoulder, so its pixels run this far down at 200 px wide; a T-pose arm is only as thick as its bone, about 30 px. */
const armHangPixels = 60;
/** The frames after which a spring-bone sleeve has settled into its rest shape. */
const settlingFrames = 60;
/** How many of a figure's first drawn frames the sleeve test compares with the settled one. */
const earlyFrames = 3;
/** A nod lifts the nose about 7 px at a canvas 200 wide and brings it back within a few pictures: the test asks for a dip and a return of `nodPixels` each, the return within `nodReturnSamples` pictures. */
const nodPixels = 3;
const nodTraceSamples = 60;
const nodReturnSamples = 20;
/** The pictures a listening figure takes to reach its pose under reduced motion, after which its nose holds still. */
const settledFromSample = 2;

/** A canvas's drawing buffer as it was read, with its size. */
interface Picture {
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array;
}

describe('a figure driven by the host', () => {
	const canvases: HTMLCanvasElement[] = [];
	const handles: FigureHandle[] = [];
	const speakers: HTMLElement[] = [];
	const iframes: HTMLIFrameElement[] = [];
	/** What each watched canvas held when the figure drew it for the first `earlyFrames` times. */
	const shownEarly = new Map<HTMLCanvasElement, Picture[]>();
	/** What each watched canvas held when the figure last drew it, read in the frame's own task, where the buffer still holds the picture. */
	const shown = new Map<HTMLCanvasElement, Picture>();
	let frames = 0;
	/** The canvas whose next drawn picture a test waits for, and that picture once the figure drew it. */
	let firstFrameWaited: { canvas: HTMLCanvasElement; picture?: Picture } | undefined;

	beforeEach(() => {
		frames = 0;
		firstFrameWaited = undefined;
		shown.clear();
		shownEarly.clear();
		// A seeded source of chance keeps the idle glance and the blink the same in every run.
		vi.spyOn(Math, 'random').mockImplementation(seededRandom(7));
		window.requestAnimationFrame = (callback) =>
			requestFrameOwn.call(window, (time) => {
				callback(time);
				frames++;
				canvases.forEach(readIfDrawn);
			});
	});

	afterEach(async () => {
		window.requestAnimationFrame = requestFrameOwn;
		vi.restoreAllMocks();
		handles.splice(0).forEach((handle) => handle.dispose());
		canvases.splice(0).forEach((canvas) => canvas.remove());
		speakers.splice(0).forEach((speaker) => speaker.remove());
		iframes.splice(0).forEach((frame) => frame.remove());
		await cdp().send('Emulation.setEmulatedMedia', { features: [] });
	});

	/** Keeps the canvas's picture if a frame drew it just now; a canvas whose figure has not drawn this frame holds nothing. */
	function readIfDrawn(canvas: HTMLCanvasElement): void {
		const pixels = readPixels(canvas);
		if (!coversSomething(pixels)) return;
		const picture = { width: canvas.width, height: canvas.height, pixels };
		shown.set(canvas, picture);
		if (firstFrameWaited?.canvas === canvas) firstFrameWaited.picture ??= picture;
		const early = shownEarly.get(canvas) ?? [];
		if (early.length < earlyFrames) shownEarly.set(canvas, [...early, picture]);
	}

	async function mountFigure(bytes: Uint8Array = buildConformantVrm()): Promise<{ canvas: HTMLCanvasElement; handle: FigureHandle }> {
		const canvas = document.createElement('canvas');
		canvas.style.width = '200px';
		canvas.style.height = '250px';
		document.body.append(canvas);
		canvases.push(canvas);
		const handle = await mount(canvas, bytes);
		// The figure draws once before `mount` returns; the buffer still holds that first frame in the task that drew it.
		readIfDrawn(canvas);
		handles.push(handle);
		return { canvas, handle };
	}

	/** The features as the latest frame of `canvas` shows them, once the figure has drawn after `afterFrame`. */
	async function featuresAfter(canvas: HTMLCanvasElement, afterFrame: number): Promise<Record<FaceFeature, Spot[]>> {
		await vi.waitFor(() => expect(frames).toBeGreaterThan(afterFrame), { timeout: 5000 });
		await vi.waitFor(() => expect(shown.get(canvas)).toBeDefined());
		const { pixels, width, height } = shown.get(canvas)!;
		return spotsOf(pixels, width, height);
	}

	/** The nose as the latest frame of `canvas` shows it, once the figure has drawn after `afterFrame`. */
	async function noseAfter(canvas: HTMLCanvasElement, afterFrame: number): Promise<Spot> {
		const nose = centreOf((await featuresAfter(canvas, afterFrame)).nose);
		if (nose.count === 0) throw new Error('the nose is not on the canvas');
		return nose;
	}

	/** The arms as the latest frame of `canvas` shows them. */
	async function armsNow(canvas: HTMLCanvasElement): Promise<Spot[]> {
		return (await featuresAfter(canvas, frames + 2)).arm;
	}

	/** The arms hang at the figure's sides below the nose: on both sides of it, their middle below it, and their pixels running down far enough. */
	function expectArmsLowered(arms: Spot[], nose: Spot): void {
		const lowest = Math.max(...arms.map((spot) => spot.y));
		const highest = Math.min(...arms.map((spot) => spot.y));
		expect(arms.length).toBeGreaterThan(0);
		expect(arms.some((spot) => spot.x < nose.x)).toBe(true);
		expect(arms.some((spot) => spot.x > nose.x)).toBe(true);
		expect(centreOf(arms).y).toBeGreaterThan(nose.y);
		expect(lowest - highest).toBeGreaterThan(armHangPixels);
	}

	it.each([
		['the synthetic figure', undefined],
		['a figure without shoulder bones', (json: Record<string, any>) => {
			delete json.extensions.VRMC_vrm.humanoid.humanBones.leftShoulder;
			delete json.extensions.VRMC_vrm.humanoid.humanBones.rightShoulder;
		}],
		['a figure without spring bones', (json: Record<string, any>) => {
			delete json.extensions.VRMC_springBone;
			json.extensionsUsed = json.extensionsUsed.filter((extension: string) => extension !== 'VRMC_springBone');
		}]
	])('hangs the arms lowered beside the body on %s', async (_, change) => {
		const bytes = change === undefined ? buildConformantVrm() : buildVrmGlbWithImages([buildFigureTexturePng()], change);
		const { canvas } = await mountFigure(bytes);
		const nose = await noseNow(canvas);

		expectArmsLowered(await armsNow(canvas), nose);
	});

	it('holds the arms down under reduced motion from the first frame', async () => {
		await emulateReducedMotion();
		const { canvas } = await mountFigure();
		await vi.waitFor(() => expect(shown.get(canvas)).toBeDefined());
		const nose = await noseNow(canvas);

		expectArmsLowered(await armsNow(canvas), nose);
	});

	it('draws the sleeves in their first frames where they rest after settling, under reduced motion', async () => {
		await emulateReducedMotion();
		const { canvas } = await mountFigure();
		await vi.waitFor(() => expect(shownEarly.get(canvas)).toHaveLength(earlyFrames));
		const early = shownEarly.get(canvas)!.map(({ pixels, width, height }) => spotsOf(pixels, width, height).sleeve);
		const settled = (await featuresAfter(canvas, frames + settlingFrames)).sleeve;

		expect(settled.length).toBeGreaterThan(0);
		early.forEach((sleeve) => expect(sleeve).toEqual(settled));
	});

	async function noseNow(canvas: HTMLCanvasElement): Promise<Spot> {
		return noseAfter(canvas, frames + 2);
	}

	/** The nose's height in each of the next `count` pictures `canvas` shows, read in turn. */
	async function noseTrace(canvas: HTMLCanvasElement, count: number): Promise<number[]> {
		const trace: number[] = [];
		for (let sample = 0; sample < count; sample++) trace.push((await noseNow(canvas)).y);
		return trace;
	}

	/** A speaker whose centre lies on the canvas's centre, so the gaze rests straight ahead and what moves the nose is the nod. */
	function speakerOnCentre(canvas: HTMLCanvasElement): HTMLElement {
		const box = canvas.getBoundingClientRect();
		return speakerAt(box.left + box.width / 2 - 10, box.top + box.height / 2 - 10);
	}

	/** The nose in the first picture `canvas` shows after `act` ran, which is the frame the figure draws next. */
	async function firstFrameAfter(canvas: HTMLCanvasElement, act: () => void): Promise<Spot> {
		const awaited: { canvas: HTMLCanvasElement; picture?: Picture } = { canvas };
		firstFrameWaited = awaited;
		act();
		await vi.waitFor(() => expect(awaited.picture).toBeDefined(), { timeout: 5000 });
		const { pixels, width, height } = awaited.picture!;
		return centreOf(spotsOf(pixels, width, height).nose);
	}

	it('turns toward the side and up on think(true) and comes back on think(false)', async () => {
		const { canvas, handle } = await mountFigure();
		const resting = await noseNow(canvas);

		handle.think(true);
		await vi.waitFor(async () => {
			const nose = await noseNow(canvas);
			expect(nose.x).toBeLessThan(resting.x - turnedPixels.side);
			expect(nose.y).toBeLessThan(resting.y - turnedPixels.up);
		}, { timeout: 10000 });

		handle.think(false);
		await vi.waitFor(async () => {
			const nose = await noseNow(canvas);
			expect(Math.abs(nose.x - resting.x)).toBeLessThan(backPixels);
			expect(Math.abs(nose.y - resting.y)).toBeLessThan(backPixels);
		}, { timeout: 10000 });
	});

	it('shows the thinking look at the next frame under reduced motion, and leaves it at the next frame', async () => {
		await emulateReducedMotion();
		const { canvas, handle } = await mountFigure();
		const resting = await noseNow(canvas);

		handle.think(true);
		const thinking = await noseNow(canvas);
		handle.think(true);
		const held = await noseNow(canvas);
		handle.think(false);
		const left = await noseNow(canvas);

		expect(thinking.x).toBeLessThan(resting.x - turnedPixels.side);
		expect(thinking.y).toBeLessThan(resting.y - turnedPixels.up);
		expect(held).toEqual(thinking);
		expect(left).toEqual(resting);
	});

	it('turns a figure that has no neck and no chest as well', async () => {
		await emulateReducedMotion();
		const bytes = buildVrmGlbWithImages([buildFigureTexturePng()], (json) => {
			delete json.extensions.VRMC_vrm.humanoid.humanBones.neck;
			delete json.extensions.VRMC_vrm.humanoid.humanBones.chest;
		});
		const { canvas, handle } = await mountFigure(bytes);
		const resting = await noseNow(canvas);

		handle.think(true);
		const thinking = await noseNow(canvas);

		expect(handle.signal).toBe(figureSignal.drawn);
		expect(thinking.x).toBeLessThan(resting.x - turnedPixels.side);
	});

	/** Puts a small element of the page at `x` and `y` CSS pixels from the viewport's top left, in the page's body or detached when `attach` is false. */
	function speakerAt(x: number, y: number, attach = true): HTMLElement {
		const speaker = document.createElement('div');
		speaker.style.cssText = `position: fixed; left: ${x}px; top: ${y}px; width: 20px; height: 20px`;
		if (attach) document.body.append(speaker);
		speakers.push(speaker);
		return speaker;
	}

	/** Far enough to either side of the canvas that the gaze is at its full reach. */
	const farLeft = -5000;
	const farRight = 5000;
	const level = 100;

	it.each([
		['left', farLeft, -1],
		['right', farRight, 1]
	])('turns the nose toward a speaker on the %s, and back when nobody speaks', async (_, x, side) => {
		const { canvas, handle } = await mountFigure();
		const resting = await noseNow(canvas);

		handle.listen(speakerAt(x, level));
		await vi.waitFor(async () => expect(((await noseNow(canvas)).x - resting.x) * side).toBeGreaterThan(turnedPixels.side), { timeout: 10000 });

		handle.listen(null);
		await vi.waitFor(async () => expect(Math.abs((await noseNow(canvas)).x - resting.x)).toBeLessThan(backPixels), { timeout: 10000 });
	});

	it('follows an element that moves, with no call', async () => {
		const { canvas, handle } = await mountFigure();
		const resting = await noseNow(canvas);
		const speaker = speakerAt(farLeft, level);
		handle.listen(speaker);
		await vi.waitFor(async () => expect((await noseNow(canvas)).x).toBeLessThan(resting.x - turnedPixels.side), { timeout: 10000 });

		speaker.style.left = `${farRight}px`;

		await vi.waitFor(async () => expect((await noseNow(canvas)).x).toBeGreaterThan(resting.x + turnedPixels.side), { timeout: 10000 });
	});

	it('turns toward a speaker above and looks up at the next frame under reduced motion', async () => {
		await emulateReducedMotion();
		const { canvas, handle } = await mountFigure();
		const resting = await noseNow(canvas);

		handle.listen(speakerAt(canvas.getBoundingClientRect().left, -5000));
		const listening = await noseNow(canvas);

		expect(listening.y).toBeLessThan(resting.y - turnedPixels.up);
	});

	it('turns at the first frame after the call under reduced motion, follows a moved speaker at its first frame, and a repeated call changes nothing', async () => {
		await emulateReducedMotion();
		const { canvas, handle } = await mountFigure();
		const resting = await noseNow(canvas);
		const speaker = speakerAt(farLeft, level);

		const listening = await firstFrameAfter(canvas, () => handle.listen(speaker));
		const moved = await firstFrameAfter(canvas, () => (speaker.style.left = `${farRight}px`));
		handle.listen(speaker);
		const repeated = await noseNow(canvas);

		expect(listening.x).toBeLessThan(resting.x - turnedPixels.side);
		expect(moved.x).toBeGreaterThan(resting.x + turnedPixels.side);
		expect(repeated).toEqual(moved);
	});

	it('counts a detached element and one of another document as nobody, and follows each once it returns', async () => {
		await emulateReducedMotion();
		const { canvas, handle } = await mountFigure();
		const resting = await noseNow(canvas);
		const detached = speakerAt(farLeft, level, false);
		const foreign = document.implementation.createHTMLDocument('another').createElement('div');
		foreign.style.cssText = `position: fixed; left: ${farRight}px; top: ${level}px; width: 20px; height: 20px`;
		foreign.ownerDocument.body.append(foreign);
		speakers.push(foreign);

		handle.listen(detached);
		expect(await noseNow(canvas)).toEqual(resting);
		document.body.append(detached);
		expect((await noseNow(canvas)).x).toBeLessThan(resting.x - turnedPixels.side);
		detached.remove();
		expect(await noseNow(canvas)).toEqual(resting);

		handle.listen(foreign);
		expect(await noseNow(canvas)).toEqual(resting);
		document.body.append(foreign);
		expect((await noseNow(canvas)).x).toBeGreaterThan(resting.x + turnedPixels.side);
	});

	/** A speaker at the far left, and the two means of taking its box away and giving it back: its own `display`, or that of an ancestor it sits in. */
	const boxlessSpeakers = [
		['display: none', () => {
			const speaker = speakerAt(farLeft, level);
			return { speaker, hide: () => { speaker.style.display = 'none'; }, show: () => { speaker.style.display = ''; } };
		}],
		['a hidden ancestor', () => {
			const speaker = speakerAt(farLeft, level);
			const ancestor = document.createElement('section');
			document.body.append(ancestor);
			ancestor.append(speaker);
			speakers.push(ancestor);
			return { speaker, hide: () => { ancestor.style.display = 'none'; }, show: () => { ancestor.style.display = ''; } };
		}]
	] as const;
	const motions = [
		['normal motion', false],
		['reduced motion', true]
	] as const;

	/** The nose once the figure has had time to settle: at the next frame under reduced motion, a second of frames later otherwise. */
	async function noseSettled(canvas: HTMLCanvasElement, reduced: boolean): Promise<Spot> {
		return reduced ? noseNow(canvas) : noseAfter(canvas, frames + settlingFrames);
	}

	describe.each(boxlessSpeakers)('a speaker made boxless by %s', (_, makeSpeaker) => {
		it.each(motions)('counts it as nobody and follows it once it has a box, with no call, in %s', async (__, reduced) => {
			if (reduced) await emulateReducedMotion();
			const { canvas, handle } = await mountFigure();
			const resting = await noseNow(canvas);
			const { speaker, hide, show } = makeSpeaker();
			hide();

			handle.listen(speaker);
			expect(Math.abs((await noseSettled(canvas, reduced)).x - resting.x)).toBeLessThan(backPixels);
			show();
			await vi.waitFor(async () => expect((await noseNow(canvas)).x).toBeLessThan(resting.x - turnedPixels.side), { timeout: 10000 });
		});

		it.each(motions)('lets a figure that listens go idle when the box goes, in %s', async (__, reduced) => {
			if (reduced) await emulateReducedMotion();
			const { canvas, handle } = await mountFigure();
			const resting = await noseNow(canvas);
			const { speaker, hide } = makeSpeaker();
			handle.listen(speaker);
			await vi.waitFor(async () => expect((await noseNow(canvas)).x).toBeLessThan(resting.x - turnedPixels.side), { timeout: 10000 });

			hide();

			expect(Math.abs((await noseSettled(canvas, reduced)).x - resting.x)).toBeLessThan(backPixels);
		});

		it('keeps the thinking look over a boxless speaker, goes idle when the thinking ends, and turns to it once the box is back', async () => {
			await emulateReducedMotion();
			const { canvas, handle } = await mountFigure();
			const resting = await noseNow(canvas);
			const { speaker, hide, show } = makeSpeaker();
			hide();
			handle.think(true);
			const thinking = await noseNow(canvas);

			handle.listen(speaker);
			expect(await noseNow(canvas)).toEqual(thinking);
			handle.think(false);
			expect(await noseNow(canvas)).toEqual(resting);
			show();

			expect((await noseNow(canvas)).x).toBeLessThan(resting.x - turnedPixels.side);
		});
	});

	it.each(motions)('keeps an element that has a box a speaker, also with visibility hidden, one side empty or one pixel, in %s', async (_, reduced) => {
		if (reduced) await emulateReducedMotion();
		const { canvas, handle } = await mountFigure();
		const resting = await noseNow(canvas);

		for (const style of ['visibility: hidden', 'width: 0', 'height: 0', 'width: 1px; height: 1px']) {
			const speaker = speakerAt(farLeft, level);
			speaker.style.cssText += `; ${style}`;
			handle.listen(speaker);
			await vi.waitFor(async () => expect((await noseNow(canvas)).x).toBeLessThan(resting.x - turnedPixels.side), { timeout: 10000 });
			handle.listen(null);
			await vi.waitFor(async () => expect(Math.abs((await noseNow(canvas)).x - resting.x)).toBeLessThan(backPixels), { timeout: 10000 });
		}
	});

	it.each([
		['across', new DOMRect(Number.NaN, 0, 200, 250)],
		['down', new DOMRect(0, Number.POSITIVE_INFINITY, 200, 250)]
	])('counts a speaker as nobody while the canvas gives no finite %s, and follows it once the canvas does', async (_, canvasRectangle) => {
		await emulateReducedMotion();
		const { canvas, handle } = await mountFigure();
		const resting = await noseNow(canvas);
		const rectangle = vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(canvasRectangle);

		handle.listen(speakerAt(farLeft, level));
		expect(await noseNow(canvas)).toEqual(resting);
		rectangle.mockRestore();

		expect((await noseNow(canvas)).x).toBeLessThan(resting.x - turnedPixels.side);
	});

	it('follows an element made by an iframe once it is moved into the canvas\'s document, with no call', async () => {
		await emulateReducedMotion();
		const { canvas, handle } = await mountFigure();
		const resting = await noseNow(canvas);
		const frame = document.createElement('iframe');
		document.body.append(frame);
		iframes.push(frame);
		const foreign = frame.contentDocument!.createElement('div');
		foreign.style.cssText = `position: fixed; left: ${farLeft}px; top: ${level}px; width: 20px; height: 20px`;
		frame.contentDocument!.body.append(foreign);
		speakers.push(foreign);

		expect(foreign).not.toBeInstanceOf(Element);
		handle.listen(foreign);
		expect(await noseNow(canvas)).toEqual(resting);
		document.body.append(foreign);

		expect((await noseNow(canvas)).x).toBeLessThan(resting.x - turnedPixels.side);
	});

	it('shows the thinking look over a speaker, and the speaker once the thinking ends', async () => {
		await emulateReducedMotion();
		const { canvas, handle } = await mountFigure();
		const resting = await noseNow(canvas);
		handle.think(true);
		const thinking = await noseNow(canvas);

		handle.listen(speakerAt(farRight, level));
		const whileThinking = await noseNow(canvas);
		handle.think(false);
		const after = await noseNow(canvas);

		expect(whileThinking).toEqual(thinking);
		expect(after.x).toBeGreaterThan(resting.x + turnedPixels.side);
	});

	it('turns a figure that has no neck and no chest toward a speaker as well', async () => {
		await emulateReducedMotion();
		const bytes = buildVrmGlbWithImages([buildFigureTexturePng()], (json) => {
			delete json.extensions.VRMC_vrm.humanoid.humanBones.neck;
			delete json.extensions.VRMC_vrm.humanoid.humanBones.chest;
		});
		const { canvas, handle } = await mountFigure(bytes);
		const resting = await noseNow(canvas);

		handle.listen(speakerAt(farLeft, level));

		expect((await noseNow(canvas)).x).toBeLessThan(resting.x - turnedPixels.side);
	});

	it.each([
		['undefined', undefined],
		['a string', 'speaker'],
		['a plain object', { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }) }],
		['the document', document],
		['a proxy that throws when judged', new Proxy({}, { getPrototypeOf: () => { throw new Error('refused'); } })],
		['a proxy of an element, whose reads are refused', new Proxy(document.createElement('div'), {})],
		['an object that only inherits from Element', Object.create(Element.prototype)],
		['a plain object that reports being a connected element of the document', { nodeType: 1, isConnected: true, ownerDocument: document, getBoundingClientRect: () => ({ left: -5000, top: 100, width: 20, height: 20 }) }],
		['a plain object that reports an empty rectangle', { nodeType: 1, isConnected: true, ownerDocument: document, getBoundingClientRect: () => ({}) }]
	])('throws nothing for %s, counts it as nobody and goes on drawing', async (_, speaker) => {
		await emulateReducedMotion();
		const { canvas, handle } = await mountFigure();
		const resting = await noseNow(canvas);

		expect(() => handle.listen(speaker as Element)).not.toThrow();

		expect(await noseNow(canvas)).toEqual(resting);
		expect(handle.signal).toBe(figureSignal.drawn);
	});

	it('does nothing on a disposed figure and throws nothing when told of a speaker', async () => {
		const { canvas, handle } = await mountFigure();
		await noseNow(canvas);
		handle.dispose();
		const framesAtDispose = frames;

		expect(() => handle.listen(speakerAt(farLeft, level))).not.toThrow();
		await nextFrame();
		await nextFrame();

		expect(frames).toBe(framesAtDispose);
	});

	it.each([
		['refused', new Uint8Array([1, 2, 3])],
		['lost', undefined]
	])('does nothing on a figure that ended with %s when told of a speaker', async (ending, bytes) => {
		const { canvas, handle } = await mountFigure(bytes);
		if (ending === figureSignal.lost) {
			await noseNow(canvas);
			canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext();
			await vi.waitFor(() => expect(handle.signal).toBe(figureSignal.lost));
		}
		const framesAtEnd = frames;

		expect(() => handle.listen(speakerAt(farLeft, level))).not.toThrow();
		expect(() => handle.listen(null)).not.toThrow();
		await nextFrame();
		await nextFrame();

		expect(handle.signal).toBe(ending);
		expect(frames).toBe(framesAtEnd);
	});

	it('moves only the figure it was called on when two figures are drawn', async () => {
		await emulateReducedMotion();
		const first = await mountFigure();
		const second = await mountFigure();
		const firstResting = await noseNow(first.canvas);
		const secondResting = await noseNow(second.canvas);

		first.handle.think(true);
		const firstThinking = await noseNow(first.canvas);
		const secondAfter = await noseNow(second.canvas);

		expect(firstThinking.x).toBeLessThan(firstResting.x - turnedPixels.side);
		expect(secondAfter).toEqual(secondResting);

		second.handle.think(true);
		first.handle.think(false);
		expect(await noseNow(first.canvas)).toEqual(firstResting);
		expect((await noseNow(second.canvas)).x).toBeLessThan(secondResting.x - turnedPixels.side);
	});

	it('does nothing on a disposed figure and throws nothing', async () => {
		const { canvas, handle } = await mountFigure();
		await noseNow(canvas);
		handle.dispose();
		const framesAtDispose = frames;

		expect(() => handle.think(true)).not.toThrow();
		await nextFrame();
		await nextFrame();

		expect(frames).toBe(framesAtDispose);
	});

	it.each([
		['refused', new Uint8Array([1, 2, 3])],
		['lost', undefined]
	])('does nothing on a figure that ended with %s and throws nothing', async (ending, bytes) => {
		const { canvas, handle } = await mountFigure(bytes);
		if (ending === figureSignal.lost) {
			await noseNow(canvas);
			canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext();
			await vi.waitFor(() => expect(handle.signal).toBe(figureSignal.lost));
		}
		const framesAtEnd = frames;

		expect(() => handle.think(true)).not.toThrow();
		expect(() => handle.think(false)).not.toThrow();
		await nextFrame();
		await nextFrame();

		expect(handle.signal).toBe(ending);
		expect(frames).toBe(framesAtEnd);
	});

	it('nods while a speaker is set: the nose dips and comes back within a nod', async () => {
		const { canvas, handle } = await mountFigure();
		handle.listen(speakerOnCentre(canvas));
		const trace = await noseTrace(canvas, nodTraceSamples);

		const peak = trace.indexOf(Math.max(...trace));
		expect(trace[peak]! - trace[0]!).toBeGreaterThanOrEqual(nodPixels);
		expect(trace[peak]! - Math.min(...trace.slice(peak, peak + nodReturnSamples))).toBeGreaterThanOrEqual(nodPixels);
	});

	it('does not nod under reduced motion, with no speaker or with one', async () => {
		await emulateReducedMotion();
		const { canvas, handle } = await mountFigure();
		const resting = await noseTrace(canvas, nodTraceSamples);
		handle.listen(speakerOnCentre(canvas));
		const listening = await noseTrace(canvas, nodTraceSamples);

		expect(Math.max(...resting) - Math.min(...resting)).toBeLessThan(0.5);
		expect(Math.max(...listening.slice(settledFromSample)) - Math.min(...listening.slice(settledFromSample))).toBeLessThan(0.5);
	});
});

/** A small seeded source of numbers in [0, 1) (mulberry32). */
function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
	};
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestFrameOwn.call(window, () => resolve()));
}
