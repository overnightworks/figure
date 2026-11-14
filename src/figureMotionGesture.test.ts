import { describe, expect, it } from 'vitest';
import { frameSeconds, idle, seed, seededRandom, speaking, thinking } from '../tests/figureMotionWatch.js';
import { gestureClips, gestureLengthSeconds, type ClipTiming } from './gestureClips.js';
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
	const framesToEnd = Math.ceil(gestureLengthSeconds(gestureClips[name]) / frameSeconds);
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
		expect(plays[0]).toEqual({ name, seconds: 0, clip: gestureClips[name] });
		plays.forEach((play, index) => expect(play.seconds).toBeCloseTo(index * frameSeconds, 9));
		expect(plays.at(-1)!.seconds).toBeLessThan(gestureLengthSeconds(gestureClips[name]));
		expect(plays.at(-1)!.seconds + frameSeconds).toBeGreaterThanOrEqual(gestureLengthSeconds(gestureClips[name]));
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

		expect(run[second]).toEqual({ name, seconds: 0, clip: gestureClips[name] });
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

			it('folds the forearm ahead of the upper arm on the way back to the chin', () => {
				const shareOf = (frame: number, bone: 'rightUpperArm' | 'rightLowerArm', axis: 'roll' | 'yaw') => {
					const [rest, chin] = [resting[frame]!.arms[bone][axis], thinkingOnly[frame]!.arms[bone][axis]];
					return (reduced[frame]!.arms[bone][axis] - rest) / (chin - rest);
				};
				const returning = reduced.map((_, frame) => frame).slice(lastShownFrame + 1);
				const shares = returning.map((frame) => ({ upper: shareOf(frame, 'rightUpperArm', 'roll'), fore: shareOf(frame, 'rightLowerArm', 'yaw') }));

				shares.forEach(({ upper, fore }) => expect(fore).toBeGreaterThanOrEqual(upper - 1e-9));
				expect(shares.some(({ upper, fore }) => upper > 0.05 && upper < 0.95 && fore > upper + 0.05)).toBe(true);
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

describe('the clock of a gesture whose clip can be replaced', () => {
	const name = figureGesture.wave;
	const timingOf = (durationSeconds: number): ClipTiming => ({ ...gestureClips[name], durationSeconds });
	const original = timingOf(gestureClips[name].durationSeconds);
	const longer = timingOf(gestureClips[name].durationSeconds * 2);
	const shorter = timingOf(gestureClips[name].durationSeconds / 2);

	const played = (plays: (GesturePlay | null)[]) => plays.filter((play): play is GesturePlay => play !== null);
	/** The gesture's clock runs to the clip's length: its last second shown is within one frame of it. */
	const expectRunsToLengthOf = (plays: GesturePlay[], clip: ClipTiming) => {
		expect(plays.at(-1)!.seconds).toBeLessThan(gestureLengthSeconds(clip));
		expect(plays.at(-1)!.seconds + frameSeconds).toBeGreaterThanOrEqual(gestureLengthSeconds(clip));
	};

	it.each([
		['a longer one', longer],
		['a shorter one', shorter]
	])('plays the clip it started with to its own length when %s replaces it during the gesture', (_, replacement) => {
		let current = original;
		const motion = createFigureMotion(seededRandom(seed), () => current);
		motion.gesture(name);
		const plays = Array.from({ length: 1000 }, (_, frame) => {
			if (frame === 50) current = replacement;
			return motion.advance(idle, frameSeconds, false, null, null).gesture;
		});

		played(plays).forEach((play) => expect(play.clip).toBe(original));
		expectRunsToLengthOf(played(plays), original);
	});

	it('starts the next gesture with the clip that replaced it, for that clip\'s own length', () => {
		let current = original;
		const motion = createFigureMotion(seededRandom(seed), () => current);
		const advance = () => motion.advance(idle, frameSeconds, false, null, null).gesture;
		motion.gesture(name);
		for (let frame = 0; frame < 400; frame++) advance();
		current = longer;
		motion.gesture(name);
		const plays = played(Array.from({ length: 1000 }, advance));

		expect(plays[0]).toEqual({ name, seconds: 0, clip: longer });
		plays.forEach((play) => expect(play.clip).toBe(longer));
		expectRunsToLengthOf(plays, longer);
	});

	it('lets the base pose\'s arm give way only when the clip that plays has an arm bone', () => {
		const rightUpperArmRolls = (clip: ClipTiming, call: boolean) => {
			const motion = createFigureMotion(seededRandom(seed), () => clip);
			for (let frame = 0; frame < 400; frame++) motion.advance(thinking, frameSeconds, false, null, null);
			if (call) motion.gesture(name);
			return Array.from({ length: 60 }, () => motion.advance(thinking, frameSeconds, false, null, null).arms.rightUpperArm.roll);
		};
		const withoutArm: ClipTiming = { ...original, bones: ['spine'] };

		expect(rightUpperArmRolls(withoutArm, true)).toEqual(rightUpperArmRolls(withoutArm, false));
		expect(rightUpperArmRolls(original, true)).not.toEqual(rightUpperArmRolls(original, false));
	});

	it('runs a clip without bones for its duration alone', () => {
		const bare: ClipTiming = { ...original, bones: [] };
		const motion = createFigureMotion(seededRandom(seed), () => bare);
		motion.gesture(name);
		const plays = played(Array.from({ length: 400 }, () => motion.advance(idle, frameSeconds, false, null, null).gesture));

		expectRunsToLengthOf(plays, bare);
		expect(gestureLengthSeconds(bare)).toBe(bare.durationSeconds);
	});
});
