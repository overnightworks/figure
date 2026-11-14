import { describe, expect, it } from 'vitest';
import { boneClock, clipWeight, gestureClips, gestureLengthSeconds, isClipBone, lagSecondsOf, type ClipBone, type TurnKey } from './gestureClips.js';
import { figureGesture } from './gestures.js';

/** The seconds a weight is read at, per second of a clip, around the fades and between them. */
const weightSamples = 200;

describe.each(Object.values(figureGesture))('the clip of %s', (name) => {
	const clip = gestureClips[name];
	const tracks = Object.entries(clip.keys) as [ClipBone, readonly TurnKey[]][];

	it.each(tracks)('keys the track of %s in ascending time from 0 to the clip\'s duration', (_, keys) => {
		const times = keys.map(({ seconds }) => seconds);

		expect(times[0]).toBe(0);
		expect(times.at(-1)).toBe(clip.durationSeconds);
		times.slice(1).forEach((seconds, index) => expect(seconds).toBeGreaterThan(times[index]!));
	});

	it.each(tracks)('is in the same pose of %s at the end of the fade in and at the start of the fade out', (_, keys) => {
		const fadeInEnd = keys.find(({ seconds }) => seconds === clip.fadeSeconds.in);
		const fadeOutStart = keys.find(({ seconds }) => seconds === clip.durationSeconds - clip.fadeSeconds.out);

		expect(fadeInEnd).toBeDefined();
		expect(fadeOutStart?.turn).toEqual(fadeInEnd?.turn);
	});

	it('has a weight of exactly 0 at the start and the end and exactly 1 between the fades', () => {
		expect(clipWeight(clip, 0)).toBe(0);
		expect(clipWeight(clip, clip.durationSeconds)).toBe(0);
		expect(clipWeight(clip, clip.fadeSeconds.in)).toBe(1);
		expect(clipWeight(clip, clip.durationSeconds - clip.fadeSeconds.out)).toBe(1);
		expect(clipWeight(clip, (clip.fadeSeconds.in + clip.durationSeconds - clip.fadeSeconds.out) / 2)).toBe(1);
	});

	it('has a weight of 0 outside the clip and between 0 and 1 everywhere, rising through the fade in and falling through the fade out', () => {
		const clocks = Array.from({ length: weightSamples }, (_, sample) => -0.5 + ((clip.durationSeconds + 1) * sample) / (weightSamples - 1));
		const weights = clocks.map((clock) => clipWeight(clip, clock));

		weights.forEach((weight) => {
			expect(weight).toBeGreaterThanOrEqual(0);
			expect(weight).toBeLessThanOrEqual(1);
		});
		expect(clipWeight(clip, -0.1)).toBe(0);
		expect(clipWeight(clip, clip.durationSeconds + 0.1)).toBe(0);
		clocks.forEach((clock, index) => {
			if (index === 0) return;
			if (clock > 0 && clock <= clip.fadeSeconds.in) expect(weights[index]!).toBeGreaterThanOrEqual(weights[index - 1]!);
			if (clock >= clip.durationSeconds - clip.fadeSeconds.out && clock <= clip.durationSeconds) expect(weights[index]!).toBeLessThanOrEqual(weights[index - 1]!);
		});
	});

	it('has the upper arm ahead of the lower arm and that ahead of the hand during the rise, and the same order of ending', () => {
		const risen = (bone: ClipBone, gestureSeconds: number) => clipWeight(clip, boneClock(bone, gestureSeconds));
		const mid = clip.fadeSeconds.in / 2;
		const lateFall = gestureLengthSeconds(clip) - clip.fadeSeconds.out / 4;

		expect(risen('rightUpperArm', mid)).toBeGreaterThan(risen('rightLowerArm', mid));
		expect(risen('rightLowerArm', mid)).toBeGreaterThan(risen('rightHand', mid));
		expect(risen('rightUpperArm', lateFall)).toBeLessThan(risen('rightLowerArm', lateFall));
		expect(risen('rightLowerArm', lateFall)).toBeLessThan(risen('rightHand', lateFall));
	});

	it('is over for every bone, back at the base pose, when the gesture\'s length is reached', () => {
		clip.bones.forEach((bone) => expect(clipWeight(clip, boneClock(bone, gestureLengthSeconds(clip)))).toBe(0));
	});

	it('names exactly the bones it keys, and every one of them is a bone a clip owns', () => {
		expect([...clip.bones].sort()).toEqual(tracks.map(([bone]) => bone).sort());
		clip.bones.forEach((bone) => expect(isClipBone(bone)).toBe(true));
	});

	it('runs for its duration and the longest lag among its bones', () => {
		expect(gestureLengthSeconds(clip)).toBe(clip.durationSeconds + Math.max(...clip.bones.map(lagSecondsOf)));
	});
});

describe('the bones a clip owns', () => {
	const owned = ['leftShoulder', 'rightUpperArm', 'leftLowerArm', 'rightHand', 'leftThumbMetacarpal', 'rightIndexIntermediate', 'leftLittleDistal', 'spine', 'chest', 'upperChest'];

	it.each(owned)('includes %s', (bone) => {
		expect(isClipBone(bone)).toBe(true);
	});

	it.each(['head', 'neck', 'hips', 'leftUpperLeg', 'rightFoot', 'leftEye', 'jaw', 'constructor', 'toString', ''])('leaves out %s', (bone) => {
		expect(isClipBone(bone)).toBe(false);
	});

	it('lets the parts of a limb trail down the chain: the lower arm after the upper arm, the hand after the lower arm', () => {
		expect(lagSecondsOf('rightLowerArm')).toBeGreaterThan(lagSecondsOf('rightUpperArm'));
		expect(lagSecondsOf('rightHand')).toBeGreaterThan(lagSecondsOf('rightLowerArm'));
	});

	it.each(['Thumb', 'Index', 'Middle', 'Ring', 'Little'])('lets the fingers of the %s trail with their hand', (finger) => {
		expect(lagSecondsOf(`right${finger}Proximal` as ClipBone)).toBe(lagSecondsOf('rightHand'));
		expect(lagSecondsOf(`left${finger}Distal` as ClipBone)).toBe(lagSecondsOf('leftHand'));
	});

	it('lags both sides alike and leaves the shoulders and the trunk with the upper arm\'s clock', () => {
		expect(lagSecondsOf('leftLowerArm')).toBe(lagSecondsOf('rightLowerArm'));
		expect(lagSecondsOf('leftHand')).toBe(lagSecondsOf('rightHand'));
		(['leftShoulder', 'rightShoulder', 'spine', 'chest', 'upperChest'] as const).forEach((bone) => expect(lagSecondsOf(bone)).toBe(lagSecondsOf('rightUpperArm')));
	});
});
