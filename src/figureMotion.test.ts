import { describe, expect, it } from 'vitest';
import { createFigureMotion, spreadPosture, type FigureFacts, type FigurePose, type SpeakerOffset } from './figureMotion.js';

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

const seed = 7;
const frameSeconds = 0.01;
const idle: FigureFacts = { thinking: false };
const thinking: FigureFacts = { thinking: true };

/** The picture's thinking look, in the units the pose uses: the gaze 18 degrees to the side and 13 up, the look-at turning 2.4 times that. */
const thinkingLook = { yaw: -43.2, pitch: 31.2 };
/** The head's own turn at the picture's thinking look with the sway at rest: half the gaze's yaw and 0.55 of its pitch, in radians. */
const thinkingHead = { yaw: -0.15708, pitch: -0.12479, roll: 0 };
/** The turn the thinking look adds to the head, from the picture, in radians. */
const thinkingPosture = { yaw: -0.2, pitch: -0.1, roll: 0.16 };
/** The idle glance reaches 14 degrees of yaw and the look-at turns 2.4 times the gaze, so no glance looks further than this. */
const widestIdleLookYaw = 14 * 2.4;

/** The poses of a figure given `factsAt(frame)` and the speaker `speakerAt(frame)` for `frames` frames of 10 ms, while the page asks for reduced motion or not. */
function watch(frames: number, factsAt: (frame: number) => FigureFacts, reducedMotion = false, speakerAt: (frame: number) => SpeakerOffset | null = () => null): FigurePose[] {
	const motion = createFigureMotion(seededRandom(seed));
	return Array.from({ length: frames }, (_, frame) => motion.advance(factsAt(frame), frameSeconds, reducedMotion, speakerAt(frame)));
}

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

function atSecond(seconds: number): number {
	return Math.round(seconds / frameSeconds) - 1;
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

	it('eases the gaze toward the thinking look and does not jump to it', () => {
		const looks = watch(300, () => thinking, false).map((pose) => pose.look.yaw);

		expect(looks[0]!).toBeGreaterThan(thinkingLook.yaw * 0.2);
		looks.slice(30).forEach((yaw, index) => expect(yaw).toBeLessThanOrEqual(looks[29 + index]! + 1e-9));
	});

	it('returns to the idle look when the agent stops thinking: no posture and a gaze within the idle glance\'s reach', () => {
		const neverThought = watch(3000, () => idle);
		const thought = watch(3000, (frame) => (frame < 1000 ? thinking : idle));

		expect(thought.slice(atSecond(15)).every((pose) => Math.abs(pose.look.yaw) <= widestIdleLookYaw + 1e-9)).toBe(true);
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
		expect(after.some((pose) => Math.abs(pose.look.yaw) > 5 && Math.abs(pose.look.yaw) <= widestIdleLookYaw)).toBe(true);
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

	it('keeps breath, sway and glance off under reduced motion, thinking or not', () => {
		[idle, thinking].forEach((facts) => {
			const poses = watch(600, () => facts, true);

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
		const again = Array.from({ length: 200 }, () => motion.advance({ thinking: true }, frameSeconds, false, null));

		expect(again).toEqual(given);
	});

	it('counts a step longer than a tenth of a second as a tenth, so a page that was hidden does not jump', () => {
		const stepped = createFigureMotion(seededRandom(seed));
		const returned = createFigureMotion(seededRandom(seed));

		expect(returned.advance(thinking, 30, false, null)).toEqual(stepped.advance(thinking, 0.1, false, null));
	});

	it('keeps the idle look of release 0.2.0 when the agent never thinks: its breath, head turn, gaze and blink at the same moments', () => {
		const poses = watch(1650, () => idle);

		releasedIdle.forEach(({ frame, pose }) => {
			const drawn = poses[frame - 1]!;
			expect(drawn.breath).toBeCloseTo(pose.breath, 9);
			expect(drawn.blink).toBeCloseTo(pose.blink, 9);
			expect(drawn.head.yaw).toBeCloseTo(pose.head.yaw, 9);
			expect(drawn.head.pitch).toBeCloseTo(pose.head.pitch, 9);
			expect(drawn.head.roll).toBeCloseTo(pose.head.roll, 9);
			expect(drawn.look.yaw).toBeCloseTo(pose.look.yaw, 9);
			expect(drawn.look.pitch).toBeCloseTo(pose.look.pitch, 9);
			expect(Object.values(drawn.posture).every((turn) => turn === 0)).toBe(true);
		});
	});
});

/** A speaker at the picture's full reach to the left, in half-viewport shares from the canvas's centre. */
const speakerLeft: SpeakerOffset = { across: -0.5, down: 0 };

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

	it('eases the yaw toward the speaker at 5 a second, a share of 1 - e^(-5 t) after t seconds', () => {
		const poses = watch(300, () => idle, false, () => speakerLeft);
		const resting = watch(300, () => idle);

		[0.25, 0.5, 1].forEach((seconds) => {
			const frame = atSecond(seconds);
			expect(resting[frame]!.look.yaw).toBe(0);
			expect(poses[frame]!.look.yaw).toBeCloseTo(-48 * (1 - Math.exp(-5 * seconds)), 6);
		});
	});

	it('eases the pitch toward the speaker at 6 a second as it does for any gaze', () => {
		const poses = watch(100, () => idle, false, () => ({ across: 0, down: -0.5 }));

		expect(poses[atSecond(0.5)]!.look.pitch).toBeCloseTo(21.6 * (1 - Math.exp(-6 * 0.5)), 6);
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
		listening.slice(atSecond(10)).forEach((pose) => expect(pose.look.yaw).toBeCloseTo(-48, 3));
		listening.forEach((pose, frame) => {
			expect(pose.breath).toBeCloseTo(idling[frame]!.breath, 12);
			expect(pose.blink).toBeCloseTo(idling[frame]!.blink, 12);
		});
		expect(new Set(listening.slice(atSecond(10)).map((pose) => pose.head.roll)).size).toBeGreaterThan(100);
	});

	it('follows a speaker that moves, at the same easing, with no restart', () => {
		const poses = watch(400, () => idle, false, (frame) => (frame < 200 ? speakerLeft : { across: 0.5, down: 0 }));
		const settled = poses[199]!.look.yaw;

		expect(poses[atSecond(3)]!.look.yaw).toBeCloseTo(48 + (settled - 48) * Math.exp(-5 * 1), 6);
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
		const again = Array.from({ length: 200 }, () => motion.advance(idle, frameSeconds, false, { across: -0.5, down: 0 }));

		expect(again).toEqual(given);
	});
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

/** The idle pose of release 0.2.0 for the seed above, 10 ms frames, no thinking and no reduced motion, as that release's idle module printed it at these frames. */
const releasedIdle = [
	{ frame: 540, pose: { blink: 0, breath: 0.020895656768874456, head: { yaw: 0.03635257427386759, pitch: 0.011104483145713905, roll: 0.0199915048587643 }, look: { yaw: 1.4179446541437428, pitch: -1.6970160640890233 } } },
	{ frame: 660, pose: { blink: 0.8951632913550626, breath: 0.005440682537475133, head: { yaw: 0.021380111188512303, pitch: -0.00805803367391107, roll: 0.018594378446629405 }, look: { yaw: 0.006569148506562625, pitch: -0.01718210424218766 } } },
	{ frame: 960, pose: { blink: 0, breath: 0.014277515334769496, head: { yaw: 0.0399122111362154, pitch: 0.006570158580842797, roll: 0.006360561898760413 }, look: { yaw: 15.195659745714682, pitch: -6.171741306919668 } } },
	{ frame: 1100, pose: { blink: 0.6736956436465578, breath: 0.010990086855098304, head: { yaw: -0.028895394562669055, pitch: -0.007610273745231622, roll: -0.001645161637623551 }, look: { yaw: 0.002610958512164997, pitch: -0.0036914069484576383 } } },
	{ frame: 1650, pose: { blink: 0, breath: -0.014277515334768658, head: { yaw: -0.03665233346014622, pitch: 0.03218480725494611, roll: -0.019886568123676833 }, look: { yaw: -8.785756864697582, pitch: -5.150588685712275 } } }
];
