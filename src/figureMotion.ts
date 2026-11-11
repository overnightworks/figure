import { createIdleMotion, longestStepSeconds } from './idleMotion.js';

/**
 * The figure's motion as a function of the facts the host reports, the time and a source of chance, with no three and no DOM: it
 * owns the order of the states and the blending between them. The states, strongest first, are thinking and idle; further facts
 * join before idle, and the one that is true and strongest decides the gaze.
 *
 * The thinking look is that of hopin's docs/mockups/agent-tile-figure/agent-tile-figure.html in its thinking state: the gaze up and
 * to the figure's side, the head's turn, the blink's weight at 0.8, the idle glance suppressed, and the easing rates. The picture
 * also raises a hand to the chin, which the figure does not do. Under reduced motion the pose is reached and left at once.
 */

/** What the host reports about its agent. */
export interface FigureFacts {
	readonly thinking: boolean;
}

/** What the figure's parts are set to for one frame. */
export interface FigurePose {
	/** The blink expression's weight, 0 to 1. */
	readonly blink: number;
	/** The spine's forward lean in radians. */
	readonly breath: number;
	/** The head's turn in radians, which the frame spreads over the bones the model has. */
	readonly head: { readonly yaw: number; readonly pitch: number; readonly roll: number };
	/** The look-at's angles in degrees. */
	readonly look: { readonly yaw: number; readonly pitch: number };
}

export interface FigureMotion {
	/** The pose `elapsedSeconds` after the last call, given the facts now, while the page asks for reduced motion or not. */
	advance(facts: FigureFacts, elapsedSeconds: number, reducedMotion: boolean): FigurePose;
}

type Gaze = { readonly yaw: number; readonly pitch: number };

/** The gaze while thinking, in degrees: up and to the figure's side. */
const thinkingGaze: Gaze = { yaw: -18, pitch: 13 };
/** The head's extra turn at the full thinking look, in radians, and the blink's share of its weight then. */
const thinkingLook = { head: { yaw: -0.2, pitch: -0.1, roll: 0.16 }, blinkShare: 0.8 };
/** The easing rates per second: the gaze's yaw and pitch, and the thinking look's weight. */
const easing = { yaw: 7, pitch: 6, thinking: 4 };
/** The head turns half the gaze's yaw and tilts 0.55 of its pitch; the look-at turns 2.4 times the gaze. */
const headShare = { yaw: 0.5, pitch: 0.55 };
const lookGain = 2.4;

const radiansPerDegree = Math.PI / 180;

/** The gaze the facts ask for: the thinking gaze while thinking, else the idle glance. */
function gazeFor(facts: FigureFacts, idleGlance: Gaze): Gaze {
	return facts.thinking ? thinkingGaze : idleGlance;
}

export function createFigureMotion(random: () => number): FigureMotion {
	const idle = createIdleMotion(random);
	let gaze: Gaze = { yaw: 0, pitch: 0 };
	let thinkingWeight = 0;

	return {
		advance(facts, elapsedSeconds, reducedMotion) {
			const step = Math.min(elapsedSeconds, longestStepSeconds);
			const base = idle.advance(elapsedSeconds, reducedMotion);
			const ease = (value: number, goal: number, rate: number) => value + (goal - value) * (reducedMotion ? 1 : 1 - Math.exp(-rate * step));
			const goal = gazeFor(facts, base.glance);
			gaze = { yaw: ease(gaze.yaw, goal.yaw, easing.yaw), pitch: ease(gaze.pitch, goal.pitch, easing.pitch) };
			thinkingWeight = ease(thinkingWeight, facts.thinking ? 1 : 0, easing.thinking);
			return {
				blink: base.blink * (facts.thinking ? thinkingLook.blinkShare : 1),
				breath: base.breath,
				head: {
					yaw: gaze.yaw * radiansPerDegree * headShare.yaw + thinkingWeight * thinkingLook.head.yaw + base.sway.yaw,
					pitch: -gaze.pitch * radiansPerDegree * headShare.pitch + thinkingWeight * thinkingLook.head.pitch + base.sway.pitch,
					roll: thinkingWeight * thinkingLook.head.roll + base.sway.roll
				},
				look: { yaw: gaze.yaw * lookGain, pitch: gaze.pitch * lookGain }
			};
		}
	};
}
