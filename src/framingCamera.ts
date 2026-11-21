import type { FigureFraming } from './framings.js';

/** The camera's field of view, in degrees: narrow, so the figure is drawn nearly without perspective. */
export const fieldOfViewDegrees = 22;

/** What a picture shows around the eyes, in metres: above them, below them and to either side of them. */
export interface Extents {
	readonly above: number;
	readonly below: number;
	readonly halfWidth: number;
}

/** The metres a full body shows below the foot bones: the camera does not depend on a room, so a room's floor at y = 0 is seen where it lies. */
const footMargin = 0.05;

/** The `below` of a framing that shows down to the feet, wherever they are. */
const toTheFeet = Number.POSITIVE_INFINITY;

/** The extents of each framing; only the full body depends on the figure, by showing down to its feet. */
const extentsOfFraming: Readonly<Record<FigureFraming, Extents>> = {
	face: { above: 0.15, below: 0.15, halfWidth: 0.14 },
	shoulders: { above: 0.25, below: 0.4, halfWidth: 0.31 },
	upperBody: { above: 0.43, below: 0.75, halfWidth: 0.45 },
	fullBody: { above: 0.7, below: toTheFeet, halfWidth: 0.6 }
};

/** What `framing` shows of a figure whose eyes are `eyesAboveFeet` metres above its foot bones: the same for every figure, except that the full body ends at the feet and a margin. */
export function extentsOf(framing: FigureFraming, eyesAboveFeet: number): Extents {
	const wanted = extentsOfFraming[framing];
	return wanted.below === toTheFeet ? { ...wanted, below: eyesAboveFeet + footMargin } : wanted;
}

/** The share of the way to its target a picture goes each second, as an exponential rate: about 95 % of the way in 0.6 s. */
const easeRatePerSecond = 5;
/** The metres from the target at which a picture counts as arrived and is set to it. */
const arrivedWithin = 0.002;

/**
 * The extents a picture shows `elapsedSeconds` after it showed `current`, easing toward `target`: the same distance in the same time at
 * any frame rate, and from wherever `current` is, so a new target during a change continues from the picture it is in.
 */
export function easeExtents(current: Extents, target: Extents, elapsedSeconds: number): Extents {
	const share = 1 - Math.exp(-easeRatePerSecond * elapsedSeconds);
	const ease = (from: number, to: number) => (Math.abs(to - from) <= arrivedWithin ? to : from + (to - from) * share);
	return { above: ease(current.above, target.above), below: ease(current.below, target.below), halfWidth: ease(current.halfWidth, target.halfWidth) };
}

/** Where the camera stands, looking straight at the plane of the eyes: its height relative to the eyes and its distance from the plane, in metres. */
export interface CameraPlacement {
	readonly heightFromEyes: number;
	readonly distance: number;
}

/** The camera that shows `extents` whole on a canvas of `aspect` (width over height): centred on them, as far back as the taller or the wider need. */
export function placeCamera(extents: Extents, aspect: number): CameraPlacement {
	const tangent = Math.tan((fieldOfViewDegrees / 2) * (Math.PI / 180));
	return {
		heightFromEyes: (extents.above - extents.below) / 2,
		distance: Math.max((extents.above + extents.below) / 2 / tangent, extents.halfWidth / (tangent * aspect))
	};
}
