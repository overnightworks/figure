import { describe, expect, it } from 'vitest';
import { frameSeconds, idle, seed, seededRandom, speaking, thinking } from '../tests/figureMotionWatch.js';
import { gestureLengthSeconds } from './gestureClips.js';
import { createFigureMotion, type FigureFacts, type GesturePlay } from './figureMotion.js';
import { figureGesture, type FigureGesture } from './gestures.js';

/** What a run does at a frame: the facts, whether the page asks for reduced motion, and the gestures the host asks for before the frame is drawn. */
interface Frame {
	readonly facts?: FigureFacts;
	readonly reducedMotion?: boolean;
	readonly calls?: readonly FigureGesture[];
}

/** The gesture the pose names at each of `frames` frames of 10 ms, given what happens at the frames `at` selects. */
function gesturesOf(name: FigureGesture, frames: number, at: (frame: number) => Frame = () => ({})): (GesturePlay | null)[] {
	const motion = createFigureMotion(seededRandom(seed));
	return Array.from({ length: frames }, (_, frame) => {
		const { facts = idle, reducedMotion = false, calls = [] } = at(frame);
		calls.forEach((call) => motion.gesture(call));
		return motion.advance(facts, frameSeconds, reducedMotion, null, null).gesture;
	});
}

describe.each(Object.values(figureGesture))('the gesture %s', (name) => {
	const framesToEnd = Math.ceil(gestureLengthSeconds(name) / frameSeconds);
	const calledAt = 20;
	const callAtFrame = (first: number) => (frame: number): Frame => ({ calls: frame === first ? [name] : [] });
	const played = (run: (GesturePlay | null)[]) => run.filter((play): play is GesturePlay => play !== null);

	it('does not play without a call', () => {
		expect(played(gesturesOf(name, framesToEnd + calledAt))).toEqual([]);
	});

	it('plays from 0 to the clip\'s end from the frame after a call and then not at all', () => {
		const run = gesturesOf(name, calledAt + framesToEnd + 100, callAtFrame(calledAt));
		const plays = played(run);

		expect(run.slice(0, calledAt)).toEqual(Array(calledAt).fill(null));
		expect(plays[0]).toEqual({ name, seconds: 0 });
		plays.forEach((play, index) => expect(play.seconds).toBeCloseTo(index * frameSeconds, 9));
		expect(plays.at(-1)!.seconds).toBeLessThan(gestureLengthSeconds(name));
		expect(plays.at(-1)!.seconds + frameSeconds).toBeGreaterThanOrEqual(gestureLengthSeconds(name));
		expect(run.slice(calledAt + plays.length)).toEqual(Array(run.length - calledAt - plays.length).fill(null));
	});

	it('leaves the clock as it was on a second call for the gesture that plays, and starts none after it ends', () => {
		const once = gesturesOf(name, calledAt + framesToEnd + 100, callAtFrame(calledAt));
		const twice = gesturesOf(name, calledAt + framesToEnd + 100, (frame) => ({ calls: frame === calledAt || frame === calledAt + 50 || frame === calledAt + framesToEnd - 1 ? [name] : [] }));

		expect(twice).toEqual(once);
	});

	it('plays again after it ended when called again', () => {
		const second = calledAt + framesToEnd + 5;
		const run = gesturesOf(name, second + 10, (frame) => ({ calls: frame === calledAt || frame === second ? [name] : [] }));

		expect(run[second]).toEqual({ name, seconds: 0 });
	});

	it.each([
		['idle', idle],
		['thinking', thinking],
		['speaking', speaking]
	])('keeps its clock through %s facts', (_, facts) => {
		const reference = gesturesOf(name, calledAt + framesToEnd + 10, callAtFrame(calledAt));
		const withFacts = gesturesOf(name, calledAt + framesToEnd + 10, (frame) => ({ ...callAtFrame(calledAt)(frame), facts: frame % 2 === 0 ? facts : idle }));

		expect(withFacts).toEqual(reference);
	});

	it('starts none under reduced motion, also when the preference is lifted a frame after the call', () => {
		const run = gesturesOf(name, calledAt + framesToEnd, (frame) => ({ ...callAtFrame(calledAt)(frame), reducedMotion: frame <= calledAt }));

		expect(played(run)).toEqual([]);
	});

	it('ends a running gesture at the next frame under reduced motion and does not resume it', () => {
		const run = gesturesOf(name, calledAt + framesToEnd, (frame) => ({ ...callAtFrame(calledAt)(frame), reducedMotion: frame >= calledAt + 30 }));

		expect(played(run)).toHaveLength(30);
		expect(run.slice(calledAt + 30)).toEqual(Array(run.length - calledAt - 30).fill(null));
	});
});
