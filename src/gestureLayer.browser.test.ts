import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cdp } from 'vitest/browser';
import { centreOf, emulateReducedMotion, restorePageVisibility, setPageVisibility, type FaceFeature, type Spot } from '../tests/browserCanvas.js';
import { startFigureWatch, type FigureWatch } from '../tests/figureWatch.js';
import { gestureLengthSeconds } from './gestureClips.js';
import { figureGesture, type FigureGesture } from './gestures.js';
import { figureSignal } from './signals.js';

type Features = Record<FaceFeature, Spot[]>;

/** How far the arms' top pixel rises, in pixels at a canvas 200 wide, for a test to call the hand raised, and how near its resting height it has to be to call the arm at rest. */
const raisedPixels = 20;
const restPixels = 6;
/** The raised hand's top rows lie beside the face: on one side of the nose's column and no further from it than this many spans between the outer edges of the eyes. */
const besideFaceEyeSpans = 2.5;
/** How many pictures in a row show the arm at rest for a wave to be over, and the longest, in seconds, a wave is waited for. */
const restPictures = 5;
const longestWaitSeconds = 30;
/** The seconds an ignored call is watched, beyond the length of the gesture. */
const ignoredWatchMarginSeconds = 1;
/** The frames waited after a canvas leaves the viewport, for the observer to report it and the loop to pause. */
const outOfViewFrames = 10;

const armTop = (features: Features) => Math.min(...features.arm.map((spot) => spot.y));
const noseOf = (features: Features) => centreOf(features.nose);

/** The hand is up beside the face: the arms' top rows are raised above the arm at rest and on one side of the nose, the nose in view. */
function showsWaving(features: Features, resting: Features): boolean {
	const nose = noseOf(features);
	if (features.arm.length === 0 || nose.count <= noseOf(resting).count / 2) return false;
	const eyeSpan = Math.max(...features.eye.map((spot) => spot.x)) - Math.min(...features.eye.map((spot) => spot.x));
	const handTop = features.arm.filter((spot) => spot.y <= armTop(features) + raisedPixels);
	const oneSide = handTop.every((spot) => spot.x < nose.x) || handTop.every((spot) => spot.x > nose.x);
	return armTop(features) < armTop(resting) - raisedPixels && oneSide && Math.abs(centreOf(handTop).x - nose.x) < besideFaceEyeSpans * eyeSpan;
}

/** The arm is where it is at `resting`: its top row at the same height, to within the breath's lift. */
function showsArmAt(features: Features, resting: Features): boolean {
	return features.arm.length > 0 && Math.abs(armTop(features) - armTop(resting)) <= restPixels;
}

describe('a figure whose agent waves', () => {
	let watch: FigureWatch;

	beforeEach(() => {
		watch = startFigureWatch();
	});

	afterEach(async () => {
		watch.end();
		restorePageVisibility();
		await cdp().send('Emulation.setEmulatedMedia', { features: [] });
	});

	/** The features of each picture `canvas` shows over the next `seconds` of the page's time. */
	async function traceFor(canvas: HTMLCanvasElement, seconds: number): Promise<Features[]> {
		const trace: Features[] = [];
		const start = performance.now();
		while (performance.now() - start < seconds * 1000) trace.push(await watch.featuresOfNextFrame(canvas));
		return trace;
	}

	/** The features of each picture `canvas` shows until `restPictures` in a row show the arm at `resting` after one that did not, or until the wait is over. */
	async function traceWave(canvas: HTMLCanvasElement, resting: Features, started: Features[] = []): Promise<Features[]> {
		const trace = [...started];
		const start = performance.now();
		const settled = () => {
			const lastPictures = trace.slice(-restPictures);
			return lastPictures.length === restPictures && lastPictures.every((features) => showsArmAt(features, resting)) && trace.some((features) => !showsArmAt(features, resting));
		};
		while (!settled() && performance.now() - start < longestWaitSeconds * 1000) trace.push(await watch.featuresOfNextFrame(canvas));
		return trace;
	}

	/** The seconds an ignored call is watched: the whole of what a wave would take. */
	const ignoredWatchSeconds = gestureLengthSeconds(figureGesture.wave) + ignoredWatchMarginSeconds;

	it('raises the hand beside the face with the nose in view and lowers it to rest', async () => {
		const { canvas, handle } = await watch.mountFigure();
		const resting = await watch.featuresNow(canvas);
		handle.gesture(figureGesture.wave);
		const trace = await traceWave(canvas, resting);

		expect(trace.some((features) => showsWaving(features, resting))).toBe(true);
		trace.slice(-restPictures).forEach((features) => expect(showsArmAt(features, resting)).toBe(true));
	});

	it('lifts the hand from the chin while the figure thinks and puts it back', async () => {
		await emulateReducedMotion();
		const { canvas, handle } = await watch.mountFigure();
		const resting = await watch.featuresNow(canvas);
		handle.think(true);
		const atChin = await watch.featuresNow(canvas);
		await cdp().send('Emulation.setEmulatedMedia', { features: [] });
		handle.gesture(figureGesture.wave);
		const trace = await traceWave(canvas, atChin);

		expect(armTop(atChin)).toBeLessThan(armTop(resting) - raisedPixels);
		expect(trace.some((features) => armTop(features) < armTop(atChin) - raisedPixels)).toBe(true);
		trace.slice(-restPictures).forEach((features) => expect(showsArmAt(features, atChin)).toBe(true));
	});

	it.each([['a string outside the set', 'bow'], ['an inherited name', 'constructor'], ['a number', 42], ['nothing', undefined], ['null', null], ['an object', {}]])(
		'ignores %s and throws nothing',
		async (_, value) => {
			const { canvas, handle } = await watch.mountFigure();
			const resting = await watch.featuresNow(canvas);

			expect(() => handle.gesture(value as FigureGesture)).not.toThrow();
			const trace = await traceFor(canvas, ignoredWatchSeconds);

			trace.forEach((features) => expect(showsWaving(features, resting)).toBe(false));
		}
	);

	it('ignores a call made while the page is hidden and plays none when the page is shown again', async () => {
		const { canvas, handle } = await watch.mountFigure();
		const resting = await watch.featuresNow(canvas);
		setPageVisibility('hidden');

		expect(() => handle.gesture(figureGesture.wave)).not.toThrow();
		setPageVisibility('visible');
		const trace = await traceFor(canvas, ignoredWatchSeconds);

		trace.forEach((features) => expect(showsWaving(features, resting)).toBe(false));
	});

	it('plays none under reduced motion', async () => {
		await emulateReducedMotion();
		const { canvas, handle } = await watch.mountFigure();
		const resting = await watch.featuresNow(canvas);
		handle.gesture(figureGesture.wave);
		const trace = await traceFor(canvas, ignoredWatchSeconds);

		trace.forEach((features) => expect(showsWaving(features, resting)).toBe(false));
	});

	it('plays none when the preference is lifted after a call made under reduced motion while the canvas was out of the viewport', async () => {
		await emulateReducedMotion();
		const { canvas, handle } = await watch.mountFigure();
		const resting = await watch.featuresNow(canvas);
		canvas.style.marginTop = '20000px';
		await vi.waitFor(() => expect(canvas.getBoundingClientRect().top).toBeGreaterThan(window.innerHeight));
		for (let frame = 0; frame < outOfViewFrames; frame++) await watch.featuresOfNextFrame(canvas);
		handle.gesture(figureGesture.wave);
		await cdp().send('Emulation.setEmulatedMedia', { features: [] });
		canvas.style.marginTop = '';
		const trace = await traceFor(canvas, ignoredWatchSeconds);

		trace.forEach((features) => expect(showsWaving(features, resting)).toBe(false));
	});

	it('ignores a call on a disposed figure', async () => {
		const { canvas, handle } = await watch.mountFigure();
		const resting = await watch.featuresNow(canvas);
		handle.dispose();

		expect(() => handle.gesture(figureGesture.wave)).not.toThrow();
		const trace = await traceFor(canvas, ignoredWatchSeconds);

		trace.forEach((features) => expect(showsWaving(features, resting)).toBe(false));
	});

	it('ignores a call on a figure that was refused', async () => {
		const { handle } = await watch.mountFigure(new Uint8Array(4));

		expect(handle.signal).toBe(figureSignal.refused);
		expect(() => handle.gesture(figureGesture.wave)).not.toThrow();
		expect(handle.signal).toBe(figureSignal.refused);
	});
});
