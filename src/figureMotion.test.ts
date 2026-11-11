import { describe, expect, it } from 'vitest';
import { createFigureMotion, type FigureFacts, type FigurePose } from './figureMotion.js';

/**
 * A source of chance that always gives 0.9: the first blink and glance are due at once, the glance is up and to the side (about 11
 * degrees of yaw, 6 of pitch) and the next one is 7.5 seconds after it began, so a run is the same every time.
 */
const alwaysNinetyPercent = () => 0.9;

const frameSeconds = 0.01;
const idle: FigureFacts = { thinking: false };
const thinking: FigureFacts = { thinking: true };

/** The picture's thinking look, in the units the pose uses: the gaze 18 degrees to the side and 13 up, the look-at turning 2.4 times that. */
const thinkingLook = { yaw: -43.2, pitch: 31.2 };
/** The head's turn at the picture's thinking look with the sway at rest: half the gaze's yaw plus 0.2 rad, 0.55 of its pitch plus 0.1 rad, and 0.16 rad of roll. */
const thinkingHead = { yaw: -0.357, pitch: -0.2248, roll: 0.16 };

/** The poses of a figure given `factsAt(frame)` for `frames` frames of 10 ms, while the page asks for reduced motion or not. */
function watch(frames: number, factsAt: (frame: number) => FigureFacts, reducedMotion = false): FigurePose[] {
	const motion = createFigureMotion(alwaysNinetyPercent);
	return Array.from({ length: frames }, (_, frame) => motion.advance(factsAt(frame), frameSeconds, reducedMotion));
}

function atSecond(seconds: number): number {
	return Math.round(seconds / frameSeconds) - 1;
}

describe('the figure motion', () => {
	it('shows the thinking look once the agent thinks, though the idle glance looks the other way', () => {
		const glancing = watch(20, () => idle);
		const poses = watch(1500, () => thinking);

		expect(glancing.at(-1)!.look.yaw).toBeGreaterThan(5);
		expect(poses.at(-1)!.look.yaw).toBeCloseTo(thinkingLook.yaw, 1);
		expect(poses.at(-1)!.look.pitch).toBeCloseTo(thinkingLook.pitch, 1);
	});

	it('eases the head into the thinking turn as the picture does, a share of 1 - e^(-4 t) after t seconds', () => {
		const resting = watch(300, () => idle);
		const poses = watch(300, () => thinking);

		[0.25, 0.5, 1].forEach((seconds) => {
			const share = 1 - Math.exp(-4 * seconds);
			const frame = atSecond(seconds);
			expect(poses[frame]!.head.roll - resting[frame]!.head.roll).toBeCloseTo(0.16 * share, 3);
			expect(poses[frame]!.head.pitch - resting[frame]!.head.pitch).toBeLessThan(0);
		});
	});

	it('turns the head by the picture\'s values once the look has settled, with the sway at rest', () => {
		const { head } = watch(2000, () => thinking, true).at(-1)!;

		expect(head.yaw).toBeCloseTo(thinkingHead.yaw, 3);
		expect(head.pitch).toBeCloseTo(thinkingHead.pitch, 3);
		expect(head.roll).toBeCloseTo(thinkingHead.roll, 3);
	});

	it('eases the gaze toward the thinking look and does not jump to it', () => {
		const looks = watch(300, () => thinking, false).map((pose) => pose.look.yaw);

		expect(looks[0]!).toBeGreaterThan(thinkingLook.yaw * 0.2);
		looks.slice(30).forEach((yaw, index) => expect(yaw).toBeLessThanOrEqual(looks[29 + index]! + 1e-9));
	});

	it('returns to the idle pose when the agent stops thinking, as if it had never thought', () => {
		const neverThought = watch(3000, () => idle);
		const thought = watch(3000, (frame) => (frame < 1000 ? thinking : idle));

		for (const key of ['look', 'head'] as const) {
			expect(thought.at(-1)![key].yaw).toBeCloseTo(neverThought.at(-1)![key].yaw, 3);
			expect(thought.at(-1)![key].pitch).toBeCloseTo(neverThought.at(-1)![key].pitch, 3);
		}
		expect(thought.at(-1)!.head.roll).toBeCloseTo(neverThought.at(-1)!.head.roll, 3);
	});

	it('suppresses the idle glance while thinking and glances again after', () => {
		const poses = watch(3000, (frame) => (frame < 1500 ? thinking : idle));
		const whileThinking = poses.slice(atSecond(3), 1500);
		const after = poses.slice(1500);

		whileThinking.forEach((pose) => expect(pose.look.yaw).toBeCloseTo(thinkingLook.yaw, 1));
		expect(after.some((pose) => pose.look.yaw > 5)).toBe(true);
	});

	it('blinks at 0.8 of its idle weight while thinking', () => {
		const peak = (poses: FigurePose[]) => Math.max(...poses.slice(0, 100).map((pose) => pose.blink));

		expect(peak(watch(100, () => idle))).toBeCloseTo(1, 1);
		expect(peak(watch(100, () => thinking))).toBeCloseTo(0.8, 1);
	});

	it('reaches the thinking pose at once under reduced motion, holds it, and leaves it at once', () => {
		const poses = watch(30, (frame) => (frame < 10 ? idle : frame < 20 ? thinking : idle), true);

		expect(poses[9]!.look.yaw).toBe(0);
		[10, 19].forEach((frame) => {
			expect(poses[frame]!.look.yaw).toBeCloseTo(thinkingLook.yaw, 6);
			expect(poses[frame]!.look.pitch).toBeCloseTo(thinkingLook.pitch, 6);
			expect(poses[frame]!.head.yaw).toBeCloseTo(thinkingHead.yaw, 3);
			expect(poses[frame]!.head.roll).toBeCloseTo(thinkingHead.roll, 6);
		});
		expect(poses[20]!.look.yaw).toBe(0);
		expect(poses[20]!.head.roll).toBe(0);
	});

	it('keeps breath, sway and glance off under reduced motion, thinking or not', () => {
		[idle, thinking].forEach((facts) => {
			const poses = watch(600, () => facts, true);

			expect(new Set(poses.slice(atSecond(2)).map((pose) => pose.breath))).toEqual(new Set([0]));
			expect(poses.slice(atSecond(2)).every((pose) => Math.abs(pose.head.yaw - poses.at(-1)!.head.yaw) < 1e-9)).toBe(true);
		});
	});

	it('blinks more slowly under reduced motion while thinking, as it does when idle', () => {
		const blinkSeconds = (poses: FigurePose[]) => poses.filter((pose) => pose.blink > 0).length * frameSeconds;

		expect(blinkSeconds(watch(100, () => thinking, true))).toBeGreaterThan(blinkSeconds(watch(100, () => thinking, false)) + 0.05);
	});

	it('does not restart the ease when the same fact is given again', () => {
		const given = watch(200, () => thinking);
		const motion = createFigureMotion(alwaysNinetyPercent);
		const again = Array.from({ length: 200 }, () => motion.advance({ thinking: true }, frameSeconds, false));

		expect(again).toEqual(given);
	});

	it('counts a step longer than a tenth of a second as a tenth, so a page that was hidden does not jump', () => {
		const stepped = createFigureMotion(alwaysNinetyPercent);
		const returned = createFigureMotion(alwaysNinetyPercent);

		expect(returned.advance(thinking, 30, false)).toEqual(stepped.advance(thinking, 0.1, false));
	});
});
