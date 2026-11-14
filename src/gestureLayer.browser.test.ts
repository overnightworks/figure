import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cdp } from 'vitest/browser';
import { centreOf, emulateReducedMotion, restorePageVisibility, setPageVisibility, type FaceFeature, type Spot } from '../tests/browserCanvas.js';
import { startFigureWatch, type FigureWatch } from '../tests/figureWatch.js';
import { WebGLRenderer, type Object3D } from 'three';
import { VRMUtils, type VRM, type VRMHumanBoneName } from '@pixiv/three-vrm';
import { conformantTrack, identity, type ClipTrack, type Quaternion } from '../tests/clipBuilder.js';
import { buildClipGlb } from '../tests/clipFixtures.js';
import { buildConformantVrm } from '../tests/figureFixtures.js';
import { idle, ownClip, seed, seededRandom } from '../tests/figureMotionWatch.js';
import { loadClip } from './clipLoader.js';
import { createFigureMotion, type FigurePose } from './figureMotion.js';
import { createFigureStage } from './figureFrame.js';
import { loadFigure } from './figureLoader.js';
import { boneClock, clipWeight, gestureClips, gestureLengthSeconds } from './gestureClips.js';
import { createGestureLayer, type GestureLayer } from './gestureLayer.js';
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
/** The time a test of the wave has: twice the longest wait, since a test mounts a figure, reads it at rest and then watches the length of a wave or waits for one. */
const testTimeoutMilliseconds = 2 * longestWaitSeconds * 1000;
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

describe('a figure whose agent waves', { timeout: testTimeoutMilliseconds }, () => {
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
	const ignoredWatchSeconds = gestureLengthSeconds(gestureClips[figureGesture.wave]) + ignoredWatchMarginSeconds;

	/** No picture of the next whole wave's length shows the hand waving. */
	async function expectNoWaveOver(canvas: HTMLCanvasElement, resting: Features): Promise<void> {
		const trace = await traceFor(canvas, ignoredWatchSeconds);

		trace.forEach((features) => expect(showsWaving(features, resting)).toBe(false));
	}

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
			await expectNoWaveOver(canvas, resting);
		}
	);

	it('ignores a call made while the page is hidden and plays none when the page is shown again', async () => {
		const { canvas, handle } = await watch.mountFigure();
		const resting = await watch.featuresNow(canvas);
		setPageVisibility('hidden');

		expect(() => handle.gesture(figureGesture.wave)).not.toThrow();
		setPageVisibility('visible');
		await expectNoWaveOver(canvas, resting);
	});

	it('plays none under reduced motion', async () => {
		await emulateReducedMotion();
		const { canvas, handle } = await watch.mountFigure();
		const resting = await watch.featuresNow(canvas);
		handle.gesture(figureGesture.wave);
		await expectNoWaveOver(canvas, resting);
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
		await expectNoWaveOver(canvas, resting);
	});

	it('ignores a call on a disposed figure', async () => {
		const { canvas, handle } = await watch.mountFigure();
		const resting = await watch.featuresNow(canvas);
		handle.dispose();

		expect(() => handle.gesture(figureGesture.wave)).not.toThrow();
		await expectNoWaveOver(canvas, resting);
	});

	it('ignores a call on a figure that was refused', async () => {
		const { handle } = await watch.mountFigure(new Uint8Array(4));

		expect(handle.signal).toBe(figureSignal.refused);
		expect(() => handle.gesture(figureGesture.wave)).not.toThrow();
		expect(handle.signal).toBe(figureSignal.refused);
	});
});

/** The turn about X by `angle` radians, as the quaternion a file stores it. */
const aboutX = (angle: number): Quaternion => [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
/** How far a bone is turned from its rest, in radians. */
const turnOf = (bone: Object3D) => 2 * Math.acos(Math.min(1, Math.abs(bone.quaternion.w)));
/** A turn small enough that a component-wise blend of two rotations about one axis stays within the test's tolerance of the blend of their angles. */
const smallTurn = 0.3;
const holdSeconds = 4;
/** A track that turns `bone` to `angle` about X at both of its keys: the bone is held there for the clip's length. */
const holdTrack = (bone: string, angle: number): ClipTrack => ({ bone, times: [0, holdSeconds], rotations: [aboutX(angle), aboutX(angle)] });

describe('the gesture layer with a clip a persona wrote', () => {
	let vrm: VRM;
	let layer: GestureLayer;

	beforeEach(async () => {
		vrm = await loadFigure(buildConformantVrm());
		layer = createGestureLayer(vrm.humanoid);
	});

	afterEach(() => {
		VRMUtils.deepDispose(vrm.scene);
	});

	const boneNode = (bone: VRMHumanBoneName) => vrm.humanoid.getNormalizedBoneNode(bone)!;
	const rest = (bone: VRMHumanBoneName) => boneNode(bone).quaternion.identity();
	const loadedFrom = (...tracks: ClipTrack[]) => loadClip(buildClipGlb({ animations: [tracks] }));
	const playAt = (seconds: number, name: FigureGesture = figureGesture.wave) => ({ name, seconds, clip: layer.clipOf(name) });

	it('plays figure\'s own clip until a clip replaces it, on the fades of the clip it replaces', async () => {
		expect(layer.clipOf(figureGesture.wave)).toBe(gestureClips.wave);

		layer.replace(figureGesture.wave, await loadedFrom(conformantTrack()));

		expect(layer.clipOf(figureGesture.wave)).not.toBe(gestureClips.wave);
		expect(layer.clipOf(figureGesture.wave).fadeSeconds).toEqual(gestureClips.wave.fadeSeconds);
		expect(layer.clipOf(figureGesture.wave).durationSeconds).toBe(2);
	});

	describe.each([
		['linear', 'LINEAR'],
		['step', 'STEP'],
		['cubic-spline', 'CUBICSPLINE']
	] as const)('on a %s track', (_, interpolation) => {
		const quarterShare = 0.25;
		/** What the interpolation gives a quarter of the way through two keys with zero tangents, as glTF 2.0 section 3.11 defines it, as a share of the way from the first key's turn to the second's. */
		const shareAtQuarter = { LINEAR: quarterShare, STEP: 0, CUBICSPLINE: 3 * quarterShare ** 2 - 2 * quarterShare ** 3 } as const;
		const zero: Quaternion = [0, 0, 0, 0];
		const track: ClipTrack = {
			bone: 'rightUpperArm',
			times: [0, holdSeconds],
			rotations: interpolation === 'CUBICSPLINE' ? [zero, identity, zero, zero, aboutX(smallTurn), zero] : [identity, aboutX(smallTurn)],
			interpolation
		};

		it('turns the bone as the interpolation says, at the full weight of the clip', async () => {
			layer.replace(figureGesture.wave, await loadedFrom(track));
			const seconds = holdSeconds * quarterShare;
			const clock = boneClock('rightUpperArm', seconds);
			const share = shareAtQuarter[interpolation] * (clock / seconds);

			expect(clipWeight(layer.clipOf(figureGesture.wave), clock)).toBe(1);
			layer.apply(playAt(seconds));

			if (interpolation === 'CUBICSPLINE') expect(turnOf(boneNode('rightUpperArm'))).toBeLessThan(smallTurn * quarterShare);
			expect(turnOf(boneNode('rightUpperArm'))).toBeCloseTo(smallTurn * share, 2);
		});
	});

	describe('when the keys of the upper arm, the lower arm and the hand are simultaneous', () => {
		const bones = ['rightUpperArm', 'rightLowerArm', 'rightHand'] as const;
		const turns = () => bones.map((bone) => turnOf(boneNode(bone)));

		beforeEach(async () => {
			layer.replace(figureGesture.wave, await loadedFrom(...bones.map((bone) => holdTrack(bone, smallTurn))));
			bones.forEach(rest);
		});

		it('raises the lower arm after the upper arm and the hand after the lower arm', () => {
			layer.apply(playAt(layer.clipOf(figureGesture.wave).fadeSeconds.in / 2));
			const [upperArm, lowerArm, hand] = turns();

			expect(upperArm).toBeGreaterThan(lowerArm!);
			expect(lowerArm).toBeGreaterThan(hand!);
			expect(hand).toBeGreaterThan(0);
		});

		it('lowers the upper arm before the lower arm and the lower arm before the hand', () => {
			layer.apply(playAt(holdSeconds + (boneClock('rightHand', 0) - boneClock('rightLowerArm', 0)) / 2 + 0.01));
			const [upperArm, lowerArm, hand] = turns();

			expect(upperArm).toBeLessThan(lowerArm!);
			expect(lowerArm).toBeLessThan(hand!);
		});

		it('is over for every bone when the gesture\'s length is reached', () => {
			layer.apply(playAt(gestureLengthSeconds(layer.clipOf(figureGesture.wave))));

			turns().forEach((turn) => expect(turn).toBe(0));
		});
	});

	it('drops the tracks of the head, the neck and a bone the figure lacks, and plays the rest', async () => {
		layer.replace(
			figureGesture.wave,
			await loadedFrom(holdTrack('head', smallTurn), holdTrack('neck', smallTurn), holdTrack('hips', smallTurn), holdTrack('rightIndexProximal', smallTurn), holdTrack('leftUpperArm', smallTurn))
		);
		layer.apply(playAt(holdSeconds / 2));

		expect(layer.clipOf(figureGesture.wave).bones).toEqual(['leftUpperArm']);
		expect(turnOf(boneNode('leftUpperArm'))).toBeGreaterThan(0);
		(['head', 'neck', 'hips'] as const).forEach((bone) => expect(turnOf(boneNode(bone))).toBe(0));
	});

	it('names the nodes of every bone any of its clips turns', async () => {
		layer.replace(figureGesture.wave, await loadedFrom(holdTrack('leftLowerArm', smallTurn)));

		expect(layer.nodes).toContain(boneNode('leftLowerArm'));
	});

	it('plays a gesture that started before a replacement with the clip it started with', async () => {
		layer.replace(figureGesture.wave, await loadedFrom(holdTrack('leftUpperArm', smallTurn)));
		const started = playAt(holdSeconds / 2);
		layer.replace(figureGesture.wave, await loadedFrom(holdTrack('leftUpperArm', smallTurn / 2)));
		rest('leftUpperArm');
		layer.apply(started);

		expect(turnOf(boneNode('leftUpperArm'))).toBeCloseTo(smallTurn, 3);
	});
});

describe('the frame with a clip a persona wrote', () => {
	let vrm: VRM;
	let renderer: WebGLRenderer;
	let canvas: HTMLCanvasElement;
	let stage: ReturnType<typeof createFigureStage>;
	let resting: FigurePose;

	beforeEach(async () => {
		canvas = document.createElement('canvas');
		canvas.style.width = '200px';
		canvas.style.height = '250px';
		document.body.append(canvas);
		renderer = new WebGLRenderer({ canvas, alpha: true });
		vrm = await loadFigure(buildConformantVrm());
		stage = createFigureStage(renderer, canvas, vrm);
		resting = createFigureMotion(seededRandom(seed), ownClip).advance(idle, 0.01, false, null, null);
	});

	afterEach(() => {
		VRMUtils.deepDispose(vrm.scene);
		renderer.dispose();
		renderer.forceContextLoss();
		canvas.remove();
	});

	const turnOfBone = (bone: VRMHumanBoneName) => turnOf(vrm.humanoid.getNormalizedBoneNode(bone)!);
	const playing = (seconds: number, breath = resting.breath): FigurePose => ({
		...resting,
		breath,
		gesture: { name: figureGesture.wave, seconds, clip: stage.gestures.clipOf(figureGesture.wave) }
	});
	const startLoaded = async (...tracks: ClipTrack[]) => stage.gestures.replace(figureGesture.wave, await loadClip(buildClipGlb({ animations: [tracks] })));

	it('leaves every bone the clip turned at the pose the state gives once the clip is over', async () => {
		await startLoaded(holdTrack('leftLowerArm', smallTurn), holdTrack('rightIndexProximal', smallTurn), holdTrack('leftHand', smallTurn), holdTrack('chest', smallTurn));
		stage.draw(playing(holdSeconds / 2), 0.01);
		const turnedBones = ['leftLowerArm', 'leftHand'] as const;
		turnedBones.forEach((bone) => expect(turnOfBone(bone)).toBeGreaterThan(0));

		stage.draw({ ...resting, gesture: null }, 0.01);

		turnedBones.forEach((bone) => expect(turnOfBone(bone)).toBe(0));
		stage.draw({ ...resting, gesture: null }, 0.01);
		turnedBones.forEach((bone) => expect(turnOfBone(bone)).toBe(0));
	});

	it('shows the clip\'s turn of the trunk with the breath added on top', async () => {
		await startLoaded(holdTrack('spine', smallTurn));
		stage.draw(playing(holdSeconds / 2, 0), 0.01);
		const withClip = turnOfBone('spine');
		stage.draw({ ...resting, breath: 0, gesture: null }, 0.01);
		const withoutClip = turnOfBone('spine');
		const breath = 0.05;
		stage.draw(playing(holdSeconds / 2, breath), 0.01);

		expect(withClip - withoutClip).toBeCloseTo(smallTurn, 2);
		expect(turnOfBone('spine') - withClip).toBeCloseTo(breath, 3);
	});
});
