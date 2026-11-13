/**
 * The figure's idle life as a function of elapsed time and a source of chance, with no three and no DOM: the caller gives the
 * seconds since the last frame and `Math.random`, a test gives a clock it advances and a seeded source. It is the base layer of
 * the figure's motion (breath, sway, blink), the source of the idle glance, whose target the figure's motion eases and splits
 * between head and eyes, and of the small jumps of the eyes, which lie on the look-at alone.
 *
 * The values are those of hopin's docs/mockups/agent-tile-figure/agent-tile-figure.html in its idle state: the breath's period
 * and the spine's lean (the mockup's spine and chest shares summed, as the figure's required bones have no chest); the sway's
 * three slow sines; the blink's duration, 0.17 s, and 0.28 s under reduced motion, which keeps the blink; the glance's targets
 * and hold. Where the ruled intervals differ the ruled ones win: a blink starts 2 to 6 s after
 * the last one ended and a glance 3 to 8 s after the last one began, and the mockup's occasional double blink, which leaves no
 * gap, is not taken. A large shift of the gaze, which the figure's motion reports, brings the next blink forward to that moment, but
 * never to less than the shortest gap after the last blink; the gap after it is drawn as after any blink. Under reduced motion the
 * breath, the sway, the glance and the eyes' jumps rest at once.
 */

/** Radians the spine leans forward at the top of a breath. */
export const breathLean = 0.022;
const breathPeriodSeconds = 4.6;
/** The sway's amplitude in radians and angular frequency in radians per second, for each axis of the head. */
const sway = {
	yaw: { amplitude: 0.035, frequency: 0.37 },
	pitch: { amplitude: 0.02, frequency: 0.53 },
	roll: { amplitude: 0.02, frequency: 0.29 }
};
const blink = { durationSeconds: 0.17, reducedDurationSeconds: 0.28, firstStart: [1.5, 4], gapAfterEnd: [2, 6] } as const;
/** A glance's target in degrees, how long it is held, and the time from one glance's start to the next. */
const glance = {
	yaw: [-14, 14],
	pitch: [-6, 7],
	holdSeconds: [0.6, 1.5],
	firstStart: [2, 5],
	gapAfterStart: [3, 8]
} as const;
/** The eyes' small jumps: the time from one jump to the next, and the farthest a jump lies from the gaze, in degrees of the look-at. */
const eyeJump = { gapSeconds: [0.5, 2.5] } as const;
export const eyeJumpReach = { yaw: 3, pitch: 2 } as const;
/** Seconds after which a step counts as this long: a page that was hidden returns with one long step. */
export const longestStepSeconds = 0.1;
/** The clock starts at a random time within this many seconds, so two figures do not breathe in step. */
const clockStartSpreadSeconds = 10;

type Interval = readonly [number, number];

/** A source of numbers in [0, 1) that `seed` fixes (mulberry32). */
function derivedRandom(seed: number): () => number {
	let state = Math.floor(seed * 2 ** 32);
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
	};
}

/** What the idle life gives for one frame. */
export interface IdlePose {
	/** The blink expression's weight, 0 to 1. */
	readonly blink: number;
	/** The spine's forward lean in radians. */
	readonly breath: number;
	/** The head's sway in radians. */
	readonly sway: { readonly yaw: number; readonly pitch: number; readonly roll: number };
	/** Where the idle glance looks, in degrees from straight ahead: its target while it is held, otherwise straight ahead. */
	readonly glance: { readonly yaw: number; readonly pitch: number };
	/** Where the eyes' small jump lies from the gaze, in degrees of the look-at: held until the next jump, within `eyeJumpReach`. */
	readonly eyes: { readonly yaw: number; readonly pitch: number };
}

export interface IdleMotion {
	/** The pose `elapsedSeconds` after the last call, while the page asks for reduced motion or not. */
	advance(elapsedSeconds: number, reducedMotion: boolean): IdlePose;
	/** The gaze's goal has shifted far: the next blink starts with the next call of `advance` unless one is under way or the last ended less than the shortest gap ago. */
	blinkWithGazeShift(): void;
}

export function createIdleMotion(random: () => number): IdleMotion {
	const between = ([minimum, maximum]: Interval) => minimum + random() * (maximum - minimum);
	const clockStart = random();
	let clock = clockStart * clockStartSpreadSeconds;
	// The jumps draw from a source the first draw fixes, so they leave the blinks' and the glances' draws as they are.
	const jumpRandom = derivedRandom(clockStart);
	const jumpBetween = ([minimum, maximum]: Interval) => minimum + jumpRandom() * (maximum - minimum);
	let blinkStart = between(blink.firstStart);
	let blinkSeconds = -1;
	let glanceStart = between(glance.firstStart);
	let glanceEnd = 0;
	let target = { yaw: 0, pitch: 0 };
	let blinkEnd = clock;
	let jumpStart = clock + jumpBetween(eyeJump.gapSeconds);
	let eyes = { yaw: 0, pitch: 0 };

	const blinkWeight = (step: number, reducedMotion: boolean): number => {
		if (blinkSeconds < 0 && clock > blinkStart) blinkSeconds = 0;
		if (blinkSeconds < 0) return 0;
		blinkSeconds += step;
		const duration = reducedMotion ? blink.reducedDurationSeconds : blink.durationSeconds;
		if (blinkSeconds < duration) return Math.sin((blinkSeconds / duration) * Math.PI);
		blinkSeconds = -1;
		blinkEnd = clock;
		blinkStart = clock + between(blink.gapAfterEnd);
		return 0;
	};

	const glanceTarget = (reducedMotion: boolean) => {
		if (!reducedMotion && clock > glanceStart) {
			target = { yaw: between(glance.yaw), pitch: between(glance.pitch) };
			glanceEnd = clock + between(glance.holdSeconds);
			glanceStart = clock + between(glance.gapAfterStart);
		}
		const held = !reducedMotion && clock < glanceEnd;
		return held ? target : { yaw: 0, pitch: 0 };
	};

	const eyesNow = (reducedMotion: boolean) => {
		if (reducedMotion) return { yaw: 0, pitch: 0 };
		if (clock > jumpStart) {
			eyes = { yaw: jumpBetween([-eyeJumpReach.yaw, eyeJumpReach.yaw]), pitch: jumpBetween([-eyeJumpReach.pitch, eyeJumpReach.pitch]) };
			jumpStart = clock + jumpBetween(eyeJump.gapSeconds);
		}
		return eyes;
	};

	return {
		blinkWithGazeShift() {
			if (blinkSeconds < 0 && clock >= blinkEnd + blink.gapAfterEnd[0]) blinkStart = Math.min(blinkStart, clock);
		},
		advance(elapsedSeconds, reducedMotion) {
			const step = Math.min(elapsedSeconds, longestStepSeconds);
			clock += step;
			const glanceNow = glanceTarget(reducedMotion);
			const moving = reducedMotion ? 0 : 1;
			const swayAt = ({ amplitude, frequency }: { amplitude: number; frequency: number }) => moving * amplitude * Math.sin(clock * frequency);
			return {
				blink: blinkWeight(step, reducedMotion),
				breath: moving * breathLean * Math.sin((clock * 2 * Math.PI) / breathPeriodSeconds),
				sway: { yaw: swayAt(sway.yaw), pitch: swayAt(sway.pitch), roll: swayAt(sway.roll) },
				glance: glanceNow,
				eyes: eyesNow(reducedMotion)
			};
		}
	};
}
