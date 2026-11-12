// What the browser tests share to watch drawn figures: mounting on canvases, reading each canvas in the task that drew it, and ending the figures.
import { expect, vi } from 'vitest';
import { mount, type FigureHandle } from '../src/draw.js';
import { buildConformantVrm } from './figureFixtures.js';
import { coversSomething, readPixels, spotsOf, type FaceFeature, type Spot } from './browserCanvas.js';

/** The page's own frame request, which the watch waits on without counting it. */
const requestFrameOwn = window.requestAnimationFrame;

/** The milliseconds a frame lasts when the watch makes the frames slow: far past what the frame-time guard keeps. */
const slowFrameMilliseconds = 60;

/** A figure the watch mounted, with the canvas it is drawn on. */
export interface WatchedFigure {
	readonly canvas: HTMLCanvasElement;
	readonly handle: FigureHandle;
}

export interface FigureWatch {
	/** Mounts a 200 by 250 pixel canvas into the page and draws the figure of `bytes` on it. */
	mountFigure(bytes?: Uint8Array): Promise<WatchedFigure>;
	/** The face features of the next picture `canvas` shows after the frames the watch has seen by now, read in the task that drew it. */
	featuresNow(canvas: HTMLCanvasElement): Promise<Record<FaceFeature, Spot[]>>;
	/** Stops reading, disposes the figures and removes their canvases. */
	end(): void;
}

/** Starts a watch; `slowFrames` hands the figures frame times that make them too slow to keep. */
export function startFigureWatch(slowFrames = false): FigureWatch {
	const canvases: HTMLCanvasElement[] = [];
	const handles: FigureHandle[] = [];
	const shown = new Map<HTMLCanvasElement, { width: number; height: number; pixels: Uint8Array }>();
	let frames = 0;
	let slowTime: number | undefined;
	vi.spyOn(Math, 'random').mockImplementation(seededRandom(7));
	window.requestAnimationFrame = (callback) =>
		requestFrameOwn.call(window, (time) => {
			slowTime = (slowTime ?? time) + slowFrameMilliseconds;
			callback(slowFrames ? slowTime : time);
			frames++;
			canvases.forEach(readIfDrawn);
		});

	/** Keeps the canvas's picture if a frame drew it just now; a canvas whose figure has not drawn this frame holds nothing. */
	function readIfDrawn(canvas: HTMLCanvasElement): void {
		const pixels = readPixels(canvas);
		if (coversSomething(pixels)) shown.set(canvas, { width: canvas.width, height: canvas.height, pixels });
	}

	return {
		async mountFigure(bytes = buildConformantVrm()) {
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
		},
		async featuresNow(canvas) {
			const after = frames + 2;
			await vi.waitFor(() => expect(frames).toBeGreaterThan(after), { timeout: 5000 });
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
