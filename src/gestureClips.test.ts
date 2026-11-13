import { describe, expect, it } from 'vitest';
import { boneClock, clipWeight, gestureClips, gestureLengthSeconds, type BoneTrack, type ClipBone } from './gestureClips.js';
import { figureGesture } from './gestures.js';

/** The seconds a weight is read at, per second of a clip, around the fades and between them. */
const weightSamples = 200;

describe.each(Object.values(figureGesture))('the clip of %s', (name) => {
	const clip = gestureClips[name];
	const tracks = Object.entries(clip.bones) as [ClipBone, BoneTrack][];

	it.each(tracks)('keys the track of %s in ascending time from 0 to the clip\'s duration', (_, track) => {
		const times = track.keys.map(({ seconds }) => seconds);

		expect(times[0]).toBe(0);
		expect(times.at(-1)).toBe(clip.durationSeconds);
		times.slice(1).forEach((seconds, index) => expect(seconds).toBeGreaterThan(times[index]!));
	});

	it.each(tracks)('holds the first pose of the track of %s through the fade in and the last through the fade out', (_, track) => {
		const first = track.keys[0]!;
		const last = track.keys.at(-1)!;

		track.keys.filter(({ seconds }) => seconds <= clip.fadeSeconds.in).forEach((key) => expect(key.turn).toEqual(first.turn));
		track.keys.filter(({ seconds }) => seconds >= clip.durationSeconds - clip.fadeSeconds.out).forEach((key) => expect(key.turn).toEqual(last.turn));
		expect(track.keys.some(({ seconds }) => seconds === clip.fadeSeconds.in)).toBe(true);
		expect(track.keys.some(({ seconds }) => seconds === clip.durationSeconds - clip.fadeSeconds.out)).toBe(true);
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
		const risen = (bone: ClipBone, gestureSeconds: number) => clipWeight(clip, boneClock(clip.bones[bone], gestureSeconds));
		const mid = clip.fadeSeconds.in / 2;
		const lateFall = gestureLengthSeconds(name) - clip.fadeSeconds.out / 4;

		expect(risen('rightUpperArm', mid)).toBeGreaterThan(risen('rightLowerArm', mid));
		expect(risen('rightLowerArm', mid)).toBeGreaterThan(risen('rightHand', mid));
		expect(risen('rightUpperArm', lateFall)).toBeLessThan(risen('rightLowerArm', lateFall));
		expect(risen('rightLowerArm', lateFall)).toBeLessThan(risen('rightHand', lateFall));
	});

	it('is over for every bone, back at the base pose, when the gesture\'s length is reached', () => {
		tracks.forEach(([, track]) => expect(clipWeight(clip, boneClock(track, gestureLengthSeconds(name)))).toBe(0));
	});
});
