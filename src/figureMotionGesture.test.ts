import { describe, expect, it } from 'vitest';
import { frameSeconds, idle, seed, seededRandom, speaking, thinking } from '../tests/figureMotionWatch.js';
import { gestureClips, gestureLengthSeconds } from './gestureClips.js';
import { createFigureMotion, type FigureFacts, type FigurePose, type GesturePlay } from './figureMotion.js';
import { figureGesture, type FigureGesture } from './gestures.js';

/** What a run does at a frame: the facts, whether the page asks for reduced motion, and the gestures the host asks for before the frame is drawn. */
interface Frame {
	readonly facts?: FigureFacts;
	readonly reducedMotion?: boolean;
	readonly calls?: readonly FigureGesture[];
}

/** The poses at each of `frames` frames of 10 ms, given what happens at the frames `at` selects. */
function posesOf(frames: number, at: (frame: number) => Frame = () => ({})): FigurePose[] {
	const motion = createFigureMotion(seededRandom(seed));
	return Array.from({ length: frames }, (_, frame) => {
		const { facts = idle, reducedMotion = false, calls = [] } = at(frame);
		calls.forEach((call) => motion.gesture(call));
		return motion.advance(facts, frameSeconds, reducedMotion, null, null);
	});
}

/** The gesture the pose names at each of `frames` frames of 10 ms, given what happens at the frames `at` selects. */
function gesturesOf(frames: number, at: (frame: number) => Frame = () => ({})): (GesturePlay | null)[] {
	return posesOf(frames, at).map(({ gesture }) => gesture);
}

describe.each(Object.values(figureGesture))('the gesture %s', (name) => {
	const framesToEnd = Math.ceil(gestureLengthSeconds(name) / frameSeconds);
	const calledAt = 20;
	const callAtFrame = (first: number) => (frame: number): Frame => ({ calls: frame === first ? [name] : [] });
	const played = (run: (GesturePlay | null)[]) => run.filter((play): play is GesturePlay => play !== null);

	it('does not play without a call', () => {
		expect(played(gesturesOf(framesToEnd + calledAt))).toEqual([]);
	});

	it('plays from 0 to the clip\'s end from the frame after a call and then not at all', () => {
		const run = gesturesOf(calledAt + framesToEnd + 100, callAtFrame(calledAt));
		const plays = played(run);

		expect(run.slice(0, calledAt)).toEqual(Array(calledAt).fill(null));
		expect(plays[0]).toEqual({ name, seconds: 0 });
		plays.forEach((play, index) => expect(play.seconds).toBeCloseTo(index * frameSeconds, 9));
		expect(plays.at(-1)!.seconds).toBeLessThan(gestureLengthSeconds(name));
		expect(plays.at(-1)!.seconds + frameSeconds).toBeGreaterThanOrEqual(gestureLengthSeconds(name));
		expect(run.slice(calledAt + plays.length)).toEqual(Array(run.length - calledAt - plays.length).fill(null));
	});

	it('leaves the clock as it was on a second call for the gesture that plays, and starts none after it ends', () => {
		const once = gesturesOf(calledAt + framesToEnd + 100, callAtFrame(calledAt));
		const twice = gesturesOf(calledAt + framesToEnd + 100, (frame) => ({ calls: frame === calledAt || frame === calledAt + 50 || frame === calledAt + framesToEnd - 1 ? [name] : [] }));

		expect(twice).toEqual(once);
	});

	it('plays again after it ended when called again', () => {
		const second = calledAt + framesToEnd + 5;
		const run = gesturesOf(second + 10, (frame) => ({ calls: frame === calledAt || frame === second ? [name] : [] }));

		expect(run[second]).toEqual({ name, seconds: 0 });
	});

	it.each([
		['idle', idle],
		['thinking', thinking],
		['speaking', speaking]
	])('keeps its clock through %s facts', (_, facts) => {
		const reference = gesturesOf(calledAt + framesToEnd + 10, callAtFrame(calledAt));
		const withFacts = gesturesOf(calledAt + framesToEnd + 10, (frame) => ({ ...callAtFrame(calledAt)(frame), facts: frame % 2 === 0 ? facts : idle }));

		expect(withFacts).toEqual(reference);
	});

	it('starts none under reduced motion, also when the preference is lifted a frame after the call', () => {
		const run = gesturesOf(calledAt + framesToEnd, (frame) => ({ ...callAtFrame(calledAt)(frame), reducedMotion: frame <= calledAt }));

		expect(played(run)).toEqual([]);
	});

	it('ends a running gesture at the next frame under reduced motion and does not resume it', () => {
		const run = gesturesOf(calledAt + framesToEnd, (frame) => ({ ...callAtFrame(calledAt)(frame), reducedMotion: frame >= calledAt + 30 && frame < calledAt + 40 }));

		expect(played(run)).toHaveLength(30);
		expect(run.slice(calledAt + 30)).toEqual(Array(run.length - calledAt - 30).fill(null));
	});

	describe('while the figure thinks', () => {
		const thinkingFrames = 400;
		const clip = gestureClips[name];
		const frames = thinkingFrames + framesToEnd + 100;
		const call = (frame: number): Frame => ({ facts: thinking, calls: frame === thinkingFrames ? [name] : [] });
		const withGesture = posesOf(frames, call);
		const thinkingOnly = posesOf(frames, () => ({ facts: thinking }));
		const resting = posesOf(frames, () => ({ facts: idle }));
		const midClip = thinkingFrames + Math.round(clip.durationSeconds / 2 / frameSeconds);

		it('holds the arm at the chin until the gesture starts', () => {
			expect(withGesture[thinkingFrames - 1]!.arms).toEqual(thinkingOnly[thinkingFrames - 1]!.arms);
		});

		it('lets the base pose\'s right arm give way to the arm at rest while the clip is fully shown', () => {
			expect(withGesture[midClip]!.arms.rightUpperArm).toEqual(resting[midClip]!.arms.rightUpperArm);
			expect(withGesture[midClip]!.arms.rightLowerArm).toEqual(resting[midClip]!.arms.rightLowerArm);
			expect(withGesture[midClip]!.arms.rightUpperArm).not.toEqual(thinkingOnly[midClip]!.arms.rightUpperArm);
		});

		it('brings the base pose\'s right arm back to the chin once the gesture ended', () => {
			expect(withGesture.at(-1)!.arms).toEqual(thinkingOnly.at(-1)!.arms);
		});

		describe('when reduced motion ends it', () => {
			const lastShownFrame = midClip;
			const reducedFrom = (frame: number): Frame => ({ ...call(frame), reducedMotion: frame > lastShownFrame });
			const reduced = posesOf(frames, reducedFrom);
			const chinShares = reduced.slice(lastShownFrame).map(({ arms }, frame) => {
				const [rest, chin] = [resting[lastShownFrame + frame]!.arms.rightUpperArm.roll, thinkingOnly[lastShownFrame + frame]!.arms.rightUpperArm.roll];
				return (arms.rightUpperArm.roll - rest) / (chin - rest);
			});

			it('plays no gesture from the next frame', () => {
				expect(reduced.slice(lastShownFrame + 1).map(({ gesture }) => gesture)).toEqual(Array(frames - lastShownFrame - 1).fill(null));
			});

			it('eases the base arm back to the chin without a jump', () => {
				const steps = chinShares.slice(1).map((share, frame) => share - chinShares[frame]!);

				expect(Math.max(...steps)).toBeLessThan(0.1);
				expect(Math.min(...steps)).toBeGreaterThanOrEqual(0);
				expect(chinShares[1]).toBeLessThan(0.1);
				expect(chinShares.at(-1)).toBeCloseTo(1, 3);
			});
		});
	});
});
