import { describe, expect, it } from 'vitest';
import { atSecond, idle, speaking, thinking, thinkingAndSpeaking, watch } from '../tests/figureMotionWatch.js';

describe('the arms at rest', () => {
	it.each([
		['idle', idle],
		['speaking', speaking]
	])('lowers both upper arms about their forward axis, by 1.38 rad, the left one negative, when %s', (_, facts) => {
		const poses = watch(600, () => facts);

		poses.forEach(({ arms }) => {
			expect(arms.leftUpperArm.roll).toBeCloseTo(-1.38, 12);
			expect(arms.rightUpperArm.roll).toBeCloseTo(1.38, 12);
			expect(arms.leftUpperArm.yaw).toBe(0);
			expect(arms.rightUpperArm.yaw).toBe(0);
		});
	});

	it('turns the shoulders with the breath, the left up and the right down, by 0.012 rad at the top of a breath', () => {
		const poses = watch(1000, () => idle);
		const rises = poses.map(({ shoulders }) => shoulders.left.roll);

		expect(Math.max(...rises)).toBeCloseTo(0.012, 4);
		expect(Math.min(...rises)).toBeCloseTo(-0.012, 4);
		poses.forEach(({ shoulders }) => expect(shoulders.right.roll).toBeCloseTo(-shoulders.left.roll, 12));
	});

	it('swings the left upper arm about its x axis with the breath, by 0.01 rad at the top of a breath, and leaves the right one still', () => {
		const poses = watch(1000, () => idle);
		const swings = poses.map(({ arms }) => arms.leftUpperArm.pitch);

		expect(Math.max(...swings)).toBeCloseTo(0.01, 4);
		expect(Math.min(...swings)).toBeCloseTo(-0.01, 4);
		poses.forEach(({ arms }) => expect(arms.rightUpperArm.pitch).toBe(0));
	});

	it('holds the arms down under reduced motion, with the shoulders and the swing still, from the first frame', () => {
		const poses = watch(600, (frame) => (frame < 300 ? idle : speaking), true);

		poses.forEach(({ arms, shoulders }) => {
			expect(arms.leftUpperArm.roll).toBeCloseTo(-1.38, 12);
			expect(arms.rightUpperArm.roll).toBeCloseTo(1.38, 12);
			expect(shoulders.left.roll).toBeCloseTo(0, 12);
			expect(shoulders.right.roll).toBeCloseTo(0, 12);
			expect(arms.leftUpperArm.pitch).toBeCloseTo(0, 12);
		});
	});
});

describe('the right hand at the chin while the figure thinks', () => {
	const settledSeconds = 3;
	const restingArms = () => watch(1, () => idle, true)[0]!.arms;
	const settledThinkingArms = () => watch(atSecond(settledSeconds) + 1, () => thinking)[atSecond(settledSeconds)]!.arms;

	it('raises the right arm away from its rest once the thinking look has settled', () => {
		const [resting, settled] = [restingArms(), settledThinkingArms()];

		expect(settled.rightUpperArm).not.toEqual(resting.rightUpperArm);
		expect(settled.rightLowerArm).not.toEqual(resting.rightLowerArm);
	});

	it('moves the right arm monotonically from its rest to the settled pose as the thinking weight rises', () => {
		const poses = watch(atSecond(settledSeconds) + 1, () => thinking);
		const [resting, settled] = [restingArms(), settledThinkingArms()];
		const shareOf = (value: number, from: number, to: number) => (value - from) / (to - from);
		const lowerShares = poses.map(({ arms }) => shareOf(arms.rightLowerArm.yaw, resting.rightLowerArm.yaw, settled.rightLowerArm.yaw));
		const upperShares = poses.map(({ arms }) => shareOf(arms.rightUpperArm.pitch, resting.rightUpperArm.pitch, settled.rightUpperArm.pitch));

		lowerShares.forEach((share, frame) => {
			expect(share).toBeCloseTo(upperShares[frame]!, 9);
			if (frame > 0) expect(share).toBeGreaterThan(lowerShares[frame - 1]!);
		});
	});

	it.each([
		['with motion', false, atSecond(2 * settledSeconds)],
		['at the next frame under reduced motion', true, atSecond(settledSeconds)]
	])('returns the arms to rest once the figure stops thinking, %s', (_, reducedMotion, returnedFrame) => {
		const poses = watch(returnedFrame + 1, (frame) => (frame < atSecond(settledSeconds) ? thinking : idle), reducedMotion);
		const resting = restingArms();
		const returned = poses[returnedFrame]!.arms;

		expect(returned.rightUpperArm.roll).toBeCloseTo(resting.rightUpperArm.roll, 3);
		expect(returned.rightUpperArm.pitch).toBeCloseTo(resting.rightUpperArm.pitch, 3);
		expect(returned.rightLowerArm.yaw).toBeCloseTo(resting.rightLowerArm.yaw, 3);
	});

	it('shows the settled pose at the first frame under reduced motion', () => {
		const [first] = watch(1, () => thinking, true);
		const settled = settledThinkingArms();

		(['pitch', 'yaw', 'roll'] as const).forEach((angle) => {
			expect(first!.arms.rightUpperArm[angle]).toBeCloseTo(settled.rightUpperArm[angle], 3);
			expect(first!.arms.rightLowerArm[angle]).toBeCloseTo(settled.rightLowerArm[angle], 3);
		});
	});

	it('keeps the left arm as it is at rest', () => {
		const resting = watch(300, () => idle);

		watch(300, () => thinking).forEach((pose, frame) => expect(pose.arms.leftUpperArm).toEqual(resting[frame]!.arms.leftUpperArm));
	});

	it('lowers the hand when the agent speaks while the figure thinks, as speaking comes first', () => {
		const frames = atSecond(2 * settledSeconds) + 1;
		const poses = watch(frames, (frame) => (frame < atSecond(settledSeconds) ? thinking : thinkingAndSpeaking));
		const resting = restingArms();
		const lowered = poses[frames - 1]!.arms;

		expect(lowered.rightUpperArm.roll).toBeCloseTo(resting.rightUpperArm.roll, 3);
		expect(lowered.rightLowerArm.yaw).toBeCloseTo(resting.rightLowerArm.yaw, 3);
	});
});
