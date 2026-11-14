import type { FigureGesture } from './gestures.js';
import type { Turn } from './figureMotion.js';

/**
 * The gestures as authored keyframes, with no three and no DOM: per bone a list of keys, and the clip's fades. The bones a clip owns
 * and the lag of each are one table here, for the figure's own clips and a persona's alike. The layer in `gestureLayer.ts` samples the
 * clips over the base pose; `figureMotion.ts` owns the clock they are read at.
 */

/** The turn a bone is keyed to at a time of the clip, in radians, as the base pose writes a bone's turn. */
export interface TurnKey {
	readonly seconds: number;
	readonly turn: Turn;
}

const sides = ['left', 'right'] as const;
const fingerBones = [
	'ThumbMetacarpal',
	'ThumbProximal',
	'ThumbDistal',
	'IndexProximal',
	'IndexIntermediate',
	'IndexDistal',
	'MiddleProximal',
	'MiddleIntermediate',
	'MiddleDistal',
	'RingProximal',
	'RingIntermediate',
	'RingDistal',
	'LittleProximal',
	'LittleIntermediate',
	'LittleDistal'
] as const;

/** The humanoid bones a clip owns: the arms, the hands, the fingers, the shoulders, and the spine, the chest and the upper chest; every other bone's track is dropped. */
export type ClipBone = `${(typeof sides)[number]}${'Shoulder' | 'UpperArm' | 'LowerArm' | 'Hand' | (typeof fingerBones)[number]}` | 'spine' | 'chest' | 'upperChest';

/** The seconds a bone trails the gesture's clock: the parts of a limb do not arrive together, so an author writes the pose and figure adds this. */
const lagSecondsByPart = { shoulder: 0, upperArm: 0, lowerArm: 0.05, hand: 0.1, finger: 0.1, trunk: 0 } as const;

const lagSecondsByBone: Readonly<Record<ClipBone, number>> = Object.fromEntries([
	...sides.flatMap((side) => [
		[`${side}Shoulder`, lagSecondsByPart.shoulder],
		[`${side}UpperArm`, lagSecondsByPart.upperArm],
		[`${side}LowerArm`, lagSecondsByPart.lowerArm],
		[`${side}Hand`, lagSecondsByPart.hand],
		...fingerBones.map((finger) => [`${side}${finger}`, lagSecondsByPart.finger])
	]),
	...(['spine', 'chest', 'upperChest'] as const).map((bone) => [bone, lagSecondsByPart.trunk])
]) as Record<ClipBone, number>;

/** Every bone a clip owns. */
export const clipBones = Object.keys(lagSecondsByBone) as readonly ClipBone[];

/** Whether a clip owns the bone named `name`: an own key of the lag table, so `'constructor'` and every other inherited name is none. */
export function isClipBone(name: string): name is ClipBone {
	return Object.hasOwn(lagSecondsByBone, name);
}

/** The seconds `bone` trails the gesture's clock. */
export function lagSecondsOf(bone: ClipBone): number {
	return lagSecondsByBone[bone];
}

/** What the gesture's clock and the base pose's arm need of a clip, whatever its source: its length, its fades and the bones it plays. */
export interface ClipTiming {
	/** The seconds on a bone's own clock from the first key to the last. */
	readonly durationSeconds: number;
	/** The seconds a bone takes to blend from the base pose to the clip and back: the weight is a smoothstep over each. */
	readonly fadeSeconds: { readonly in: number; readonly out: number };
	readonly bones: readonly ClipBone[];
}

/** A clip authored as keys: per bone a list that ascends in time from 0 to the clip's duration, linear between the keys. */
export interface GestureClip extends ClipTiming {
	readonly keys: Readonly<Partial<Record<ClipBone, readonly TurnKey[]>>>;
}

const turn = (pitch: number, yaw: number, roll: number): Turn => ({ pitch, yaw, roll });

/** The wave's poses: the raised hand beside the face, palm forward, the two turning points of its swing, and the pose the rise starts from and the fall ends at, the arm and the hand each. */
type WavePose = Readonly<Record<'upperArm' | 'lowerArm' | 'hand', Turn>>;
const raised: WavePose = { upperArm: turn(-1.3, 0.01, 1.38), lowerArm: turn(0.05, 2.51, 0), hand: turn(0, 0, 0) };
/** The elbow tucked in, the hand turned about the forearm so the palm shows early and leaning outward so its fingers stay off the wig's curl, and it comes up and goes down inside the picture's side. */
const lifting: WavePose = { upperArm: turn(-1.3, 0.01, 1.6), lowerArm: turn(0.05, 2.51, 0), hand: turn(1.6, 0, -0.5) };
const swungOut: WavePose = { upperArm: turn(-1.3, -0.07, 1.38), lowerArm: turn(-0.21, 2.51, 0), hand: turn(0, 0, 0.2) };
const swungIn: WavePose = { upperArm: turn(-1.3, -0.02, 1.38), lowerArm: turn(-0.05, 2.51, 0), hand: turn(0, 0, -0.2) };

/** The seconds of the wave's keys: the rise, the swing out, in, out, in, and the fall; the raised pose is reached at the end of the fade in and left at the start of the fade out. */
const waveSeconds = { raised: 0.45, firstOut: 0.75, firstIn: 1.05, secondOut: 1.35, secondIn: 1.65, lowering: 1.85, end: 2.3 };

function waveKeys(part: keyof WavePose): TurnKey[] {
	const keyed = (seconds: number, pose: WavePose): TurnKey => ({ seconds, turn: pose[part] });
	return [
		keyed(0, lifting),
		keyed(waveSeconds.raised, raised),
		keyed(waveSeconds.firstOut, swungOut),
		keyed(waveSeconds.firstIn, swungIn),
		keyed(waveSeconds.secondOut, swungOut),
		keyed(waveSeconds.secondIn, swungIn),
		keyed(waveSeconds.lowering, raised),
		keyed(waveSeconds.end, lifting)
	];
}

/** One clip per gesture; a name without a clip does not compile. */
export const gestureClips: Readonly<Record<FigureGesture, GestureClip>> = {
	wave: {
		durationSeconds: waveSeconds.end,
		fadeSeconds: { in: waveSeconds.raised, out: waveSeconds.end - waveSeconds.lowering },
		bones: ['rightUpperArm', 'rightLowerArm', 'rightHand'],
		keys: { rightUpperArm: waveKeys('upperArm'), rightLowerArm: waveKeys('lowerArm'), rightHand: waveKeys('hand') }
	}
};

/** The seconds a gesture runs on its own clock: its clip's duration and the longest lag among the bones it plays, after which the last bone is back at the base pose. */
export function gestureLengthSeconds(clip: ClipTiming): number {
	return clip.durationSeconds + Math.max(0, ...clip.bones.map(lagSecondsOf));
}

/** The seconds on a bone's own clock when the gesture's clock reads `gestureSeconds`: the bone trails by its lag. */
export function boneClock(bone: ClipBone, gestureSeconds: number): number {
	return gestureSeconds - lagSecondsOf(bone);
}

const smoothstep = (share: number) => share * share * (3 - 2 * share);
const unitRange = (value: number) => Math.max(0, Math.min(1, value));

/** The share of the clip a bone shows over the base pose at `clock` seconds on its own clock: exactly 0 at the start and the end, exactly 1 between the fades, a smoothstep inside them. */
export function clipWeight(clip: ClipTiming, clock: number): number {
	return smoothstep(unitRange(clock / clip.fadeSeconds.in)) * smoothstep(unitRange((clip.durationSeconds - clock) / clip.fadeSeconds.out));
}

/** The bones of the right arm that the base pose writes, which the base pose's arm gives way to. */
const baseArmBones = ['rightUpperArm', 'rightLowerArm', 'rightHand'] as const satisfies readonly ClipBone[];

/** The share of its clip that the arm bones of the gesture show at the most when the gesture's clock reads `seconds`: the base pose's arm gives way by this share, so the hand leaves the chin with the first bone and comes back to it after the last. */
export function armShare(clip: ClipTiming, seconds: number): number {
	return Math.max(0, ...baseArmBones.filter((bone) => clip.bones.includes(bone)).map((bone) => clipWeight(clip, boneClock(bone, seconds))));
}
