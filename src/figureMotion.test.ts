import { describe, expect, it } from 'vitest';
import { figureMood, mouthShape, type FigureMood, type MouthShape } from './expressions.js';
import { eyeJumpReach } from './idleMotion.js';
import { createFigureMotion, spreadPosture, type FigureFacts, type FigurePose } from './figureMotion.js';
import { atSecond, frameSeconds, idle, seededRandom, seed, speaking, speakerLeft, thinking, thinkingAndSpeaking, thinkingHead, thinkingLook, watch } from '../tests/figureMotionWatch.js';
import type { VowelWeights } from './vowelWeights.js';

/** The turn the thinking look adds to the head, from the picture, in radians. */
const thinkingPosture = { yaw: -0.2, pitch: -0.1, roll: 0.16 };
/** The idle glance reaches 14 degrees of yaw and the look-at turns 2.4 times the gaze, so no glance looks further than this. */
const widestIdleLookYaw = 14 * 2.4;

/** The longest stretch, in seconds, the eyes stay closing in `poses`. */
function longestBlinkSeconds(poses: FigurePose[]): number {
	let longest = 0;
	let run = 0;
	poses.forEach((pose) => {
		run = pose.blink > 0 ? run + 1 : 0;
		longest = Math.max(longest, run);
	});
	return longest * frameSeconds;
}

/** The forward pitch of each pose's posture, in radians: a nod is all of it while the figure listens. */
function pitchesOf(poses: FigurePose[]): number[] {
	return poses.map((pose) => pose.posture.pitch);
}

/** The times, in seconds, of the frames where a nod's pitch rises from none: a nod starts on the frame before its first positive pitch. */
function nodStartsOf(pitches: number[]): number[] {
	return pitches.flatMap((pitch, frame) => (pitch > 0 && pitches[frame - 1] === 0 ? [(frame + 1) * frameSeconds] : []));
}

describe('the figure motion', () => {
	it('shows the thinking look once the agent thinks, though the idle glance looks elsewhere', () => {
		const glancing = watch(3000, () => idle);
		const poses = watch(1500, () => thinking);

		expect(glancing.some((pose) => Math.abs(pose.look.yaw) > 5)).toBe(true);
		expect(poses.at(-1)!.look.yaw).toBeCloseTo(thinkingLook.yaw, 1);
		expect(poses.at(-1)!.look.pitch).toBeCloseTo(thinkingLook.pitch, 1);
	});

	it('eases the head into the thinking turn as the picture does, a share of 1 - e^(-4 t) after t seconds', () => {
		const poses = watch(300, () => thinking);

		[0.25, 0.5, 1].forEach((seconds) => {
			const share = 1 - Math.exp(-4 * seconds);
			const { posture } = poses[atSecond(seconds)]!;
			expect(posture.yaw).toBeCloseTo(thinkingPosture.yaw * share, 3);
			expect(posture.pitch).toBeCloseTo(thinkingPosture.pitch * share, 3);
			expect(posture.roll).toBeCloseTo(thinkingPosture.roll * share, 3);
		});
	});

	it('turns the head by the picture\'s values once the look has settled, with the sway at rest', () => {
		const { head, posture } = watch(2000, () => thinking, true).at(-1)!;

		expect(head.yaw).toBeCloseTo(thinkingHead.yaw, 3);
		expect(head.pitch).toBeCloseTo(thinkingHead.pitch, 3);
		expect(head.roll).toBeCloseTo(thinkingHead.roll, 3);
		expect(posture.yaw).toBeCloseTo(thinkingPosture.yaw, 3);
		expect(posture.pitch).toBeCloseTo(thinkingPosture.pitch, 3);
		expect(posture.roll).toBeCloseTo(thinkingPosture.roll, 3);
	});

	it('eases the head toward the thinking gaze at 7 a second and does not jump to it, a share of 1 - e^(-7 t) after t seconds', () => {
		const resting = watch(100, () => idle);
		const poses = watch(100, () => thinking);

		[0.01, 0.25, 0.5, 1].forEach((seconds) => {
			const frame = atSecond(seconds);
			expect(poses[frame]!.head.yaw - resting[frame]!.head.yaw).toBeCloseTo(thinkingHead.yaw * (1 - Math.exp(-7 * seconds)), 6);
		});
	});

	it('returns to the idle look when the agent stops thinking: no posture and a gaze within the idle glance\'s reach', () => {
		const neverThought = watch(3000, () => idle);
		const thought = watch(3000, (frame) => (frame < 1000 ? thinking : idle));

		expect(thought.slice(atSecond(15)).every((pose) => Math.abs(pose.look.yaw) <= widestIdleLookYaw + eyeJumpReach.yaw + 1e-9)).toBe(true);
		expect(thought.at(-1)!.posture.yaw).toBeCloseTo(0, 3);
		expect(thought.at(-1)!.posture.pitch).toBeCloseTo(0, 3);
		expect(thought.at(-1)!.posture.roll).toBeCloseTo(0, 3);
		expect(thought.at(-1)!.head.roll).toBeCloseTo(neverThought.at(-1)!.head.roll, 3);
	});

	it('suppresses the idle glance while thinking and glances again after', () => {
		const poses = watch(3000, (frame) => (frame < 1500 ? thinking : idle));
		const whileThinking = poses.slice(atSecond(3), 1500);
		const after = poses.slice(1500);

		whileThinking.forEach((pose) => expect(pose.look.yaw).toBeCloseTo(thinkingLook.yaw, 1));
		expect(after.some((pose) => Math.abs(pose.look.yaw) > 5 && Math.abs(pose.look.yaw) <= widestIdleLookYaw + eyeJumpReach.yaw)).toBe(true);
	});

	it('blinks at 0.8 of its idle weight while thinking, starting at the same instants as when idle', () => {
		const idling = watch(6000, () => idle);
		const thought = watch(6000, () => thinking);

		expect(idling.some((pose) => pose.blink > 0.9)).toBe(true);
		thought.forEach((pose, frame) => expect(pose.blink).toBeCloseTo(idling[frame]!.blink * 0.8, 9));
	});

	it('reaches the thinking pose at once under reduced motion, holds it, and leaves it at once', () => {
		const poses = watch(30, (frame) => (frame < 10 ? idle : frame < 20 ? thinking : idle), true);

		expect(poses[9]!.look.yaw).toBe(0);
		[10, 19].forEach((frame) => {
			expect(poses[frame]!.look.yaw).toBeCloseTo(thinkingLook.yaw, 6);
			expect(poses[frame]!.look.pitch).toBeCloseTo(thinkingLook.pitch, 6);
			expect(poses[frame]!.head.yaw).toBeCloseTo(thinkingHead.yaw, 3);
			expect(poses[frame]!.posture.yaw).toBeCloseTo(thinkingPosture.yaw, 6);
			expect(poses[frame]!.posture.roll).toBeCloseTo(thinkingPosture.roll, 6);
		});
		expect(poses[20]!.look.yaw).toBe(0);
		expect(poses[20]!.posture.roll).toBe(0);
	});

	it('keeps breath, sway, glance and the eyes\' jumps off under reduced motion, thinking or not', () => {
		[idle, thinking].forEach((facts) => {
			const poses = watch(600, () => facts, true);

			expect(new Set(poses.slice(atSecond(2)).map((pose) => pose.look.yaw)).size).toBe(1);
			expect(new Set(poses.slice(atSecond(2)).map((pose) => pose.look.pitch)).size).toBe(1);
			expect(new Set(poses.slice(atSecond(2)).map((pose) => pose.breath))).toEqual(new Set([0]));
			expect(poses.slice(atSecond(2)).every((pose) => Math.abs(pose.head.yaw - poses.at(-1)!.head.yaw) < 1e-9)).toBe(true);
		});
	});

	it('blinks more slowly under reduced motion while thinking, as it does when idle', () => {
		expect(longestBlinkSeconds(watch(3000, () => thinking, true))).toBeGreaterThan(longestBlinkSeconds(watch(3000, () => thinking, false)) + 0.05);
	});

	it('does not restart the ease when the same fact is given again', () => {
		const given = watch(200, () => thinking);
		const motion = createFigureMotion(seededRandom(seed));
		const again = Array.from({ length: 200 }, () => motion.advance(thinking, frameSeconds, false, null, null));

		expect(again).toEqual(given);
	});

	it('counts a step longer than a tenth of a second as a tenth, so a page that was hidden does not jump', () => {
		const stepped = createFigureMotion(seededRandom(seed));
		const returned = createFigureMotion(seededRandom(seed));

		expect(returned.advance(thinking, 30, false, null, null)).toEqual(stepped.advance(thinking, 0.1, false, null, null));
	});

	it('keeps the idle motion recorded for the seed when the agent never thinks: its breath, head turn and blink at the same moments, though the eyes lead and jump on top', () => {
		const poses = watch(1650, () => idle);

		releasedIdle.forEach(({ frame, pose }) => {
			const drawn = poses[frame - 1]!;
			expect(drawn.breath).toBeCloseTo(pose.breath, 9);
			expect(drawn.blink).toBeCloseTo(pose.blink, 9);
			expect(drawn.head.yaw).toBeCloseTo(pose.head.yaw, 9);
			expect(drawn.head.pitch).toBeCloseTo(pose.head.pitch, 9);
			expect(drawn.head.roll).toBeCloseTo(pose.head.roll, 9);
			expect(Object.values(drawn.posture).every((turn) => turn === 0)).toBe(true);
		});
	});
});

describe('the figure motion while someone speaks', () => {
	it.each([
		['left', { across: -0.5, down: 0 }, { yaw: -48, pitch: 0 }],
		['right', { across: 0.25, down: 0 }, { yaw: 24, pitch: 0 }],
		['above', { across: 0, down: -0.5 }, { yaw: 0, pitch: 21.6 }],
		['below', { across: 0, down: 0.25 }, { yaw: 0, pitch: -10.8 }],
		['beyond the clamp to the right and below', { across: 7, down: 3 }, { yaw: 90, pitch: -43.2 }],
		['beyond the clamp to the left and above', { across: -2, down: -9 }, { yaw: -90, pitch: 43.2 }]
	])('turns the gaze toward a speaker %s by 40 degrees of yaw and 18 of pitch for the whole half viewport, and the look-at 2.4 times that up to 90 degrees', (_, speaker, look) => {
		const { look: settled } = watch(10, () => idle, true, () => speaker).at(-1)!;

		expect(settled.yaw).toBeCloseTo(look.yaw, 9);
		expect(settled.pitch).toBeCloseTo(look.pitch, 9);
	});

	it('turns the head by 0.75 of the gaze\'s yaw instead of 0.5, and by 0.55 of its pitch, with the sway at rest', () => {
		const { head } = watch(10, () => idle, true, () => ({ across: -0.5, down: -0.5 })).at(-1)!;

		expect(head.yaw).toBeCloseTo((-20 * Math.PI * 0.75) / 180, 9);
		expect(head.pitch).toBeCloseTo((-9 * Math.PI * 0.55) / 180 + 0.04, 9);
	});

	it('eases the head\'s yaw toward the speaker at 5 a second, a share of 1 - e^(-5 t) after t seconds', () => {
		const poses = watch(300, () => idle, false, () => speakerLeft);
		const resting = watch(300, () => idle);

		[0.25, 0.5, 1].forEach((seconds) => {
			const frame = atSecond(seconds);
			expect(resting[frame]!.look.yaw).toBeLessThanOrEqual(eyeJumpReach.yaw);
			expect(poses[frame]!.head.yaw - resting[frame]!.head.yaw).toBeCloseTo((-20 * Math.PI * 0.75 * (1 - Math.exp(-5 * seconds))) / 180, 6);
		});
	});

	it('eases the head\'s pitch toward the speaker at 6 a second as it does for any gaze, under the lean', () => {
		const poses = watch(100, () => idle, false, () => ({ across: 0, down: -0.5 }));
		const resting = watch(100, () => idle);
		const seconds = 0.5;
		const frame = atSecond(seconds);
		const lean = 0.04 * (1 - Math.exp(-3 * seconds));

		expect(poses[frame]!.head.pitch - resting[frame]!.head.pitch - lean).toBeCloseTo((-9 * Math.PI * 0.55 * (1 - Math.exp(-6 * seconds))) / 180, 6);
	});

	it('leans in at 3 a second: the head by 0.04 rad, the spine and the chest by 0.02 rad each at full weight', () => {
		const leaning = watch(1000, () => idle, true, () => speakerLeft);
		const eased = watch(300, () => idle, false, () => speakerLeft);
		const resting = watch(300, () => idle);

		expect(leaning[0]!.trunkLean).toBeCloseTo(0.02, 9);
		expect(leaning[0]!.head.pitch).toBeCloseTo(0.04, 9);
		[0.25, 0.5, 1].forEach((seconds) => {
			const frame = atSecond(seconds);
			const share = 1 - Math.exp(-3 * seconds);
			expect(eased[frame]!.trunkLean).toBeCloseTo(0.02 * share, 9);
			expect(eased[frame]!.head.pitch - resting[frame]!.head.pitch).toBeCloseTo(0.04 * share, 9);
		});
	});

	it('leans out at 3 a second and turns back when the speaker is gone', () => {
		const poses = watch(1000, () => idle, false, (frame) => (frame < 500 ? speakerLeft : null));

		const leanAtLeft = poses[499]!.trunkLean;
		expect(poses[atSecond(5.5)]!.trunkLean).toBeCloseTo(leanAtLeft * Math.exp(-3 * 0.5), 9);
		expect(poses.at(-1)!.trunkLean).toBeCloseTo(0, 3);
		expect(poses.at(-1)!.look.yaw).not.toBeCloseTo(-48, 0);
	});

	it('leaves the figure as it is when nobody speaks and no lean is asked', () => {
		const poses = watch(500, () => idle);

		expect(new Set(poses.map((pose) => pose.trunkLean))).toEqual(new Set([0]));
	});

	it('shows the thinking look over a speaker and the speaker again once the thinking ends', () => {
		const poses = watch(3000, (frame) => (frame < 1500 ? thinking : idle), true, () => speakerLeft);

		expect(poses[1499]!.look.yaw).toBeCloseTo(thinkingLook.yaw, 6);
		expect(poses[1499]!.look.pitch).toBeCloseTo(thinkingLook.pitch, 6);
		expect(poses[1499]!.head.yaw).toBeCloseTo(thinkingHead.yaw, 6);
		expect(poses[1499]!.trunkLean).toBeCloseTo(0, 3);
		expect(poses[1500]!.look.yaw).toBeCloseTo(-48, 6);
		expect(poses[1500]!.head.yaw).toBeCloseTo((-20 * Math.PI * 0.75) / 180, 6);
	});

	it('keeps a speaker given while the figure thinks until the thinking ends', () => {
		const poses = watch(200, (frame) => (frame < 100 ? thinking : idle), true, (frame) => (frame < 50 ? null : speakerLeft));

		expect(poses[99]!.look.yaw).toBeCloseTo(thinkingLook.yaw, 6);
		expect(poses[100]!.look.yaw).toBeCloseTo(-48, 6);
	});

	it('keeps the idle glance off while it listens, and breath, sway and blink going', () => {
		const idling = watch(6000, () => idle);
		const listening = watch(6000, () => idle, false, () => speakerLeft);

		expect(idling.some((pose) => Math.abs(pose.look.yaw) > 5)).toBe(true);
		listening.slice(atSecond(10)).forEach((pose) => expect(Math.abs(pose.look.yaw + 48)).toBeLessThanOrEqual(eyeJumpReach.yaw + 1e-3));
		listening.forEach((pose, frame) => expect(pose.breath).toBeCloseTo(idling[frame]!.breath, 12));
		expect(listening.findIndex((pose) => pose.blink > 0)).toBe(idling.findIndex((pose) => pose.blink > 0));
		expect(new Set(listening.slice(atSecond(10)).map((pose) => pose.head.roll)).size).toBeGreaterThan(100);
	});

	it('follows a speaker that moves, at the same easing, with no restart', () => {
		const poses = watch(400, () => idle, false, (frame) => (frame < 200 ? speakerLeft : { across: 0.5, down: 0 }));
		const fixedRight = watch(400, () => idle, false, () => ({ across: 0.5, down: 0 }));

		expect(poses[atSecond(3)]!.head.yaw - fixedRight[atSecond(3)]!.head.yaw).toBeCloseTo((0.75 * Math.PI * (-40 * Math.exp(-5 * 1))) / 180, 6);
	});

	it('reaches the turn and the lean at once under reduced motion, holds them, follows a moved speaker at once and leaves at once', () => {
		const poses = watch(40, () => idle, true, (frame) => (frame < 10 ? null : frame < 20 ? speakerLeft : frame < 30 ? { across: 0.5, down: 0.5 } : null));

		expect(poses[9]!.look.yaw).toBe(0);
		expect(poses[9]!.trunkLean).toBe(0);
		[10, 19].forEach((frame) => {
			expect(poses[frame]!.look.yaw).toBeCloseTo(-48, 9);
			expect(poses[frame]!.trunkLean).toBeCloseTo(0.02, 9);
			expect(poses[frame]!.head.pitch).toBeCloseTo(0.04, 9);
		});
		[20, 29].forEach((frame) => {
			expect(poses[frame]!.look.yaw).toBeCloseTo(48, 9);
			expect(poses[frame]!.look.pitch).toBeCloseTo(-21.6, 9);
		});
		expect(poses[30]!.look.yaw).toBe(0);
		expect(poses[30]!.trunkLean).toBe(0);
	});

	it('does not restart the ease when the same speaker is given again', () => {
		const given = watch(200, () => idle, false, () => speakerLeft);
		const motion = createFigureMotion(seededRandom(seed));
		const again = Array.from({ length: 200 }, () => motion.advance(idle, frameSeconds, false, { across: -0.5, down: 0 }, null));

		expect(again).toEqual(given);
	});

	it('nods every 2.5 to 5 seconds while it listens, the first at the first frame it listens', () => {
		const starts = nodStartsOf(pitchesOf(watch(6000, () => idle, false, () => speakerLeft)));

		expect(starts[0]).toBeCloseTo(2 * frameSeconds, 9);
		const gaps = starts.slice(1).map((start, index) => start - starts[index]!);
		expect(gaps.length).toBeGreaterThan(10);
		gaps.forEach((gap) => {
			expect(gap).toBeGreaterThanOrEqual(2.5 - 1e-9);
			expect(gap).toBeLessThan(5 + frameSeconds);
		});
	});

	it('holds each nod for 0.9 seconds, its forward pitch a half sine peaking at 0.09 rad in the middle', () => {
		const pitches = pitchesOf(watch(300, () => idle, false, () => speakerLeft));
		const begin = pitches.findIndex((pitch) => pitch > 0);
		const end = pitches.indexOf(0, begin);
		const nod = pitches.slice(begin, end);
		const peak = Math.max(...nod);

		expect((end - begin) * frameSeconds).toBeGreaterThanOrEqual(0.88);
		expect((end - begin) * frameSeconds).toBeLessThanOrEqual(0.91);
		expect(peak).toBeCloseTo(0.09, 4);
		expect(Math.abs(nod.indexOf(peak) * frameSeconds - 0.45)).toBeLessThan(frameSeconds + 1e-9);
	});

	it('gives the neck 0.4 of a nod and the head the rest, and the head all of it where the model has no neck', () => {
		const peak = watch(300, () => idle, false, () => speakerLeft).reduce((highest, pose) => (pose.posture.pitch > highest.posture.pitch ? pose : highest));

		expect(spreadPosture(peak.posture, { neck: true, chest: true }).neck.pitch).toBeCloseTo(0.4 * 0.09, 4);
		expect(spreadPosture(peak.posture, { neck: true, chest: true }).head.pitch).toBeCloseTo(0.6 * 0.09, 4);
		expect(spreadPosture(peak.posture, { neck: false, chest: false }).head.pitch).toBeCloseTo(0.09, 4);
	});

	it('never nods under reduced motion, though it listens', () => {
		const pitches = pitchesOf(watch(6000, () => idle, true, () => speakerLeft));

		expect(new Set(pitches)).toEqual(new Set([0]));
	});

	it('never nods while it thinks or while nobody speaks', () => {
		const thinkingAlone = pitchesOf(watch(3000, () => thinking));
		const thinkingListening = pitchesOf(watch(3000, () => thinking, false, () => speakerLeft));
		const idleAlone = pitchesOf(watch(3000, () => idle));

		expect(thinkingListening).toEqual(thinkingAlone);
		expect(new Set(idleAlone)).toEqual(new Set([0]));
	});

	it('cuts a nod under way when listening ends, and does not resume it when listening comes back', () => {
		const pitches = pitchesOf(watch(400, () => idle, false, (frame) => (frame < 30 || frame >= 40 ? speakerLeft : null)));

		expect(pitches[29]!).toBeGreaterThan(0);
		expect(pitches.slice(30, 40)).toEqual(new Array(10).fill(0));
		expect(pitches.slice(40, 250)).toEqual(new Array(210).fill(0));
	});

	it.each([
		[0, 2.5],
		[0.999999, 5]
	])('takes the gap between nods from the source of chance: a source giving %s gaps of %s seconds', (share, gap) => {
		const motion = createFigureMotion(() => share);
		const starts = nodStartsOf(Array.from({ length: 6000 }, () => motion.advance(idle, frameSeconds, false, speakerLeft, null).posture.pitch));

		expect(starts[1]! - starts[0]!).toBeCloseTo(gap, 1);
	});
});

describe('the figure motion while the agent speaks', () => {
	const stillMouth: VowelWeights = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
	const shapes = Object.values(mouthShape);
	/** Full weight on one shape, and nothing on the others. */
	const only = (shape: MouthShape): VowelWeights => ({ ...stillMouth, [shape]: 1 });
	const aa = only(mouthShape.aa);
	/** The head's forward pitch the voice adds: the pose of the mouth followed minus that of the same facts with a still mouth. */
	const voiceNod = (followed: FigurePose[], still: FigurePose[]) => followed.map((pose, frame) => pose.head.pitch - still[frame]!.head.pitch);

	it('shows the idle glance and no thinking look, lean or nod while it speaks, though it thinks and someone speaks to it', () => {
		const idling = watch(3000, () => idle);
		const speakingOverAll = watch(3000, () => thinkingAndSpeaking, false, () => speakerLeft);

		speakingOverAll.forEach((pose, frame) => {
			expect(Math.abs(pose.look.yaw - idling[frame]!.look.yaw)).toBeLessThanOrEqual(eyeJumpReach.yaw * 1.4);
			expect(pose.posture).toEqual(idling[frame]!.posture);
			expect(pose.trunkLean).toBe(0);
			expect(pose.blink).toBe(idling[frame]!.blink);
			expect(pose.head).toEqual(idling[frame]!.head);
		});
	});

	it('shows thinking over listening when the speaking ends, and listening once the thinking ends, in that order and at once under reduced motion', () => {
		const bothFacts = (frame: number) => (frame < 10 ? thinkingAndSpeaking : frame < 20 ? thinking : idle);
		const poses = watch(30, bothFacts, true, () => speakerLeft);

		expect(poses[9]!.look.yaw).toBe(0);
		expect(poses[9]!.posture.roll).toBe(0);
		expect(poses[10]!.look.yaw).toBeCloseTo(thinkingLook.yaw, 6);
		expect(poses[10]!.posture.roll).toBeCloseTo(thinkingPosture.roll, 6);
		expect(poses[20]!.look.yaw).toBeCloseTo(-48, 6);
		expect(poses[20]!.posture.roll).toBe(0);
		expect(poses[20]!.trunkLean).toBeCloseTo(0.02, 9);
	});

	it('shows a listening figure back after the speaking ends, with its nods', () => {
		const pitches = pitchesOf(watch(400, (frame) => (frame < 100 ? speaking : idle), false, () => speakerLeft));

		expect(new Set(pitches.slice(0, 100))).toEqual(new Set([0]));
		expect(pitches.slice(100).some((pitch) => pitch > 0)).toBe(true);
	});

	it.each(shapes)('eases the weight of %s up at 38 a second: a share of 1 - e^(-38 t) after t seconds', (shape) => {
		const poses = watch(100, () => speaking, false, () => null, () => only(shape));

		[0.01, 0.03, 0.1].forEach((seconds) => {
			expect(poses[atSecond(seconds)]!.mouth[shape]).toBeCloseTo(1 - Math.exp(-38 * seconds), 9);
		});
		shapes.filter((other) => other !== shape).forEach((other) => expect(poses[50]!.mouth[other]).toBe(0));
	});

	it.each(shapes)('eases the weight of %s down at 22 a second once the voice falls silent: a share of e^(-22 t) is left after t seconds', (shape) => {
		const poses = watch(300, () => speaking, false, () => null, (frame) => (frame < 100 ? only(shape) : null));

		expect(poses[99]!.mouth[shape]).toBeCloseTo(1, 9);
		[0.01, 0.05, 0.2].forEach((seconds) => {
			expect(poses[99 + Math.round(seconds / frameSeconds)]!.mouth[shape]).toBeCloseTo(Math.exp(-22 * seconds), 9);
		});
	});

	it('lets all five weights fall to zero at the falling rate when the speaking stops, though weights are still given', () => {
		const everything: VowelWeights = { aa: 0.4, ih: 0.3, ou: 0.1, ee: 0.1, oh: 0.1 };
		const poses = watch(300, (frame) => (frame < 100 ? speaking : idle), false, () => null, () => everything);

		shapes.forEach((shape) => {
			expect(poses[99]!.mouth[shape]).toBeCloseTo(everything[shape], 9);
			expect(poses[109]!.mouth[shape]).toBeCloseTo(everything[shape] * Math.exp(-22 * 0.1), 9);
		});
		expect(Math.max(...Object.values(poses[299]!.mouth))).toBeLessThan(1e-9);
	});

	it('eases a weight up and another down in one frame, each at its own rate', () => {
		const poses = watch(200, () => speaking, false, () => null, (frame) => (frame < 100 ? only(mouthShape.aa) : only(mouthShape.oh)));

		expect(poses[99]!.mouth.aa).toBeCloseTo(1, 9);
		expect(poses[109]!.mouth.aa).toBeCloseTo(Math.exp(-22 * 0.1), 9);
		expect(poses[109]!.mouth.oh).toBeCloseTo(1 - Math.exp(-38 * 0.1), 9);
	});

	it('keeps the mouth still while it speaks with no weights, and for weights given while it does not speak', () => {
		const withoutWeights = watch(200, () => speaking);
		const notSpeaking = watch(200, () => idle, false, () => null, () => aa);

		[...withoutWeights, ...notSpeaking].forEach((pose) => expect(pose.mouth).toEqual(stillMouth));
	});

	it('does not nod with the voice while the mouth is still', () => {
		const still = watch(500, () => speaking);
		const silentWeights = watch(500, () => speaking, false, () => null, () => stillMouth);

		expect(silentWeights).toEqual(still);
	});

	it('nods the head with the voice by the level times 0.045 rad times sin(5.1 t) on its pitch, the level being the weights\' sum up to 1', () => {
		const still = watch(500, () => speaking);
		const followed = watch(500, () => speaking, false, () => null, () => aa);
		const nod = voiceNod(followed, still);

		nod.slice(atSecond(2)).forEach((pitch, index) => {
			const second = (atSecond(2) + index + 1) * frameSeconds;
			expect(pitch).toBeCloseTo(0.045 * Math.sin(5.1 * second), 6);
		});
	});

	it('scales the nod by the sum of the weights, and caps the level at 1', () => {
		const still = watch(500, () => speaking);
		const half = voiceNod(watch(500, () => speaking, false, () => null, () => ({ ...stillMouth, aa: 0.3, ih: 0.2 })), still);
		const beyond = voiceNod(watch(500, () => speaking, false, () => null, () => ({ ...stillMouth, aa: 1, ih: 1, oh: 1 })), still);

		expect(Math.max(...half.slice(atSecond(2)))).toBeCloseTo(0.5 * 0.045, 3);
		expect(Math.max(...beyond.slice(atSecond(2)))).toBeCloseTo(0.045, 3);
	});

	it('eases the level at 12 a second toward the sum of the eased weights', () => {
		const still = watch(30, () => speaking);
		const followed = watch(30, () => speaking, false, () => null, () => aa);
		const second = 0.1;
		const level = voiceNod(followed, still)[atSecond(second)]! / (0.045 * Math.sin(5.1 * second));
		const expected = 1 - (38 * Math.exp(-12 * second) - 12 * Math.exp(-38 * second)) / 26;

		expect(level).toBeCloseTo(expected, 1);
	});

	it('lets the nod die away once the voice falls silent', () => {
		const still = watch(600, () => speaking);
		const nod = voiceNod(watch(600, () => speaking, false, () => null, (frame) => (frame < 300 ? aa : null)), still);

		expect(Math.max(...nod.slice(250, 300).map(Math.abs))).toBeGreaterThan(0.04);
		expect(Math.max(...nod.slice(500).map(Math.abs))).toBeLessThan(1e-6);
	});

	it('reaches the weights at once under reduced motion and leaves them at once, with no nod', () => {
		const everything: VowelWeights = { aa: 0.4, ih: 0.3, ou: 0.1, ee: 0.1, oh: 0.1 };
		const still = watch(30, () => speaking, true);
		const poses = watch(30, () => speaking, true, () => null, (frame) => (frame < 10 || frame >= 20 ? null : everything));

		expect(poses[9]!.mouth).toEqual(stillMouth);
		[10, 19].forEach((frame) => expect(poses[frame]!.mouth).toEqual(everything));
		expect(poses[20]!.mouth).toEqual(stillMouth);
		poses.forEach((pose, frame) => expect(pose.head.pitch).toBe(still[frame]!.head.pitch));
	});
});

describe('the figure motion while the agent speaks a mood', () => {
	const moods = Object.values(figureMood);
	const speakingMood = (mood: FigureMood): FigureFacts => ({ ...speaking, mood });
	/** The weight a mood reaches, read from the pose that reduced motion gives at once: the peak the easing goes toward. */
	const peakOf = (mood: FigureMood): number => watch(1, () => speakingMood(mood), true)[0]!.mood[mood];
	/** What a pose adds to the posture over the same frame of a figure speaking with no mood: the head's pitch and roll, the chest's trunk and the left shoulder's roll. */
	const leanOf = (pose: FigurePose, plain: FigurePose) => ({ pitch: pose.posture.pitch - plain.posture.pitch, roll: pose.posture.roll - plain.posture.roll, spine: pose.moodTrunk.spine, chest: pose.moodTrunk.chest, shoulder: pose.arms.leftShoulder.roll - plain.arms.leftShoulder.roll });
	/** What a mood at its peak leans the posture by, as reduced motion reaches it at once. */
	const fullLean = (mood: FigureMood) => leanOf(watch(1, () => speakingMood(mood), true)[0]!, watch(1, () => speaking, true)[0]!);
	const noMood: Record<FigureMood, number> = { happy: 0, angry: 0, sad: 0, relaxed: 0, surprised: 0 };
	const aa: VowelWeights = { aa: 1, ih: 0, ou: 0, ee: 0, oh: 0 };
	const mixedMouth: VowelWeights = { aa: 0.9, ih: 0.3, ou: 0.5, ee: 0.2, oh: 0.7 };
	const stillMouthWeights: VowelWeights = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };

	it.each(moods)('eases the weight of %s up to its peak at 9 a second: a share of 1 - e^(-9 t) of the peak after t seconds', (mood) => {
		const poses = watch(100, () => speakingMood(mood));
		const peak = peakOf(mood);

		expect(peak).toBeGreaterThan(0.5);
		expect(peak).toBeLessThanOrEqual(1);
		[0.01, 0.05, 0.2].forEach((seconds) => {
			expect(poses[atSecond(seconds)]!.mood[mood]).toBeCloseTo(peak * (1 - Math.exp(-9 * seconds)), 9);
		});
		moods.filter((other) => other !== mood).forEach((other) => expect(poses[99]!.mood[other]).toBe(0));
	});

	it.each(moods)('eases the weight of %s down at 4 a second once the agent stops: a share of e^(-4 t) is left after t seconds', (mood) => {
		const poses = watch(600, (frame) => (frame < 300 ? speakingMood(mood) : { ...idle, mood }));
		const peak = poses[299]!.mood[mood];

		expect(peak).toBeCloseTo(peakOf(mood), 9);
		[0.1, 0.5, 1].forEach((seconds) => {
			expect(poses[299 + Math.round(seconds / frameSeconds)]!.mood[mood]).toBeCloseTo(peak * Math.exp(-4 * seconds), 9);
		});
	});

	it('shows no mood while the agent does not speak, though a mood is given, and none for a sentence without one', () => {
		[watch(300, () => ({ ...idle, mood: 'happy' })), watch(300, () => speaking)].forEach((poses) => poses.forEach((pose) => expect(pose.mood).toEqual(noMood)));
	});

	it('shows a mood while it thinks, since speaking wins', () => {
		expect(watch(300, () => ({ ...thinkingAndSpeaking, mood: 'sad' }))[299]!.mood.sad).toBeCloseTo(peakOf('sad'), 9);
	});

	it('cross-fades to another mood: the first falls at 4 a second while the second rises at 9', () => {
		const poses = watch(400, (frame) => speakingMood(frame < 200 ? 'happy' : 'angry'));
		const settled = poses[199]!.mood.happy;

		[0.05, 0.2].forEach((seconds) => {
			const pose = poses[199 + Math.round(seconds / frameSeconds)]!;
			expect(pose.mood.happy).toBeCloseTo(settled * Math.exp(-4 * seconds), 9);
			expect(pose.mood.angry).toBeCloseTo(peakOf('angry') * (1 - Math.exp(-9 * seconds)), 3);
		});
	});

	it('fades a mood the next sentence leaves out', () => {
		const poses = watch(400, (frame) => (frame < 200 ? speakingMood('happy') : speaking));

		expect(poses[399]!.mood.happy).toBeCloseTo(poses[199]!.mood.happy * Math.exp(-4 * 2), 9);
	});

	it('multiplies every mouth weight by 0.72 while a mood is above 0.05 and by 1 while none is', () => {
		const withMood = watch(500, (frame) => (frame < 100 ? speakingMood('happy') : speaking), false, () => null, () => mixedMouth);
		const plain = watch(500, () => speaking, false, () => null, () => mixedMouth);
		const shown = withMood.map((pose) => Math.max(...Object.values(pose.mood)) > 0.05);

		expect(shown).toContain(true);
		expect(shown).toContain(false);
		Object.values(mouthShape).forEach((shape) => {
			expect(plain[99]!.mouth[shape]).toBeGreaterThan(0.1);
			withMood.forEach((pose, frame) => expect(pose.mouth[shape]).toBeCloseTo(plain[frame]!.mouth[shape] * (shown[frame] ? 0.72 : 1), 12));
		});
	});

	it('keeps the mouth still when a mood has no voice', () => {
		const poses = watch(200, () => speakingMood('happy'));

		poses.forEach((pose) => expect(pose.mouth).toEqual(stillMouthWeights));
		expect(poses[199]!.mood.happy).toBeGreaterThan(0.8);
	});

	it('leaves the voice\'s nod as the eased weights give it, whatever the mood', () => {
		const plain = watch(300, () => speaking, false, () => null, () => aa);
		const withMood = watch(300, () => speakingMood('sad'), false, () => null, () => aa);

		withMood.forEach((pose, frame) => expect(pose.head.pitch).toBe(plain[frame]!.head.pitch));
	});

	it.each(moods)('leans the posture at once under reduced motion by the whole lean of %s: the trunk forward with the chest taking the larger part, the shoulders mirrored, no turn', (mood) => {
		const [[pose], [plain]] = [watch(1, () => speakingMood(mood), true), watch(1, () => speaking, true)];
		const lean = leanOf(pose!, plain!);

		expect(pose!.mood[mood]).toBe(peakOf(mood));
		expect(pose!.posture.yaw).toBeCloseTo(plain!.posture.yaw, 12);
		expect(pose!.arms.rightShoulder.roll - plain!.arms.rightShoulder.roll).toBeCloseTo(-lean.shoulder, 12);
		expect(lean.spine * lean.chest).toBeGreaterThanOrEqual(0);
		expect(Math.abs(lean.chest)).toBeGreaterThanOrEqual(Math.abs(lean.spine));
	});

	it('leans the posture differently for each mood', () => {
		const leans = moods.map((mood) => Object.values(fullLean(mood)));

		leans.forEach((lean, index) => leans.slice(index + 1).forEach((other) => expect(Math.max(...lean.map((part, at) => Math.abs(part - other[at]!)))).toBeGreaterThan(0.01)));
	});

	it.each(moods)('leans the posture by the share of the weight of %s over its peak while it rises', (mood) => {
		const pose = watch(10, () => speakingMood(mood))[9]!;
		const share = pose.mood[mood] / peakOf(mood);
		const [full, lean] = [fullLean(mood), leanOf(pose, watch(10, () => speaking)[9]!)];

		expect(share).toBeCloseTo(1 - Math.exp(-9 * 0.1), 9);
		(Object.keys(full) as (keyof typeof full)[]).forEach((part) => expect(lean[part]).toBeCloseTo(full[part] * share, 9));
	});

	it('adds the lean of two moods by their shares while one replaces the other', () => {
		const [plain, pose] = [watch(210, () => speaking)[209]!, watch(210, (frame) => speakingMood(frame < 200 ? 'happy' : 'angry'))[209]!];
		const [happyShare, angryShare] = [pose.mood.happy / peakOf('happy'), pose.mood.angry / peakOf('angry')];
		const [happy, angry] = [fullLean('happy'), fullLean('angry')];
		const lean = leanOf(pose, plain);

		expect(Math.min(happyShare, angryShare)).toBeGreaterThan(0.1);
		(Object.keys(lean) as (keyof typeof lean)[]).forEach((part) => expect(lean[part]).toBeCloseTo(happy[part] * happyShare + angry[part] * angryShare, 9));
	});

	it('leaves the posture and the shoulders as they are with no mood', () => {
		const idling = watch(300, () => idle);

		watch(300, () => speaking).forEach((pose, frame) => {
			expect(pose.posture).toEqual(idling[frame]!.posture);
			expect(pose.arms).toEqual(idling[frame]!.arms);
			expect(pose.moodTrunk).toEqual({ spine: 0, chest: 0 });
		});
	});

	it('reaches a mood at once under reduced motion, holds it, swaps it at once and leaves at once', () => {
		const poses = watch(40, (frame) => (frame < 10 ? speaking : frame < 20 ? speakingMood('happy') : frame < 30 ? speakingMood('angry') : { ...idle, mood: 'angry' }), true);

		expect(poses[9]!.mood).toEqual(noMood);
		[10, 19].forEach((frame) => expect(poses[frame]!.mood).toEqual({ ...noMood, happy: peakOf('happy') }));
		[20, 29].forEach((frame) => expect(poses[frame]!.mood).toEqual({ ...noMood, angry: peakOf('angry') }));
		expect(poses[30]!.mood).toEqual(noMood);
	});

	it('multiplies the mouth by 0.72 from the first frame of a mood under reduced motion and by 1 once it is gone', () => {
		const poses = watch(30, (frame) => (frame < 10 || frame >= 20 ? speaking : speakingMood('happy')), true, () => null, () => mixedMouth);

		Object.values(mouthShape).forEach((shape) => {
			expect(poses[9]!.mouth[shape]).toBe(mixedMouth[shape]);
			expect(poses[10]!.mouth[shape]).toBeCloseTo(mixedMouth[shape] * 0.72, 12);
			expect(poses[20]!.mouth[shape]).toBe(mixedMouth[shape]);
		});
	});

	it.each([['a name that is no mood', 'furious'], ['a name from the prototype chain', 'toString'], ['a number', 7], ['an object', { happy: true }], ['null', null]])(
		'shows no mood and leaves the mouth whole for %s',
		(_, unknown) => {
			const facts = { ...speaking, mood: unknown } as unknown as FigureFacts;
			const unknownMood = watch(300, () => facts, false, () => null, () => aa);
			const plain = watch(300, () => speaking, false, () => null, () => aa);

			unknownMood.forEach((pose, frame) => {
				expect(pose.mood).toEqual(noMood);
				expect(pose.mouth).toEqual(plain[frame]!.mouth);
			});
		}
	);
});

describe('the spread of a posture turn', () => {
	const posture = { yaw: -0.2, pitch: -0.1, roll: 0.16 };

	it.each([
		['neck and chest', { neck: true, chest: true }],
		['a neck alone', { neck: true, chest: false }],
		['a chest alone', { neck: false, chest: true }],
		['neither', { neck: false, chest: false }]
	])('adds up to the posture on a model with %s, so the head turns as far as the posture says', (_, bones) => {
		const { head, neck, chest } = spreadPosture(posture, bones);

		expect(head.yaw + neck.yaw + chest.yaw).toBeCloseTo(posture.yaw, 12);
		expect(head.pitch + neck.pitch + chest.pitch).toBeCloseTo(posture.pitch, 12);
		expect(head.roll + neck.roll + chest.roll).toBeCloseTo(posture.roll, 12);
	});

	it('gives the head the whole posture where the model has neither neck nor chest', () => {
		expect(spreadPosture(posture, { neck: false, chest: false }).head).toEqual(posture);
	});

	it('turns the neck by 0.4 and the chest by 0.15 of the yaw as the picture does', () => {
		const { neck, chest } = spreadPosture(posture, { neck: true, chest: true });

		expect(neck.yaw).toBeCloseTo(-0.08, 12);
		expect(chest.yaw).toBeCloseTo(-0.03, 12);
	});

	it('leaves every bone at rest when the posture is', () => {
		const rest = { yaw: 0, pitch: 0, roll: 0 };

		expect(spreadPosture(rest, { neck: true, chest: true })).toEqual({ head: rest, neck: rest, chest: rest });
	});
});

describe('the arms at rest', () => {
	it.each([
		['idle', idle],
		['thinking', thinking]
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
		const rises = poses.map(({ arms }) => arms.leftShoulder.roll);

		expect(Math.max(...rises)).toBeCloseTo(0.012, 4);
		expect(Math.min(...rises)).toBeCloseTo(-0.012, 4);
		poses.forEach(({ arms }) => expect(arms.rightShoulder.roll).toBeCloseTo(-arms.leftShoulder.roll, 12));
	});

	it('swings the left upper arm about its x axis with the breath, by 0.01 rad at the top of a breath, and leaves the right one still', () => {
		const poses = watch(1000, () => idle);
		const swings = poses.map(({ arms }) => arms.leftUpperArm.pitch);

		expect(Math.max(...swings)).toBeCloseTo(0.01, 4);
		expect(Math.min(...swings)).toBeCloseTo(-0.01, 4);
		poses.forEach(({ arms }) => expect(arms.rightUpperArm.pitch).toBe(0));
	});

	it('holds the arms down under reduced motion, with the shoulders and the swing still, from the first frame', () => {
		const poses = watch(600, (frame) => (frame < 300 ? idle : thinking), true);

		poses.forEach(({ arms }) => {
			expect(arms.leftUpperArm.roll).toBeCloseTo(-1.38, 12);
			expect(arms.rightUpperArm.roll).toBeCloseTo(1.38, 12);
			expect(arms.leftShoulder.roll).toBeCloseTo(0, 12);
			expect(arms.rightShoulder.roll).toBeCloseTo(0, 12);
			expect(arms.leftUpperArm.pitch).toBeCloseTo(0, 12);
		});
	});
});

/** The idle pose for the seed above, 10 ms frames, no thinking and no reduced motion, as the motion printed it at these frames with every draw taken from the seeded source in order; the look-at is left out, as the eyes lead the head and jump on top of it. */
const releasedIdle = [
	{ frame: 540, pose: { blink: 0, breath: 0.020895656768874456, head: { yaw: -0.04161635932390453, pitch: 0.015656019783450336, roll: 0.0199915048587643 } } },
	{ frame: 585, pose: { blink: 0.961825643172819, breath: 0.021040238825292983, head: { yaw: 0.005673312285950308, pitch: 0.0037694117636025565, roll: 0.019745667769759525 } } },
	{ frame: 960, pose: { blink: 0, breath: 0.014277515334769496, head: { yaw: -0.015340766900433452, pitch: -0.018115034548822496, roll: 0.006360561898760413 } } },
	{ frame: 1155, pose: { blink: 0.9957341762950346, breath: -0.0049763373768014095, head: { yaw: -0.0025962965084032515, pitch: -0.029215927177524845, roll: -0.004790005830756964 } } },
	{ frame: 1650, pose: { blink: 0, breath: -0.014277515334768658, head: { yaw: -0.004706420008340174, pitch: 0.011583931404945107, roll: -0.019886568123676833 } } }
];
