import { describe, expect, it } from 'vitest';
import { createIdleMotion, eyeJumpReach, type IdlePose } from './idleMotion.js';

/** A small seeded source of numbers in [0, 1) (mulberry32), so a run is the same every time. */
function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
	};
}

const frameSeconds = 0.01;
const longRunSeconds = 1000;

/** The poses of a figure watched for `seconds`, one every 10 ms; the page asks for reduced motion in the frames `reducedFrom` selects, and the gaze shifts far before the frames `shiftsAt` selects. */
function watch(seed: number, seconds: number, reducedFrom: (frame: number) => boolean = () => false, shiftsAt: (frame: number) => boolean = () => false): IdlePose[] {
	const motion = createIdleMotion(seededRandom(seed));
	return Array.from({ length: Math.round(seconds / frameSeconds) }, (_, frame) => {
		if (shiftsAt(frame)) motion.blinkWithGazeShift();
		return motion.advance(frameSeconds, reducedFrom(frame));
	});
}

/** The first frame of each stretch of frames `isOn` holds for, and the first frame after it. */
function stretches(poses: readonly IdlePose[], isOn: (pose: IdlePose) => boolean): { start: number; end: number }[] {
	const found: { start: number; end: number }[] = [];
	let start: number | undefined;
	poses.forEach((pose, frame) => {
		if (isOn(pose) && start === undefined) start = frame;
		if (!isOn(pose) && start !== undefined) {
			found.push({ start, end: frame });
			start = undefined;
		}
	});
	return found;
}

/** Whether every part but the blink is at rest; a rotation of -0 is at rest. */
function isAtRest({ breath, sway, glance, eyes }: IdlePose): boolean {
	return [breath, sway.yaw, sway.pitch, sway.roll, glance.yaw, glance.pitch, eyes.yaw, eyes.pitch].every((value) => value === 0);
}

function seconds(frames: number): number {
	return frames * frameSeconds;
}

/** The frames a glance starts in: the first away from straight ahead after the glance looked straight ahead. */
function glanceStarts(poses: readonly IdlePose[]): number[] {
	const starts: number[] = [];
	let armed = true;
	poses.forEach((pose, frame) => {
		const straight = pose.glance.yaw === 0 && pose.glance.pitch === 0;
		if (armed && !straight) {
			starts.push(frame);
			armed = false;
		}
		if (straight) armed = true;
	});
	return starts;
}

function gaps(frames: readonly number[]): number[] {
	return frames.slice(1).map((frame, index) => seconds(frame - frames[index]!));
}

describe('the idle motion', () => {
	const seeds = [1, 2, 3];

	describe.each(seeds)('from the seed %s', (seed) => {
		it.each([
			['', false, 0.17],
			[' under reduced motion', true, 0.28]
		])('blinks%s with 2 to 6 seconds between one blink and the next, each blink taking its duration', (_name, reduced, duration) => {
			const blinks = stretches(
				watch(seed, longRunSeconds, () => reduced),
				(pose) => pose.blink > 0
			);

			expect(blinks.length).toBeGreaterThan(100);
			blinks.slice(1).forEach((blink, index) => {
				const gap = seconds(blink.start - blinks[index]!.end);
				expect(gap).toBeGreaterThanOrEqual(2);
				expect(gap).toBeLessThanOrEqual(6 + frameSeconds);
			});
			blinks.forEach((blink) => expect(Math.abs(seconds(blink.end - blink.start) - duration)).toBeLessThanOrEqual(2 * frameSeconds));
		});

		it('blinks with 2 to 6 seconds between one blink and the next while the gaze shifts far every second', () => {
			const blinks = stretches(
				watch(seed, longRunSeconds, () => false, (frame) => frame % 100 === 0),
				(pose) => pose.blink > 0
			);

			expect(blinks.length).toBeGreaterThan(100);
			blinks.slice(1).forEach((blink, index) => {
				const gap = seconds(blink.start - blinks[index]!.end);
				expect(gap).toBeGreaterThanOrEqual(2);
				expect(gap).toBeLessThanOrEqual(6 + frameSeconds);
			});
		});

		it('brings the next blink forward to a far shift of the gaze once 2 seconds have passed since the last blink, and not before', () => {
			const natural = stretches(watch(seed, 200), (pose) => pose.blink > 0);
			const wait = natural.findIndex((blink, index) => index > 0 && seconds(blink.start - natural[index - 1]!.end) > 5);
			const lastEnd = natural[wait - 1]!.end;
			const shiftAt = (secondsAfter: number) => (frame: number) => frame === lastEnd + Math.round(secondsAfter / frameSeconds);

			const early = stretches(watch(seed, 200, () => false, shiftAt(1)), (pose) => pose.blink > 0);
			const late = stretches(watch(seed, 200, () => false, shiftAt(2.5)), (pose) => pose.blink > 0);

			expect(wait).toBeGreaterThan(0);
			expect(early[wait]).toEqual(natural[wait]);
			expect(late[wait]!.start - (lastEnd + 250)).toBeLessThanOrEqual(1);
			expect(late[wait]!.start).toBeLessThan(natural[wait]!.start);
		});

		it('glances with 3 to 8 seconds between one glance and the next, and looks straight ahead before each', () => {
			const poses = watch(seed, longRunSeconds);
			const starts = glanceStarts(poses);

			expect(starts.length).toBeGreaterThan(100);
			gaps(starts).forEach((gap) => {
				expect(gap).toBeGreaterThanOrEqual(3 - 2 * frameSeconds);
				expect(gap).toBeLessThanOrEqual(8 + 2 * frameSeconds);
			});
			expect(Math.max(...poses.map((pose) => Math.abs(pose.glance.yaw)))).toBeGreaterThan(5);
		});

		it('makes small jumps of the eyes, each within its reach and 0.5 to 2.5 seconds after the last', () => {
			const poses = watch(seed, longRunSeconds);
			const jumps = poses.flatMap((pose, frame) => (frame > 0 && (pose.eyes.yaw !== poses[frame - 1]!.eyes.yaw || pose.eyes.pitch !== poses[frame - 1]!.eyes.pitch) ? [frame] : []));

			expect(jumps.length).toBeGreaterThan(300);
			gaps(jumps).forEach((gap) => {
				expect(gap).toBeGreaterThanOrEqual(0.5 - 2 * frameSeconds);
				expect(gap).toBeLessThanOrEqual(2.5 + 2 * frameSeconds);
			});
			expect(new Set(gaps(jumps).map((gap) => gap.toFixed(2))).size).toBeGreaterThan(50);
			poses.forEach(({ eyes }) => {
				expect(Math.abs(eyes.yaw)).toBeLessThanOrEqual(eyeJumpReach.yaw);
				expect(Math.abs(eyes.pitch)).toBeLessThanOrEqual(eyeJumpReach.pitch);
			});
			expect(Math.max(...poses.map((pose) => Math.abs(pose.eyes.yaw)))).toBeGreaterThan(eyeJumpReach.yaw / 2);
		});

		it('breathes and sways, so the pose varies over time', () => {
			const poses = watch(seed, 60);
			const range = (values: number[]) => Math.max(...values) - Math.min(...values);

			expect(range(poses.map((pose) => pose.breath))).toBeGreaterThan(0.04);
			expect(range(poses.map((pose) => pose.sway.yaw))).toBeGreaterThan(0.05);
		});

		it('keeps its blink and rests everything else under reduced motion', () => {
			const poses = watch(seed, 100, () => true);

			expect(poses.every(isAtRest)).toBe(true);
			expect(poses.some((pose) => pose.blink > 0)).toBe(true);
		});

		it('comes to rest at once when reduced motion is asked for and moves again when it is not', () => {
			const poses = watch(seed, 40, (frame) => frame >= 1000 && frame < 2000);

			expect(poses.slice(1000, 2000).every(isAtRest)).toBe(true);
			expect(poses.slice(2000).some((pose) => pose.breath !== 0)).toBe(true);
		});
	});

	it('counts a step longer than a tenth of a second as a tenth, so a page that was hidden does not jump', () => {
		const rested = createIdleMotion(seededRandom(7));
		const returned = createIdleMotion(seededRandom(7));

		expect(returned.advance(30, false)).toEqual(rested.advance(0.1, false));
	});

	it('gives two figures different phases of the breath', () => {
		const first = createIdleMotion(seededRandom(1)).advance(0, false);
		const second = createIdleMotion(seededRandom(2)).advance(0, false);

		expect(first.breath).not.toBe(second.breath);
	});
});
