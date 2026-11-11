import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cdp } from 'vitest/browser';
import { buildConformantVrm, buildVrmGlbWithImages } from '../tests/figureFixtures.js';
import { buildFigureTexturePng } from '../tests/glbBuilder.js';
import { mount, type FigureHandle } from './draw.js';
import { figureSignal } from './signals.js';

/** The page's own frame request, which the tests wait on without the watcher counting it. */
const requestFrameOwn = window.requestAnimationFrame;

/** Where the nose is on a canvas, in pixels from its top left corner. */
interface Position {
	readonly x: number;
	readonly y: number;
}

/** How far the nose has to move to the side or up, in pixels at a canvas 200 wide, for a test to call it turned, and how near its resting place it has to be to call it back. */
const turnedPixels = { side: 10, up: 4 };
const backPixels = 4;

describe('a figure driven by the host', () => {
	const canvases: HTMLCanvasElement[] = [];
	const handles: FigureHandle[] = [];
	/** What each watched canvas held when the figure last drew it, read in the frame's own task, where the buffer still holds the picture. */
	const shown = new Map<HTMLCanvasElement, { width: number; height: number; pixels: Uint8Array }>();
	let frames = 0;

	beforeEach(() => {
		frames = 0;
		shown.clear();
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
		await cdp().send('Emulation.setEmulatedMedia', { features: [] });
	});

	/** Keeps the canvas's picture if a frame drew it just now; a canvas whose figure has not drawn this frame holds nothing. */
	function readIfDrawn(canvas: HTMLCanvasElement): void {
		const pixels = readPixels(canvas);
		if (coversSomething(pixels)) shown.set(canvas, { width: canvas.width, height: canvas.height, pixels });
	}

	async function mountFigure(bytes: Uint8Array = buildConformantVrm()): Promise<{ canvas: HTMLCanvasElement; handle: FigureHandle }> {
		const canvas = document.createElement('canvas');
		canvas.style.width = '200px';
		canvas.style.height = '250px';
		document.body.append(canvas);
		canvases.push(canvas);
		const handle = await mount(canvas, bytes);
		handles.push(handle);
		return { canvas, handle };
	}

	/** The nose as the latest frame of `canvas` shows it, once the figure has drawn after `afterFrame`. */
	async function noseAfter(canvas: HTMLCanvasElement, afterFrame: number): Promise<Position> {
		await vi.waitFor(() => expect(frames).toBeGreaterThan(afterFrame), { timeout: 5000 });
		await vi.waitFor(() => expect(shown.get(canvas)).toBeDefined());
		const { pixels, width, height } = shown.get(canvas)!;
		return noseOf(pixels, width, height);
	}

	async function noseNow(canvas: HTMLCanvasElement): Promise<Position> {
		return noseAfter(canvas, frames + 2);
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

/** The canvas's drawing buffer as RGBA bytes; read in the task that drew it, a buffer holds nothing afterwards. */
function readPixels(canvas: HTMLCanvasElement): Uint8Array {
	const context = canvas.getContext('webgl2');
	if (context === null) throw new Error('the canvas has no WebGL 2 context');
	const pixels = new Uint8Array(canvas.width * canvas.height * 4);
	context.readPixels(0, 0, canvas.width, canvas.height, context.RGBA, context.UNSIGNED_BYTE, pixels);
	return pixels;
}

/** Whether the pixels hold any the figure covers: a buffer nothing was drawn into is transparent everywhere. */
function coversSomething(pixels: Uint8Array): boolean {
	return pixels.some((value, index) => index % 4 === 3 && value > 0);
}

/** The mean position of the nose's pixels, which the synthetic face paints yellow, in a buffer read from the bottom row up, measured from the top left. */
function noseOf(pixels: Uint8Array, width: number, height: number): Position {
	let count = 0;
	let sumX = 0;
	let sumY = 0;
	for (let row = 0; row < height; row++) {
		for (let column = 0; column < width; column++) {
			const offset = 4 * (row * width + column);
			const [red, green, blue, alpha] = [pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!, pixels[offset + 3]!];
			if (alpha >= 200 && red > 200 && green > 190 && blue < 150) {
				count++;
				sumX += column;
				sumY += height - 1 - row;
			}
		}
	}
	if (count === 0) throw new Error('the nose is not on the canvas');
	return { x: sumX / count, y: sumY / count };
}

/** Sets the page's `prefers-reduced-motion` to `reduce` through the browser's own media emulation, which is what a person's setting reaches the package as. */
async function emulateReducedMotion(): Promise<void> {
	await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
}
