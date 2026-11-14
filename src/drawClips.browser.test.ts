import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildArmUpClip, buildClipGlb, buildClipGlbOfSize, filesTheLibraryThrowsOn } from '../tests/clipFixtures.js';
import { type FaceFeature, type Spot } from '../tests/browserCanvas.js';
import { startFigureWatch, type FigureWatch } from '../tests/figureWatch.js';
import { gestureClips, gestureLengthSeconds } from './gestureClips.js';
import type { MountOptions } from './draw.js';
import { figureGesture, type FigureGesture } from './gestures.js';
import { clipProfile } from './profile.js';
import { figureSignal, type FigureSignal } from './signals.js';

type Features = Record<FaceFeature, Spot[]>;

/** How far the arms' top pixel rises, in pixels at a canvas 200 wide, for a test to call an arm raised. */
const raisedPixels = 20;
const armTop = (features: Features) => Math.min(...features.arm.map((spot) => spot.y));
const isRaised = (features: Features, resting: Features) => armTop(features) < armTop(resting) - raisedPixels;

/** The seconds the persona's clip holds the arm up: more than a neutral wave takes. */
const holdSeconds = 6;
const holdingClip = () => buildArmUpClip(holdSeconds);

/** The seconds after a call at which a neutral wave is over and the persona's clip still holds the arm: the length of the neutral wave and a margin. */
const afterNeutralWaveSeconds = gestureLengthSeconds(gestureClips[figureGesture.wave]) + 1;
/** The longest a test waits for something the page does on its own. */
const settleMilliseconds = 5000;

/**
 * Stands between `GLTFLoader` and the bytes of one clip: a parse of those bytes waits for `release` or `fail`, any other parse goes on.
 * What three was handed and what it gave back is what the tests read of it.
 */
function gateClipParse(clip: Uint8Array) {
	const original = GLTFLoader.prototype.parseAsync;
	let open: () => void;
	let fail: (error: Error) => void;
	const gate = new Promise<void>((resolve, reject) => {
		open = resolve;
		fail = reject;
	});
	const parsed: ArrayBuffer[] = [];
	let finished = 0;
	const spy = vi.spyOn(GLTFLoader.prototype, 'parseAsync').mockImplementation(async function (this: GLTFLoader, data, path) {
		const isClip = data instanceof ArrayBuffer && data.byteLength === clip.length;
		if (isClip) parsed.push(data);
		try {
			if (isClip) await gate;
			return await original.call(this, data, path);
		} finally {
			if (isClip) finished++;
		}
	});
	return {
		/** How many times three was handed the clip's bytes. */
		get handed() {
			return parsed.length;
		},
		/** How many parses of the clip have ended, in a clip or in a failure. */
		get finished() {
			return finished;
		},
		release: () => open(),
		fail: (error: Error) => fail(error),
		restore: () => spy.mockRestore()
	};
}

describe('mount with the clips of a persona', { timeout: 60_000 }, () => {
	let watch: FigureWatch;
	let gate: ReturnType<typeof gateClipParse> | undefined;
	const problems: unknown[] = [];
	const onUnhandledRejection = (event: PromiseRejectionEvent) => problems.push(event.reason);

	beforeEach(() => {
		watch = startFigureWatch();
		problems.length = 0;
		window.addEventListener('unhandledrejection', onUnhandledRejection);
		vi.spyOn(console, 'error').mockImplementation((...reason) => problems.push(reason));
	});

	afterEach(() => {
		window.removeEventListener('unhandledrejection', onUnhandledRejection);
		gate?.restore();
		gate = undefined;
		watch.end();
	});

	/** The features of each picture over the next `seconds` of the page's time, the last one returned. */
	async function featuresAfter(canvas: HTMLCanvasElement, seconds: number): Promise<Features> {
		const start = performance.now();
		let features = await watch.featuresOfNextFrame(canvas);
		while (performance.now() - start < seconds * 1000) features = await watch.featuresOfNextFrame(canvas);
		return features;
	}

	/** Whether any picture over the next `seconds` shows the arm raised. */
	async function raisedWithin(canvas: HTMLCanvasElement, resting: Features, seconds: number): Promise<boolean> {
		const start = performance.now();
		let raised = false;
		while (performance.now() - start < seconds * 1000) raised ||= isRaised(await watch.featuresOfNextFrame(canvas), resting);
		return raised;
	}

	/** Mounts a figure with `gestures` and reads it at rest. */
	async function mountWith(gestures: Readonly<Record<string, Uint8Array>>) {
		const signals: FigureSignal[] = [];
		const mounted = await watch.mountFigure(undefined, { gestures: gestures as MountOptions['gestures'], onSignal: (signal) => signals.push(signal) });
		const resting = await watch.featuresNow(mounted.canvas);
		return { ...mounted, resting, signals };
	}

	/** After a call for the wave: the neutral wave has come and gone when the arm is not raised by the time it would be over. */
	async function expectNeutralWave(canvas: HTMLCanvasElement, resting: Features, handle: { gesture(name: FigureGesture): void }) {
		handle.gesture(figureGesture.wave);
		const raised = await raisedWithin(canvas, resting, 1.5);

		expect(raised).toBe(true);
		expect(isRaised(await featuresAfter(canvas, afterNeutralWaveSeconds - 1.5), resting)).toBe(false);
	}

	it('plays the neutral wave until the clip has parsed, finishes it at its own length, and plays the clip from the next call', async () => {
		const clip = holdingClip();
		gate = gateClipParse(clip);
		const { canvas, handle, resting } = await mountWith({ [figureGesture.wave]: clip });
		handle.gesture(figureGesture.wave);
		await raisedWithin(canvas, resting, 0.3);
		gate.release();
		await vi.waitFor(() => expect(gate!.finished).toBe(1), { timeout: settleMilliseconds });

		expect(isRaised(await featuresAfter(canvas, afterNeutralWaveSeconds - 0.3), resting)).toBe(false);
		handle.gesture(figureGesture.wave);
		expect(isRaised(await featuresAfter(canvas, afterNeutralWaveSeconds), resting)).toBe(true);
		expect(problems).toEqual([]);
	});

	it('resolves with the figure drawn and its first signal given before the clip has parsed, at the byte budget', async () => {
		const clip = buildClipGlbOfSize(clipProfile.fileBudgetBytes);
		gate = gateClipParse(clip);
		const { handle, signals } = await mountWith({ [figureGesture.wave]: clip });

		expect(handle.signal).toBe(figureSignal.drawn);
		expect(signals).toEqual([figureSignal.drawn]);
		expect(gate.finished).toBe(0);
	});

	it('hands a clip that passes the check to three once', async () => {
		const clip = holdingClip();
		gate = gateClipParse(clip);
		gate.release();
		const { handle } = await mountWith({ [figureGesture.wave]: clip });
		await vi.waitFor(() => expect(gate!.finished).toBe(1), { timeout: settleMilliseconds });

		expect(gate.handed).toBe(1);
		expect(handle.signal).toBe(figureSignal.drawn);
	});

	it.each([
		['a name outside the set', 'bow'],
		['an inherited name', 'constructor']
	])('drops a clip under %s: three is never handed it and the wave stays neutral', async (_, key) => {
		const clip = holdingClip();
		gate = gateClipParse(clip);
		gate.release();
		const { canvas, handle, resting, signals } = await mountWith({ [key]: clip });
		await featuresAfter(canvas, 0.5);

		expect(gate.handed).toBe(0);
		await expectNeutralWave(canvas, resting, handle);
		expect(signals).toEqual([figureSignal.drawn]);
		expect(problems).toEqual([]);
	});

	it.each([
		['a clip with no scene', buildClipGlb({ change: filesTheLibraryThrowsOn[2]![1] })],
		['a clip with a rotation channel on an expression node', buildClipGlb({ change: filesTheLibraryThrowsOn[0]![1] })],
		['a clip with a translation channel on the look-at node', buildClipGlb({ change: filesTheLibraryThrowsOn[1]![1] })],
		['bytes that are no glTF', new Uint8Array(32)]
	])('drops %s the check refuses: three is never handed it and the wave stays neutral', async (_, clip) => {
		gate = gateClipParse(clip);
		gate.release();
		const { canvas, handle, resting, signals } = await mountWith({ [figureGesture.wave]: clip });
		await featuresAfter(canvas, 0.5);

		expect(gate.handed).toBe(0);
		await expectNeutralWave(canvas, resting, handle);
		expect(signals).toEqual([figureSignal.drawn]);
		expect(problems).toEqual([]);
	});

	it.each([
		['a value that is no bytes', () => ({ [figureGesture.wave]: null })],
		['an option that is null', () => null],
		[
			'an option that throws when read',
			() =>
				Object.defineProperty({}, figureGesture.wave, {
					enumerable: true,
					get: () => {
						throw new Error('unreadable');
					}
				})
		]
	])('drops %s with no signal, and the wave stays neutral', async (_, option) => {
		const signals: FigureSignal[] = [];
		const { canvas, handle } = await watch.mountFigure(undefined, { gestures: option() as MountOptions['gestures'], onSignal: (signal) => signals.push(signal) });
		const resting = await watch.featuresNow(canvas);
		await featuresAfter(canvas, 0.5);

		await expectNeutralWave(canvas, resting, handle);
		expect(signals).toEqual([figureSignal.drawn]);
		expect(problems).toEqual([]);
	});

	it('drops a clip whose load fails with no signal, and the wave stays neutral', async () => {
		const clip = holdingClip();
		gate = gateClipParse(clip);
		const { canvas, handle, resting, signals } = await mountWith({ [figureGesture.wave]: clip });
		gate.fail(new Error('the load failed'));
		await vi.waitFor(() => expect(gate!.finished).toBe(1), { timeout: settleMilliseconds });
		await featuresAfter(canvas, 0.5);

		await expectNeutralWave(canvas, resting, handle);
		expect(signals).toEqual([figureSignal.drawn]);
		expect(problems).toEqual([]);
	});

	it('throws nothing and leaves no loop when the figure is disposed while a clip parses, and uses the clip no more', async () => {
		const clip = holdingClip();
		gate = gateClipParse(clip);
		const { handle, signals } = await mountWith({ [figureGesture.wave]: clip });
		const frameRequest = vi.spyOn(window, 'requestAnimationFrame');
		handle.dispose();
		const requestedAtDispose = frameRequest.mock.calls.length;
		gate.release();
		await vi.waitFor(() => expect(gate!.finished).toBe(1), { timeout: settleMilliseconds });
		await new Promise((resolve) => setTimeout(resolve, 300));

		expect(() => handle.gesture(figureGesture.wave)).not.toThrow();
		expect(frameRequest.mock.calls.length).toBe(requestedAtDispose);
		expect(signals).toEqual([figureSignal.drawn]);
		expect(problems).toEqual([]);
	});

	it('waves the neutral wave when it is given no clip', async () => {
		const { canvas, handle, resting } = await mountWith({});

		await expectNeutralWave(canvas, resting, handle);
	});
});
