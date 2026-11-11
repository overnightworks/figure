/**
 * The figure's idle life as a function of elapsed time and a source of chance, with no three and no DOM: the caller gives the
 * seconds since the last frame and `Math.random`, a test gives a clock it advances and a seeded source.
 *
 * The values are those of hopin's docs/mockups/agent-tile-figure/agent-tile-figure.html in its idle state: the breath's period
 * and the spine's lean (the mockup's spine and chest shares summed, as the figure's required bones have no chest); the sway's
 * three slow sines; the blink's duration, 0.17 s, and 0.28 s under reduced motion, which keeps the blink; the glance's targets,
 * hold and easing, and the head's share of it. Where the ruled intervals differ the ruled ones win: a blink starts 2 to 6 s after
 * the last one ended and a glance 3 to 8 s after the last one began, and the mockup's occasional double blink, which leaves no
 * gap, is not taken. Under reduced motion the breath, the sway and the glance rest at once.
 */

/** Radians the spine leans forward at the top of a breath. */
const breathLean = 0.022;
const breathPeriodSeconds = 4.6;
/** The sway's amplitude in radians and angular frequency in radians per second, for each axis of the head. */
const sway = {
	yaw: { amplitude: 0.035, frequency: 0.37 },
	pitch: { amplitude: 0.02, frequency: 0.53 },
	roll: { amplitude: 0.02, frequency: 0.29 }
};
const blink = { durationSeconds: 0.17, reducedDurationSeconds: 0.28, firstStart: [1.5, 4], gapAfterEnd: [2, 6] } as const;
/** A glance's target in degrees, how long it is held, the time from one glance's start to the next, and the easing rates per second. */
const glance = {
	yaw: [-14, 14],
	pitch: [-6, 7],
	holdSeconds: [0.6, 1.5],
	firstStart: [2, 5],
	gapAfterStart: [3, 8],
	yawEasing: 7,
	pitchEasing: 6
} as const;
/** The head turns half the glance's yaw and tilts 0.55 of its pitch; the look-at turns 2.4 times the glance. */
const headShare = { yaw: 0.5, pitch: 0.55 };
const lookGain = 2.4;
/** Seconds after which a step counts as this long: a page that was hidden returns with one long step. */
const longestStepSeconds = 0.1;
/** The clock starts at a random time within this many seconds, so two figures do not breathe in step. */
const clockStartSpreadSeconds = 10;

type Interval = readonly [number, number];

/** What the figure's parts are set to for one frame. */
export interface IdlePose {
	/** The blink expression's weight, 0 to 1. */
	readonly blink: number;
	/** The spine's forward lean in radians. */
	readonly breath: number;
	/** The head's rotation in radians. */
	readonly head: { readonly yaw: number; readonly pitch: number; readonly roll: number };
	/** The look-at's angles in degrees. */
	readonly look: { readonly yaw: number; readonly pitch: number };
}

export interface IdleMotion {
	/** The pose `elapsedSeconds` after the last call, while the page asks for reduced motion or not. */
	advance(elapsedSeconds: number, reducedMotion: boolean): IdlePose;
}

export function createIdleMotion(random: () => number): IdleMotion {
	const between = ([minimum, maximum]: Interval) => minimum + random() * (maximum - minimum);
	let clock = random() * clockStartSpreadSeconds;
	let blinkStart = between(blink.firstStart);
	let blinkSeconds = -1;
	let glanceStart = between(glance.firstStart);
	let glanceEnd = 0;
	let target = { yaw: 0, pitch: 0 };
	let eased = { yaw: 0, pitch: 0 };

	const blinkWeight = (step: number, reducedMotion: boolean): number => {
		if (blinkSeconds < 0 && clock > blinkStart) blinkSeconds = 0;
		if (blinkSeconds < 0) return 0;
		blinkSeconds += step;
		const duration = reducedMotion ? blink.reducedDurationSeconds : blink.durationSeconds;
		if (blinkSeconds < duration) return Math.sin((blinkSeconds / duration) * Math.PI);
		blinkSeconds = -1;
		blinkStart = clock + between(blink.gapAfterEnd);
		return 0;
	};

	const easeGlance = (step: number, reducedMotion: boolean) => {
		if (!reducedMotion && clock > glanceStart) {
			target = { yaw: between(glance.yaw), pitch: between(glance.pitch) };
			glanceEnd = clock + between(glance.holdSeconds);
			glanceStart = clock + between(glance.gapAfterStart);
		}
		const held = !reducedMotion && clock < glanceEnd;
		const ease = (value: number, goal: number, rate: number) => value + (goal - value) * (reducedMotion ? 1 : 1 - Math.exp(-rate * step));
		eased = {
			yaw: ease(eased.yaw, held ? target.yaw : 0, glance.yawEasing),
			pitch: ease(eased.pitch, held ? target.pitch : 0, glance.pitchEasing)
		};
	};

	return {
		advance(elapsedSeconds, reducedMotion) {
			const step = Math.min(elapsedSeconds, longestStepSeconds);
			clock += step;
			easeGlance(step, reducedMotion);
			const moving = reducedMotion ? 0 : 1;
			const swayAt = ({ amplitude, frequency }: { amplitude: number; frequency: number }) => moving * amplitude * Math.sin(clock * frequency);
			return {
				blink: blinkWeight(step, reducedMotion),
				breath: moving * breathLean * Math.sin((clock * 2 * Math.PI) / breathPeriodSeconds),
				head: {
					yaw: (eased.yaw * Math.PI * headShare.yaw) / 180 + swayAt(sway.yaw),
					pitch: (-eased.pitch * Math.PI * headShare.pitch) / 180 + swayAt(sway.pitch),
					roll: swayAt(sway.roll)
				},
				look: { yaw: eased.yaw * lookGain, pitch: eased.pitch * lookGain }
			};
		}
	};
}
