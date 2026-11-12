import { breathLean, createIdleMotion, longestStepSeconds } from './idleMotion.js';

/**
 * The figure's motion as a function of the facts the host reports, the time and a source of chance, with no three and no DOM: it
 * owns the order of the states and the blending between them. The states, strongest first, are thinking, listening and idle; the one
 * that is true and strongest decides the gaze. Whether someone speaks, and where, is read by the caller each frame and given as
 * numbers.
 *
 * The thinking look is that of hopin's docs/mockups/agent-tile-figure/agent-tile-figure.html in its thinking state: the gaze up and
 * to the figure's side, the head's turn, the blink at 0.8 of its idle weight and on its idle schedule, the idle glance suppressed, and the easing rates. The picture
 * also raises a hand to the chin, which the figure does not do. The listening look is that of its listening state: the gaze toward the
 * speaker, the head's larger share of its yaw, the slower yaw and the lean, and a nod every 2.5 to 5 seconds, which the picture times
 * and which `spreadPosture` shares between neck and head. Under reduced motion the pose is reached and left at once, and no nod comes.
 */

/** What the host reports about its agent. */
export interface FigureFacts {
	readonly thinking: boolean;
}

/** Where a speaker's centre lies from the canvas's centre, as a share of half the viewport's width to the right and of half its height downward. */
export interface SpeakerOffset {
	readonly across: number;
	readonly down: number;
}

/** A rotation in radians about the three axes. */
export interface Turn {
	readonly yaw: number;
	readonly pitch: number;
	readonly roll: number;
}

/** What the figure's parts are set to for one frame. */
export interface FigurePose {
	/** The blink expression's weight, 0 to 1. */
	readonly blink: number;
	/** The spine's forward lean in radians. */
	readonly breath: number;
	/** The head's own turn in radians: the idle sway and the share of the gaze, set on the head bone alone. */
	readonly head: Turn;
	/** The turn a state adds to the head's, in radians, which `spreadPosture` spreads over the bones the model has; at rest it is zero. */
	readonly posture: Turn;
	/** The forward pitch in radians the listening lean adds to the spine and to the chest; the head's share is in `head`. */
	readonly trunkLean: number;
	/** The look-at's angles in degrees. */
	readonly look: { readonly yaw: number; readonly pitch: number };
	/** The arms' rest posture, the same in every state: the shoulders rise and fall with the breath, the upper arms are lowered. */
	readonly arms: Arms;
}

/** The turns of the arms' bones in radians; the lower arms and the hands stay at rest. */
export interface Arms {
	readonly leftShoulder: Turn;
	readonly rightShoulder: Turn;
	readonly leftUpperArm: Turn;
	readonly rightUpperArm: Turn;
}

export interface FigureMotion {
	/** The pose `elapsedSeconds` after the last call, given the facts now and where the speaker is, if anyone speaks, while the page asks for reduced motion or not. */
	advance(facts: FigureFacts, elapsedSeconds: number, reducedMotion: boolean, speaker: SpeakerOffset | null): FigurePose;
}

type Gaze = { readonly yaw: number; readonly pitch: number };

/** The gaze while thinking, in degrees: up and to the figure's side. */
const thinkingGaze: Gaze = { yaw: -18, pitch: 13 };
/** The gaze at the edge of the half viewport, in degrees: the speaker's offset reaches it at a share of 1 and no further. */
const speakerGazeReach: Gaze = { yaw: 40, pitch: 18 };
/** The head's extra turn at the full thinking look, in radians, and the blink's weight then, as a share of its idle weight. */
const thinkingLook = { posture: { yaw: -0.2, pitch: -0.1, roll: 0.16 }, blinkWeight: 0.8 };
/** The lean at its full weight, in radians: the head's pitch, and the spine's and the chest's each. */
const listeningLean = { head: 0.04, trunk: 0.02 };
/** The easing rates per second: the gaze's yaw and pitch, the thinking look's weight and the lean's, and the yaw while listening. */
const easing = { yaw: 7, listeningYaw: 5, pitch: 6, thinking: 4, lean: 3 };
/** The head turns half the gaze's yaw, three quarters of it while listening, and tilts 0.55 of its pitch; the look-at turns 2.4 times the gaze. */
const headShare = { yaw: 0.5, listeningYaw: 0.75, pitch: 0.55 };
/** The look-at turns 2.4 times the gaze and no further than 90 degrees either way, as the picture clamps it. */
const lookGain = 2.4;
const lookReachDegrees = 90;
/** The listening nod: a half sine of `durationSeconds` to a forward pitch of `peakRadians`, and the seconds from one nod's start to the next's, drawn from `gapSeconds`. */
const nod = { durationSeconds: 0.9, peakRadians: 0.09, gapSeconds: [2.5, 5] as const };

const radiansPerDegree = Math.PI / 180;

/**
 * The arms at rest, from the picture's applyPose: each upper arm is turned down 1.38 rad about its forward axis, the left one negative
 * because its bone runs along +X; the shoulders rise by 0.012 rad at the top of a breath, the left upper arm swings 0.01 rad about x.
 */
const restingArm = { upperArmRoll: 1.38, shoulderRise: 0.012, upperArmSwing: 0.01 };

/** The arms at rest for a breath of `breath` radians: the breath as a share of its largest lean sets the shoulders' and the swing's share. */
function restingArms(breath: number): Arms {
	const share = breath / breathLean;
	return {
		leftShoulder: { yaw: 0, pitch: 0, roll: restingArm.shoulderRise * share },
		rightShoulder: { yaw: 0, pitch: 0, roll: -restingArm.shoulderRise * share },
		leftUpperArm: { yaw: 0, pitch: restingArm.upperArmSwing * share, roll: -restingArm.upperArmRoll },
		rightUpperArm: { yaw: 0, pitch: 0, roll: restingArm.upperArmRoll }
	};
}

/** The shares of a posture turn the neck takes, and the chest takes of its yaw; the head takes the rest. */
const turnShare = { neck: 0.4, chestYaw: 0.15 };

/** Which of the bones that share a posture turn the model has. */
export interface PostureBones {
	readonly neck: boolean;
	readonly chest: boolean;
}

/** How a posture turn goes to the head, the neck and the chest; the head takes the share of a bone the model lacks, so the three add up to the posture. */
export function spreadPosture(posture: Turn, has: PostureBones): { head: Turn; neck: Turn; chest: Turn } {
	const neck = has.neck ? turnShare.neck : 0;
	const chestYaw = has.chest ? turnShare.chestYaw : 0;
	return {
		head: { yaw: posture.yaw * (1 - neck - chestYaw), pitch: posture.pitch * (1 - neck), roll: posture.roll * (1 - neck) },
		neck: { yaw: posture.yaw * neck, pitch: posture.pitch * neck, roll: posture.roll * neck },
		chest: { yaw: posture.yaw * chestYaw, pitch: 0, roll: 0 }
	};
}

const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

/** The gaze toward a speaker, up being positive: the offset's share of the half viewport, clamped to 1, times the gaze's reach. */
function gazeToward(speaker: SpeakerOffset): Gaze {
	return { yaw: clamp(speaker.across, 1) * speakerGazeReach.yaw, pitch: clamp(-speaker.down, 1) * speakerGazeReach.pitch };
}

/** The gaze the facts ask for: the thinking gaze while thinking, else the one toward the speaker, else the idle glance. */
function gazeFor(facts: FigureFacts, speaker: SpeakerOffset | null, idleGlance: Gaze): Gaze {
	if (facts.thinking) return thinkingGaze;
	return speaker === null ? idleGlance : gazeToward(speaker);
}

/** The nod's forward pitch for the step just taken, in radians: zero when no nod is under way. */
interface NodMotion {
	advance(step: number, listening: boolean, reducedMotion: boolean): number;
}

/**
 * The listening nod as the picture times it: the first comes at the first frame the figure listens, each next one a gap from the last
 * one's start, and listening that ends cuts a nod under way. The clock runs through every step, so the gaps stay on one timeline.
 */
function createNod(random: () => number): NodMotion {
	let clock = 0;
	let nextStart = 0;
	let startedAt: number | null = null;
	const gapSeconds = () => nod.gapSeconds[0] + random() * (nod.gapSeconds[1] - nod.gapSeconds[0]);
	return {
		advance(step, listening, reducedMotion) {
			clock += step;
			if (!listening || reducedMotion) {
				startedAt = null;
				return 0;
			}
			if (clock > nextStart) {
				startedAt = clock;
				nextStart = clock + gapSeconds();
			}
			if (startedAt === null) return 0;
			const age = clock - startedAt;
			return age < nod.durationSeconds ? Math.sin((age / nod.durationSeconds) * Math.PI) * nod.peakRadians : 0;
		}
	};
}

export function createFigureMotion(random: () => number): FigureMotion {
	const idle = createIdleMotion(random);
	const nodding = createNod(random);
	let gaze: Gaze = { yaw: 0, pitch: 0 };
	let thinkingWeight = 0;
	let leanWeight = 0;

	return {
		advance(facts, elapsedSeconds, reducedMotion, speaker) {
			const step = Math.min(elapsedSeconds, longestStepSeconds);
			const base = idle.advance(elapsedSeconds, reducedMotion);
			const ease = (value: number, goal: number, rate: number) => value + (goal - value) * (reducedMotion ? 1 : 1 - Math.exp(-rate * step));
			const listening = !facts.thinking && speaker !== null;
			const nodPitch = nodding.advance(step, listening, reducedMotion);
			const goal = gazeFor(facts, speaker, base.glance);
			gaze = { yaw: ease(gaze.yaw, goal.yaw, listening ? easing.listeningYaw : easing.yaw), pitch: ease(gaze.pitch, goal.pitch, easing.pitch) };
			thinkingWeight = ease(thinkingWeight, facts.thinking ? 1 : 0, easing.thinking);
			leanWeight = ease(leanWeight, listening ? 1 : 0, easing.lean);
			return {
				blink: facts.thinking ? base.blink * thinkingLook.blinkWeight : base.blink,
				breath: base.breath,
				head: {
					yaw: gaze.yaw * radiansPerDegree * (listening ? headShare.listeningYaw : headShare.yaw) + base.sway.yaw,
					pitch: -gaze.pitch * radiansPerDegree * headShare.pitch + leanWeight * listeningLean.head + base.sway.pitch,
					roll: base.sway.roll
				},
				posture: {
					yaw: thinkingWeight * thinkingLook.posture.yaw,
					pitch: thinkingWeight * thinkingLook.posture.pitch + nodPitch,
					roll: thinkingWeight * thinkingLook.posture.roll
				},
				trunkLean: leanWeight * listeningLean.trunk,
				look: { yaw: clamp(gaze.yaw * lookGain, lookReachDegrees), pitch: clamp(gaze.pitch * lookGain, lookReachDegrees) },
				arms: restingArms(base.breath)
			};
		}
	};
}
