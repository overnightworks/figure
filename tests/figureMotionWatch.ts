// What the figure motion's tests share to watch a figure frame by frame: a seeded source of chance, the facts, and the poses of a run.
import { createFigureMotion, type FigureFacts, type FigurePose, type SpeakerOffset } from '../src/figureMotion.js';
import { createIdleMotion } from '../src/idleMotion.js';
import type { VowelWeights } from '../src/vowelWeights.js';

/** A small seeded source of numbers in [0, 1) (mulberry32), so a run is the same every time. */
export function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
	};
}

export const seed = 7;
export const frameSeconds = 0.01;
export const idle: FigureFacts = { thinking: false, speaking: false };
export const thinking: FigureFacts = { thinking: true, speaking: false };
export const speaking: FigureFacts = { thinking: false, speaking: true };
export const thinkingAndSpeaking: FigureFacts = { thinking: true, speaking: true };

/** A speaker at the picture's full reach to the left, in half-viewport shares from the canvas's centre. */
export const speakerLeft: SpeakerOffset = { across: -0.5, down: 0 };
/** The picture's thinking look, in the units the pose uses: the gaze 18 degrees to the side and 13 up, the look-at turning 2.4 times that. */
export const thinkingLook = { yaw: -43.2, pitch: 31.2 };
/** The head's own turn at the picture's thinking look with the sway at rest: half the gaze's yaw and 0.55 of its pitch, in radians. */
export const thinkingHead = { yaw: -0.15708, pitch: -0.12479, roll: 0 };

/** The poses of a figure given `factsAt(frame)`, the speaker `speakerAt(frame)` and the mouth weights `mouthAt(frame)` for `frames` frames of 10 ms, while the page asks for reduced motion or not. */
export function watch(
	frames: number,
	factsAt: (frame: number) => FigureFacts,
	reducedMotion = false,
	speakerAt: (frame: number) => SpeakerOffset | null = () => null,
	mouthAt: (frame: number) => VowelWeights | null = () => null
): FigurePose[] {
	const motion = createFigureMotion(seededRandom(seed));
	return Array.from({ length: frames }, (_, frame) => motion.advance(factsAt(frame), frameSeconds, reducedMotion, speakerAt(frame), mouthAt(frame)));
}

export function atSecond(seconds: number): number {
	return Math.round(seconds / frameSeconds) - 1;
}

/** The frames in which a blink starts: the weight rises from none. */
export function blinkStartsOf(poses: FigurePose[]): number[] {
	return poses.flatMap((pose, frame) => (pose.blink > 0 && (frame === 0 || poses[frame - 1]!.blink === 0) ? [frame] : []));
}

/** The idle life of the seed's figure, frame by frame, which a figure that is not listening lives the same way. */
export function idleLife(frames: number) {
	const idleMotion = createIdleMotion(seededRandom(seed));
	return Array.from({ length: frames }, () => idleMotion.advance(frameSeconds, false));
}
