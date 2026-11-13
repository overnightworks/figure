import { describe, expect, it } from 'vitest';
import type { FigurePose, SpeakerOffset } from './figureMotion.js';
import { eyeJumpReach } from './idleMotion.js';
import { atSecond, blinkStartsOf, frameSeconds, idle, idleLife, speaking, speakerLeft, thinking, thinkingHead, thinkingLook, watch } from '../tests/figureMotionWatch.js';

describe('the figure motion\'s eyes', () => {
	describe('leading the head', () => {
		it.each([
			['yaw toward a speaker on the left', 'yaw', speakerLeft, -48, (-20 * Math.PI * 0.75) / 180, 0],
			['pitch toward a speaker above', 'pitch', { across: 0, down: -0.5 }, 21.6, (-9 * Math.PI * 0.55) / 180, 0.04]
		] as const)('has the look-at at 90 percent of its settled angle in %s while the head\'s turn is below half of its own', (_name, axis, speaker, settledLook, settledHead, leanPitch) => {
			const eyes = idleLife(100);
			const poses = watch(100, () => idle, false, () => speaker);
			const resting = watch(100, () => idle);
			const arrived = poses.findIndex((pose, frame) => (pose.look[axis] - eyes[frame]!.eyes[axis]) / settledLook >= 0.9);
			const lean = leanPitch * (1 - Math.exp(-3 * (arrived + 1) * frameSeconds));
			const turned = poses[arrived]!.head[axis] - resting[arrived]!.head[axis] - (axis === 'pitch' ? lean : 0);

			expect(arrived).toBeGreaterThanOrEqual(0);
			expect(turned / settledHead).toBeLessThan(0.5);
		});

		it('has the look-at at 90 percent of the thinking look while the head\'s turn is below half of its own, and the eyes without a jump', () => {
			const poses = watch(100, () => thinking);
			const resting = watch(100, () => idle);
			const arrived = poses.findIndex((pose) => pose.look.yaw / thinkingLook.yaw >= 0.9);

			expect(arrived).toBeGreaterThanOrEqual(0);
			expect((poses[arrived]!.head.yaw - resting[arrived]!.head.yaw) / thinkingHead.yaw).toBeLessThan(0.5);
		});

	});

	/** A speaker at the half viewport's edge to the right, and one near the middle: the gaze's goal shifts by 40 degrees and by 8. */
	const farSpeaker: SpeakerOffset = { across: 1, down: 0 };
	const nearSpeaker: SpeakerOffset = { across: 0.2, down: 0 };
	/** The blinks of a run as the first frame of each and the first frame after it. */
	function blinksOf(poses: FigurePose[]): { start: number; end: number }[] {
		return blinkStartsOf(poses).map((start) => ({ start, end: start + poses.slice(start).findIndex((pose) => pose.blink === 0) }));
	}
	/** The blinks of the idle figure and the first wait of more than 5 seconds from one blink to the next: `at(seconds)` is the frame that many seconds after the first of the two ended. */
	function quietMoment() {
		const blinks = blinksOf(watch(20000, () => idle));
		const wait = blinks.findIndex((blink, index) => index > 0 && (blink.start - blinks[index - 1]!.end) * frameSeconds > 5);
		return { blinks, wait, at: (secondsAfter: number) => blinks[wait - 1]!.end + Math.round(secondsAfter / frameSeconds) };
	}
	const speakerFrom = (from: number, speaker: SpeakerOffset) => (frame: number) => (frame >= from ? speaker : null);

	it('brings the next blink forward to a far shift of the gaze', () => {
		const { blinks, wait, at } = quietMoment();
		const from = at(2.5);
		const blinking = blinksOf(watch(blinks[wait]!.end + 100, () => idle, false, speakerFrom(from, farSpeaker)));

		expect(wait).toBeGreaterThan(0);
		expect(blinking[wait]!.start - from).toBeLessThanOrEqual(3);
		expect(blinking[wait]!.start).toBeLessThan(blinks[wait]!.start);
	});

	it('does not bring the next blink forward to a small shift of the gaze', () => {
		const { blinks, wait, at } = quietMoment();
		const length = blinks[wait]!.end + 100;

		expect(blinksOf(watch(length, () => idle, false, speakerFrom(at(2.5), nearSpeaker)))).toEqual(blinks.slice(0, wait + 1));
	});

	it('does not bring a blink forward sooner than 2 seconds after the last one ended, and not under reduced motion', () => {
		const { blinks, wait, at } = quietMoment();
		const length = blinks[wait]!.end + 100;
		const reducedBlinks = blinksOf(watch(length, () => idle, true));

		expect(blinksOf(watch(length, () => idle, false, speakerFrom(at(1), farSpeaker)))).toEqual(blinks.slice(0, wait + 1));
		expect(blinksOf(watch(length, () => idle, true, speakerFrom(at(2.5), farSpeaker)))).toEqual(reducedBlinks);
	});

	it('leaves 2 to 6 seconds between one blink and the next, though the speaker moves far every second', () => {
		const farLeftAndRight = (frame: number): SpeakerOffset => ({ across: Math.floor(frame / 100) % 2 === 0 ? -1 : 1, down: 0 });
		const blinks = blinksOf(watch(60000, () => idle, false, farLeftAndRight));

		expect(blinks.length).toBeGreaterThan(100);
		blinks.slice(1).forEach((blink, index) => {
			const gap = (blink.start - blinks[index]!.end) * frameSeconds;
			expect(gap).toBeGreaterThanOrEqual(2);
			expect(gap).toBeLessThanOrEqual(6 + frameSeconds);
		});
	});

	it('makes no second blink for a second far shift inside the 2 seconds after the brought-forward blink ended', () => {
		const { at } = quietMoment();
		const from = at(2.5);
		const shifted = (frame: number): SpeakerOffset => ({ across: frame < from + 100 ? 1 : -1, down: 0 });
		const blinks = blinksOf(watch(from + 150, () => idle, false, (frame) => (frame >= from ? shifted(frame) : null)));

		expect(blinks.filter((blink) => blink.start >= from)).toHaveLength(1);
	});

	it('jumps the eyes a little now and then while it listens, within their reach, and the head does not follow them', () => {
		const poses = watch(6000, () => idle, false, () => speakerLeft).slice(atSecond(10));
		const steps = poses.slice(1).map((pose, index) => ({ look: Math.abs(pose.look.yaw - poses[index]!.look.yaw), head: Math.abs(pose.head.yaw - poses[index]!.head.yaw) }));
		const jumping = steps.filter((step) => step.look > 0.2);

		expect(jumping.length).toBeGreaterThan(20);
		jumping.forEach((step) => expect(step.head).toBeLessThan(3e-4));
		poses.forEach((pose) => expect(Math.abs(pose.look.yaw + 48)).toBeLessThanOrEqual(eyeJumpReach.yaw + 1e-3));
	});

	it('holds the thinking look with no jump of the eyes', () => {
		const poses = watch(3000, () => thinking).slice(atSecond(3));

		poses.forEach((pose) => {
			expect(pose.look.yaw).toBeCloseTo(thinkingLook.yaw, 6);
			expect(pose.look.pitch).toBeCloseTo(thinkingLook.pitch, 6);
		});
	});

	it('jumps the eyes less while the agent speaks than at rest, and still a little', () => {
		const glances = idleLife(6000).map((pose) => pose.glance);
		const steady = (frame: number) => glances.slice(frame - 60, frame + 1).every((glance) => glance.yaw === glances[frame]!.yaw && glance.pitch === glances[frame]!.pitch);
		const deviation = (pose: FigurePose, frame: number) => Math.abs(pose.look.yaw - glances[frame]!.yaw * 2.4);
		const idling = watch(6000, () => idle);
		const speakingNow = watch(6000, () => speaking);
		const frames = idling.flatMap((pose, frame) => (frame >= 60 && steady(frame) && deviation(pose, frame) > 0.5 ? [frame] : []));

		expect(frames.length).toBeGreaterThan(100);
		frames.forEach((frame) => expect(deviation(speakingNow[frame]!, frame)).toBeLessThan(deviation(idling[frame]!, frame)));
		expect(frames.some((frame) => deviation(speakingNow[frame]!, frame) > 0.1)).toBe(true);
	});
});

