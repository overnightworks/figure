// What the browser tests share to watch drawn figures: mounting on canvases, reading each canvas in the task that drew it, and ending the figures.
import { expect, vi } from 'vitest';
import { mount, type FigureHandle, type MountOptions } from '../src/draw.js';
import { loadClip } from '../src/clipLoader.js';
import { mountWithLoads, type ClipLoad, type RoomLoad } from '../src/figureMount.js';
import { loadRoom } from '../src/roomLoader.js';
import { buildConformantVrm } from './figureFixtures.js';
import { slowMedianMilliseconds } from '../src/frameTimeGuard.js';
import { coversSomething, readPixels, spotsOf, type FaceFeature, type Spot, nextFrame, requestFrameOwn } from './browserCanvas.js';
import { seededRandom } from './figureMotionWatch.js';

/** The milliseconds a frame lasts when the watch makes the frames slow: far past what the frame-time guard keeps. */
const slowFrameMilliseconds = 60;

/** The most a frame the watch hands to a figure lasts unless it makes the frames slow: not past the median the frame-time guard keeps, so a slow runner never ends the figure under test. */
const longestKeptFrameMilliseconds = slowMedianMilliseconds;

/** The drawing buffer of a frame as RGBA bytes, read from the bottom row up. */
export interface Picture {
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array;
}

/** A figure the watch mounted, with the canvas it is drawn on. */
export interface WatchedFigure {
	readonly canvas: HTMLCanvasElement;
	readonly handle: FigureHandle;
}

export interface FigureWatch {
	/** Mounts a 200 by 250 pixel canvas into the page and draws the figure of `bytes` on it, with the mount `options`; with `load` the parse of a clip's bytes is `load` and with `loadRoomBytes` the parse of a room's, otherwise they are figure's own. */
	mountFigure(bytes?: Uint8Array, options?: MountOptions, load?: ClipLoad, loadRoomBytes?: RoomLoad): Promise<WatchedFigure>;
	/** The picture the first frame drawn after this call shows on `canvas`, with no frames waited for beyond it. */
	pictureOfNextFrame(canvas: HTMLCanvasElement): Promise<Picture>;
	/** The face features of the next picture `canvas` shows after the frames the watch has seen by now, read in the task that drew it. */
	featuresNow(canvas: HTMLCanvasElement): Promise<Record<FaceFeature, Spot[]>>;
	/** The face features of the picture the first frame drawn after this call shows on `canvas`, with no frames waited for beyond it. */
	featuresOfNextFrame(canvas: HTMLCanvasElement): Promise<Record<FaceFeature, Spot[]>>;
	/** The seconds the frames handed to the figures add up to since the first: the figures' own time, which on a slow runner falls behind the page's. */
	figureSeconds(): number;
	/** Stops reading, disposes the figures and removes their canvases. */
	end(): void;
}

/** The frame times a watched figure is handed from the page's own: the page's, but never a frame longer than `longestKeptFrameMilliseconds` after the one before, so a slow runner cannot end the figure under test; with `slow` every frame lasts `slowFrameMilliseconds`. */
export function handedFrameTimes(slow = false): (pageTime: number) => number {
	let handedTime: number | undefined;
	return (pageTime) => {
		const previousTime = handedTime ?? pageTime;
		handedTime = slow ? previousTime + slowFrameMilliseconds : Math.min(pageTime, previousTime + longestKeptFrameMilliseconds);
		return handedTime;
	};
}

/** The frame times `handedFrameTimes` hands, and the seconds they add up to since the first. */
function countedFrameTimes(slow: boolean): { hand(pageTime: number): number; seconds(): number } {
	const handTime = handedFrameTimes(slow);
	let firstMilliseconds: number | undefined;
	let lastMilliseconds = 0;
	return {
		hand(pageTime) {
			lastMilliseconds = handTime(pageTime);
			firstMilliseconds ??= lastMilliseconds;
			return lastMilliseconds;
		},
		seconds: () => (firstMilliseconds === undefined ? 0 : (lastMilliseconds - firstMilliseconds) / 1000)
	};
}

/** Starts a watch; `slowFrames` hands the figures frame times that make them too slow to keep, otherwise the frame times follow the page's but for any frame longer than `longestKeptFrameMilliseconds`. */
export function startFigureWatch(slowFrames = false): FigureWatch {
	const canvases: HTMLCanvasElement[] = [];
	const handles: FigureHandle[] = [];
	const shown = new Map<HTMLCanvasElement, { width: number; height: number; pixels: Uint8Array }>();
	let frames = 0;
	const frameClock = countedFrameTimes(slowFrames);
	vi.spyOn(Math, 'random').mockImplementation(seededRandom(7));
	window.requestAnimationFrame = (callback) =>
		requestFrameOwn.call(window, (time) => {
			callback(frameClock.hand(time));
			frames++;
			canvases.forEach(readIfDrawn);
		});

	/** Keeps the canvas's picture if a frame drew it just now; a canvas whose figure has not drawn this frame holds nothing. */
	function readIfDrawn(canvas: HTMLCanvasElement): void {
		const pixels = readPixels(canvas);
		if (coversSomething(pixels)) shown.set(canvas, { width: canvas.width, height: canvas.height, pixels });
	}

	return {
		async mountFigure(bytes = buildConformantVrm(), options, load, loadRoomBytes) {
			const canvas = document.createElement('canvas');
			canvas.style.width = '200px';
			canvas.style.height = '250px';
			document.body.append(canvas);
			canvases.push(canvas);
			const handle = await (load === undefined && loadRoomBytes === undefined
				? mount(canvas, bytes, options)
				: mountWithLoads({ clip: load ?? loadClip, room: loadRoomBytes ?? loadRoom }, canvas, bytes, options));
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
		async pictureOfNextFrame(canvas) {
			// The figure's own frame request is older than this one, so its frame draws and is read before this callback runs.
			await nextFrame();
			return shown.get(canvas)!;
		},
		async featuresOfNextFrame(canvas) {
			const picture = await this.pictureOfNextFrame(canvas);
			return spotsOf(picture.pixels, picture.width, picture.height);
		},
		figureSeconds: () => frameClock.seconds(),
		end() {
			window.requestAnimationFrame = requestFrameOwn;
			vi.restoreAllMocks();
			handles.splice(0).forEach((handle) => handle.dispose());
			canvases.splice(0).forEach((canvas) => canvas.remove());
		}
	};
}

