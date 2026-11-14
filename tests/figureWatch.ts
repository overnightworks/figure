// What the browser tests share to watch drawn figures: mounting on canvases, reading each canvas in the task that drew it, and ending the figures.
import { expect, vi } from 'vitest';
import { mount, mountLoadingClips, type ClipLoad, type FigureHandle, type MountOptions } from '../src/draw.js';
import { buildConformantVrm } from './figureFixtures.js';
import { slowMedianMilliseconds } from '../src/frameTimeGuard.js';
import { coversSomething, readPixels, spotsOf, type FaceFeature, type Spot } from './browserCanvas.js';

/** The page's own frame request, which the watch waits on without counting it. */
const requestFrameOwn = window.requestAnimationFrame;

/** The milliseconds a frame lasts when the watch makes the frames slow: far past what the frame-time guard keeps. */
const slowFrameMilliseconds = 60;

/** The most a frame the watch hands to a figure lasts unless it makes the frames slow: not past the median the frame-time guard keeps, so a slow runner never ends the figure under test. */
const longestKeptFrameMilliseconds = slowMedianMilliseconds;

/** A figure the watch mounted, with the canvas it is drawn on. */
export interface WatchedFigure {
	readonly canvas: HTMLCanvasElement;
	readonly handle: FigureHandle;
}

export interface FigureWatch {
	/** Mounts a 200 by 250 pixel canvas into the page and draws the figure of `bytes` on it, with the mount `options`; with `load` the parse of a clip's bytes is `load`, otherwise it is figure's own. */
	mountFigure(bytes?: Uint8Array, options?: MountOptions, load?: ClipLoad): Promise<WatchedFigure>;
	/** The face features of the next picture `canvas` shows after the frames the watch has seen by now, read in the task that drew it. */
	featuresNow(canvas: HTMLCanvasElement): Promise<Record<FaceFeature, Spot[]>>;
	/** The face features of the picture the first frame drawn after this call shows on `canvas`, with no frames waited for beyond it. */
	featuresOfNextFrame(canvas: HTMLCanvasElement): Promise<Record<FaceFeature, Spot[]>>;
	/** Stops reading, disposes the figures and removes their canvases. */
	end(): void;
}

/** Starts a watch; `slowFrames` hands the figures frame times that make them too slow to keep, otherwise the frame times follow the page's but for any frame longer than `longestKeptFrameMilliseconds`. */
export function startFigureWatch(slowFrames = false): FigureWatch {
	const canvases: HTMLCanvasElement[] = [];
	const handles: FigureHandle[] = [];
	const shown = new Map<HTMLCanvasElement, { width: number; height: number; pixels: Uint8Array }>();
	let frames = 0;
	let handedTime: number | undefined;
	vi.spyOn(Math, 'random').mockImplementation(seededRandom(7));
	window.requestAnimationFrame = (callback) =>
		requestFrameOwn.call(window, (time) => {
			const previousTime = handedTime ?? time;
			handedTime = slowFrames ? previousTime + slowFrameMilliseconds : Math.min(time, previousTime + longestKeptFrameMilliseconds);
			callback(handedTime);
			frames++;
			canvases.forEach(readIfDrawn);
		});

	/** Keeps the canvas's picture if a frame drew it just now; a canvas whose figure has not drawn this frame holds nothing. */
	function readIfDrawn(canvas: HTMLCanvasElement): void {
		const pixels = readPixels(canvas);
		if (coversSomething(pixels)) shown.set(canvas, { width: canvas.width, height: canvas.height, pixels });
	}

	return {
		async mountFigure(bytes = buildConformantVrm(), options, load) {
			const canvas = document.createElement('canvas');
			canvas.style.width = '200px';
			canvas.style.height = '250px';
			document.body.append(canvas);
			canvases.push(canvas);
			const handle = await (load === undefined ? mount(canvas, bytes, options) : mountLoadingClips(load, canvas, bytes, options));
			// The figure draws once before `mount` returns; the buffer still holds that first frame in the task that drew it.
			readIfDrawn(canvas);
			handles.push(handle);
			return { canvas, handle };
		},
		async featuresNow(canvas) {
			const after = frames + 2;
			await vi.waitFor(() => expect(frames).toBeGreaterThan(after), { timeout: 5000 });
			const picture = shown.get(canvas)!;
			return spotsOf(picture.pixels, picture.width, picture.height);
		},
		async featuresOfNextFrame(canvas) {
			// The figure's own frame request is older than this one, so its frame draws and is read before this callback runs.
			await new Promise<void>((resolve) => requestFrameOwn.call(window, () => resolve()));
			const picture = shown.get(canvas)!;
			return spotsOf(picture.pixels, picture.width, picture.height);
		},
		end() {
			window.requestAnimationFrame = requestFrameOwn;
			vi.restoreAllMocks();
			handles.splice(0).forEach((handle) => handle.dispose());
			canvases.splice(0).forEach((canvas) => canvas.remove());
		}
	};
}

/** A small seeded source of numbers in [0, 1) (mulberry32): a run draws the same idle glances and blinks every time, and three still gets distinct identifiers. */
function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
	};
}
