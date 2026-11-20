import { describe, expect, it } from 'vitest';
import { easeExtents, extentsOf, fieldOfViewDegrees, placeCamera, type Extents } from './framingCamera.js';
import { figureFraming, type FigureFraming } from './framings.js';

/** The metres from a figure's eyes down to its foot bones. */
const eyesAboveFeet = 1.6;
/** A canvas as the stage draws a phone (portrait) and a desktop (landscape): width over height. */
const canvases = { portrait: 0.8, landscape: 16 / 9 };
/** Where the parts of a standing figure lie in the plane of its eyes, in metres, x to its right and y up from the eyes. */
const body = {
	eyes: { x: 0, y: 0 },
	crown: { x: 0, y: 0.12 },
	chin: { x: 0, y: -0.12 },
	rightShoulder: { x: 0.2, y: -0.2 },
	leftShoulder: { x: -0.2, y: -0.2 },
	rightElbow: { x: 0.25, y: -0.55 },
	hips: { x: 0.1, y: -0.95 },
	feet: { x: 0.1, y: -eyesAboveFeet }
};
type Part = keyof typeof body;

const framingNames = Object.values(figureFraming);
const orderedChanges = framingNames.flatMap((from) => framingNames.filter((to) => to !== from).map((to) => [from, to] as const));

/** Whether a camera placed for `extents` on a canvas of `aspect` shows `part`: the pinhole's view of the plane of the eyes. */
function shows(extents: Extents, aspect: number, part: Part): boolean {
	const { heightFromEyes, distance } = placeCamera(extents, aspect);
	const reach = distance * Math.tan((fieldOfViewDegrees / 2) * (Math.PI / 180));
	return Math.abs(body[part].y - heightFromEyes) <= reach && Math.abs(body[part].x) <= reach * aspect;
}

const shownParts = (framing: FigureFraming, aspect: number): Part[] =>
	(Object.keys(body) as Part[]).filter((part) => shows(extentsOf(framing, eyesAboveFeet), aspect, part));

describe.each(Object.entries(canvases))('the picture on a %s canvas', (_, aspect) => {
	it('frames the head and shoulders by the eyes above the middle, both shoulders in and the feet out', () => {
		const extents = extentsOf(figureFraming.shoulders, eyesAboveFeet);
		expect(shownParts(figureFraming.shoulders, aspect)).toEqual(expect.arrayContaining(['eyes', 'crown', 'chin', 'rightShoulder', 'leftShoulder']));
		expect(shows(extents, aspect, 'feet')).toBe(false);
		expect(placeCamera(extents, aspect).heightFromEyes).toBeLessThan(body.eyes.y);
	});

	it.each(framingNames)('shows the face when it frames %s', (framing) => {
		expect(shownParts(framing, aspect)).toEqual(expect.arrayContaining(['eyes', 'crown', 'chin']));
	});

	it('shows the face alone in the face framing', () => {
		expect(shownParts(figureFraming.face, aspect)).toEqual(['eyes', 'crown', 'chin']);
	});

	it('shows down to the elbows but not the feet in the upper body framing', () => {
		expect(shownParts(figureFraming.upperBody, aspect)).toEqual(expect.arrayContaining(['rightShoulder', 'leftShoulder', 'rightElbow']));
		expect(shownParts(figureFraming.upperBody, aspect)).not.toContain('feet');
	});

	it('shows the whole body in the full body framing', () => {
		expect(shownParts(figureFraming.fullBody, aspect)).toEqual(Object.keys(body));
	});

	it('shows more of the figure, never less, as the framing widens', () => {
		const counts = framingNames.map((framing) => shownParts(framing, aspect).length);
		expect(counts).toEqual([...counts].sort((first, second) => first - second));
	});
});

describe('the full body of a figure of another height', () => {
	it.each([1.0, 1.6, 2.4])('ends a little below the foot bones of a figure whose eyes are %s m above them', (height) => {
		const { below } = extentsOf(figureFraming.fullBody, height);
		expect(below).toBeGreaterThan(height);
		expect(below).toBeLessThan(height + 0.1);
	});
});

describe('the framings above the full body for a figure of another height', () => {
	const fixedFramings = framingNames.filter((framing) => framing !== figureFraming.fullBody);

	it.each(fixedFramings.flatMap((framing) => [0.2, 1.0, 2.4].map((height) => [framing, height] as const)))(
		'shows %s the same extents for a figure whose eyes are %s m above its foot bones as for a standing one',
		(framing, height) => {
			expect(extentsOf(framing, height)).toEqual(extentsOf(framing, eyesAboveFeet));
		}
	);
});

const secondsPerFrame = 1 / 60;
const coordinates = (extents: Extents) => [extents.above, extents.below, extents.halfWidth];

/** The extents after `seconds` of easing toward `target`, in frames of `step` seconds. */
function easedFor(start: Extents, target: Extents, seconds: number, step = secondsPerFrame): Extents {
	let current = start;
	for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += step) current = easeExtents(current, target, step);
	return current;
}

describe.each(orderedChanges)('a change from %s to %s', (from, to) => {
	const start = extentsOf(from, eyesAboveFeet);
	const target = extentsOf(to, eyesAboveFeet);
	const gap = (extents: Extents) => coordinates(extents).map((value, index) => Math.abs(value - coordinates(target)[index]!));
	const startGap = gap(start);

	it('draws near the start in the first frame and most of the way to the target after about 0.6 s', () => {
		const first = gap(easedFor(start, target, secondsPerFrame));
		const settling = gap(easedFor(start, target, 0.6));
		startGap.forEach((distance, index) => {
			if (distance === 0) return;
			expect(first[index]! / distance).toBeGreaterThan(0.8);
			expect(settling[index]! / distance).toBeLessThan(0.1);
		});
	});

	it('moves every extent toward the target and never past it', () => {
		let current = start;
		for (let frame = 0; frame < 300; frame++) {
			const next = easeExtents(current, target, secondsPerFrame);
			gap(next).forEach((distance, index) => expect(distance).toBeLessThanOrEqual(gap(current)[index]! + 1e-12));
			coordinates(next).forEach((value, index) => {
				const [low, high] = [coordinates(start)[index]!, coordinates(target)[index]!].sort((first, second) => first - second);
				expect(value).toBeGreaterThanOrEqual(low! - 1e-12);
				expect(value).toBeLessThanOrEqual(high! + 1e-12);
			});
			current = next;
		}
	});

	it('arrives exactly at the target and stays there', () => {
		const arrived = easedFor(start, target, 5);
		expect(arrived).toEqual(target);
		expect(easeExtents(arrived, target, secondsPerFrame)).toEqual(target);
	});
});

describe('a call during a change', () => {
	const start = extentsOf(figureFraming.shoulders, eyesAboveFeet);
	const first = extentsOf(figureFraming.fullBody, eyesAboveFeet);
	const second = extentsOf(figureFraming.face, eyesAboveFeet);

	it('continues from the picture it is in, with no jump, toward the new target', () => {
		const midway = easedFor(start, first, 0.2);
		const next = easeExtents(midway, second, secondsPerFrame);
		coordinates(next).forEach((value, index) => {
			const [from, to] = [coordinates(midway)[index]!, coordinates(second)[index]!];
			expect(Math.abs(value - from)).toBeLessThan(Math.abs(to - from));
			expect(Math.sign(value - from) * Math.sign(to - from)).toBeGreaterThanOrEqual(0);
		});
		expect(easedFor(midway, second, 5)).toEqual(second);
	});
});

describe('the ease', () => {
	const start = extentsOf(figureFraming.face, eyesAboveFeet);
	const target = extentsOf(figureFraming.fullBody, eyesAboveFeet);

	it('covers the same distance in the same time at any frame rate', () => {
		const slow = easedFor(start, target, 0.3, 1 / 30);
		const fast = easedFor(start, target, 0.3, 1 / 240);
		coordinates(slow).forEach((value, index) => expect(value).toBeCloseTo(coordinates(fast)[index]!, 9));
	});

	it('leaves the picture as it is when no time passed', () => {
		expect(easeExtents(start, target, 0)).toEqual(start);
	});
});
