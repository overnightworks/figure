import type { FigureGesture } from './gestures.js';
import type { Turn } from './figureMotion.js';

/**
 * The gestures as authored keyframes, with no three and no DOM: per bone a list of keys and a lag, and the clip's fades. The layer in
 * `gestureLayer.ts` samples them over the base pose; `figureMotion.ts` owns the clock they are read at.
 */

/** The turn a bone is keyed to at a time of the clip, in radians, as the base pose writes a bone's turn. */
export interface TurnKey {
	readonly seconds: number;
	readonly turn: Turn;
}

/** One bone's track: keys that ascend in time from 0 to the clip's duration, linear between them, and the seconds the bone trails the gesture's clock. */
export interface BoneTrack {
	readonly lagSeconds: number;
	readonly keys: readonly TurnKey[];
}

/** The humanoid bones a clip turns. */
export type ClipBone = 'rightUpperArm' | 'rightLowerArm' | 'rightHand';

export interface GestureClip {
	/** The seconds on a bone's own clock from the first key to the last. */
	readonly durationSeconds: number;
	/** The seconds a bone takes to blend from the base pose to the clip and back: the weight is a smoothstep over each. */
	readonly fadeSeconds: { readonly in: number; readonly out: number };
	readonly bones: Readonly<Record<ClipBone, BoneTrack>>;
}

const turn = (pitch: number, yaw: number, roll: number): Turn => ({ pitch, yaw, roll });

/** The wave's poses: the raised hand beside the face, palm forward, the two turning points of its swing, and the pose the rise starts from and the fall ends at, the arm and the hand each. */
type WavePose = Readonly<Record<'upperArm' | 'lowerArm' | 'hand', Turn>>;
const raised: WavePose = { upperArm: turn(-1.3, 0.01, 1.38), lowerArm: turn(0.05, 2.51, 0), hand: turn(0, 0, 0) };
/** The elbow tucked in and the hand's turn about it leaning inward, so the hand comes up and goes down inside the picture's side. */
const lifting: WavePose = { upperArm: turn(-1.3, 0.01, 1.6), lowerArm: turn(0.6, 2.51, 0), hand: turn(0, 0, 0) };
const swungOut: WavePose = { upperArm: turn(-1.3, -0.07, 1.38), lowerArm: turn(-0.21, 2.51, 0), hand: turn(0, 0, 0.2) };
const swungIn: WavePose = { upperArm: turn(-1.3, 0.04, 1.38), lowerArm: turn(0.1, 2.51, 0), hand: turn(0, 0, -0.2) };

/** The seconds of the wave's keys: the rise, the swing out, in, out, in, and the fall; the raised pose is reached at the end of the fade in and left at the start of the fade out. */
const waveSeconds = { raised: 0.45, firstOut: 0.75, firstIn: 1.05, secondOut: 1.35, secondIn: 1.65, lowering: 1.85, end: 2.3 };

function waveTrack(part: keyof WavePose, lagSeconds: number): BoneTrack {
	const keyed = (seconds: number, pose: WavePose): TurnKey => ({ seconds, turn: pose[part] });
	return {
		lagSeconds,
		keys: [
			keyed(0, lifting),
			keyed(waveSeconds.raised, raised),
			keyed(waveSeconds.firstOut, swungOut),
			keyed(waveSeconds.firstIn, swungIn),
			keyed(waveSeconds.secondOut, swungOut),
			keyed(waveSeconds.secondIn, swungIn),
			keyed(waveSeconds.lowering, raised),
			keyed(waveSeconds.end, lifting)
		]
	};
}

/** One clip per gesture; a name without a clip does not compile. */
export const gestureClips: Readonly<Record<FigureGesture, GestureClip>> = {
	wave: {
		durationSeconds: waveSeconds.end,
		fadeSeconds: { in: waveSeconds.raised, out: waveSeconds.end - waveSeconds.lowering },
		bones: { rightUpperArm: waveTrack('upperArm', 0), rightLowerArm: waveTrack('lowerArm', 0.05), rightHand: waveTrack('hand', 0.1) }
	}
};

/** The seconds a gesture runs on its own clock: its clip's duration and the longest lag, after which the last bone is back at the base pose. */
export function gestureLengthSeconds(name: FigureGesture): number {
	const clip = gestureClips[name];
	return clip.durationSeconds + Math.max(...Object.values(clip.bones).map(({ lagSeconds }) => lagSeconds));
}

/** The seconds on a bone's own clock when the gesture's clock reads `gestureSeconds`: the bone trails by its lag. */
export function boneClock(track: BoneTrack, gestureSeconds: number): number {
	return gestureSeconds - track.lagSeconds;
}

const smoothstep = (share: number) => share * share * (3 - 2 * share);
const unitRange = (value: number) => Math.max(0, Math.min(1, value));

/** The share of the clip a bone shows over the base pose at `clock` seconds on its own clock: exactly 0 at the start and the end, exactly 1 between the fades, a smoothstep inside them. */
export function clipWeight(clip: GestureClip, clock: number): number {
	return smoothstep(unitRange(clock / clip.fadeSeconds.in)) * smoothstep(unitRange((clip.durationSeconds - clock) / clip.fadeSeconds.out));
}
