import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { centreOf, emulateReducedMotion, faceDifference, mouthRows, restorePageVisibility, setPageVisibility } from '../tests/browserCanvas.js';
import { vrmParts } from '../tests/figureFixtures.js';
import { buildGlb } from '../tests/glbBuilder.js';
import { startFigureWatch, type FigureWatch } from '../tests/figureWatch.js';
import { syntheticVoice, type SyntheticVoice } from '../tests/syntheticVoice.js';
import { figureMood, mouthShape, type FigureMood, type MouthShape } from './expressions.js';
import type { FigureHandle } from './draw.js';
import { figureSignal } from './signals.js';
import { analysisWindowLength } from './vowelWeights.js';

/** The rows by which an open vowel's mouth has to exceed the closed one, and by which the flat vowel's has to fall short of it, at a canvas 200 wide; the sway of the head moves a closed mouth by a row. */
const openedRows = 4;
const flattenedRows = 3;
const swayRows = 1;
/** The page's own frame request, which the tests wait on without the watch counting it. */
const requestFrameOwn = window.requestAnimationFrame;
/** How far a speaker at the far side of the page turns the nose, in pixels at a canvas 200 wide, and how far the thinking look turns it the other way. */
const turnedPixels = 10;
/** How far the sway moves the nose, in pixels at a canvas 200 wide; the idle glance turns it by far more, and the glance moves a closed mouth's rows by more than the sway does. */
const swayPixels = 2;
/** The pictures in which a mouth that should not move is judged, every one of them, and over which the head's resting pose is read. */
const stillPictures = 15;
/**
 * The nose's lift, in pixels at a canvas 200 wide, below which a glance leaves a closed mouth's rows as they are, and the rows the mouth's window gains
 * for each pixel of lift past it: a head turned up shows more of the mouth below the nose. A closed mouth stays within these of its resting rows at
 * every pose the idle glance reaches, and an open vowel's mouth lies beyond them at every one.
 */
const unmovedLift = 1;
const rowsPerLiftedPixel = 1.25;
/** The dark pixels of the face a neutral picture differs from the neutral baseline by, at most, even with the sway's drift, and the fewest a shown mood's differs by; the least any of the five moods moves is well over the first. */
const neutralFaceDifference = 60;
const shownFaceDifference = 100;
/** What a settled face's consecutive pictures differ by at most, and how many of them in a row show the face has stopped easing. */
const settledFaceDifference = 30;
const settledPictures = 3;
/** The pictures over whose least difference the face is judged. */
const shownPictures = 7;
const farRight = 5000;
const level = 100;

/** The mouth's rows and the nose's centre in one picture. */
interface Picture {
	readonly rows: number;
	readonly nose: { readonly x: number; readonly y: number };
}

/** Whether `picture` shows the nose where the sway leaves it around `pose`'s. */
function atRest(picture: Picture, pose: Picture): boolean {
	return Math.abs(picture.nose.x - pose.nose.x) <= swayPixels && Math.abs(picture.nose.y - pose.nose.y) <= swayPixels;
}

describe('a figure whose agent speaks', () => {
	let watch: FigureWatch;
	const contexts: AudioContext[] = [];
	const voices: SyntheticVoice[] = [];
	const speakers: HTMLElement[] = [];

	beforeEach(async () => {
		watch = startFigureWatch();
		await userActivation();
	});

	afterEach(async () => {
		watch.end();
		restorePageVisibility();
		voices.splice(0).forEach((voice) => voice.stop());
		speakers.splice(0).forEach((speaker) => speaker.remove());
		await Promise.all(contexts.splice(0).map((context) => (context.state === 'closed' ? undefined : context.close())));
		await cdp().send('Emulation.setEmulatedMedia', { features: [] });
	});

	/** Gives the page a user activation, which the browser requires before an audio context runs. */
	async function userActivation(): Promise<void> {
		const button = document.createElement('button');
		document.body.append(button);
		await userEvent.click(button);
		button.remove();
	}

	/** A running audio context of the page. */
	async function runningContext(): Promise<AudioContext> {
		const context = new AudioContext();
		contexts.push(context);
		await context.resume();
		return context;
	}

	/** A voice of real nodes holding `vowel`, silent when its `gain` is 0. */
	function voiceOn(context: AudioContext, vowel: MouthShape, gain?: number): GainNode {
		const voice = syntheticVoice(context, vowel, gain);
		voices.push(voice);
		return voice.output;
	}

	/** The analysers `context` has made so far, in the order it made them; the context still makes real ones. */
	function analysersOf(context: AudioContext): () => AnalyserNode[] {
		const creation = vi.spyOn(context, 'createAnalyser');
		return () => creation.mock.results.flatMap((result) => (result.type === 'return' ? [result.value] : []));
	}

	/** The rows the mouth covers in the figure's next picture. */
	async function mouthNow(canvas: HTMLCanvasElement): Promise<number> {
		return mouthRows(await watch.featuresNow(canvas));
	}

	/** The nose in the figure's next picture. */
	async function noseNow(canvas: HTMLCanvasElement) {
		return centreOf((await watch.featuresNow(canvas)).nose);
	}

	/** Waits until the mouth covers at least `rows`, or at most `rows` when `atMost`. */
	async function waitForMouth(canvas: HTMLCanvasElement, test: (rows: number) => boolean): Promise<void> {
		await vi.waitFor(async () => expect(test(await mouthNow(canvas))).toBe(true), { timeout: 15000 });
	}

	/** The mouth and the nose in the figure's next picture. */
	async function pictureNow(canvas: HTMLCanvasElement): Promise<Picture> {
		const features = await watch.featuresNow(canvas);
		return { rows: mouthRows(features), nose: centreOf(features.nose) };
	}

	/** The mouth of the head's most common pose in the next `stillPictures` pictures, which the idle glance cannot outvote. */
	async function restingMouth(canvas: HTMLCanvasElement): Promise<Picture> {
		const pictures: Picture[] = [];
		for (let picture = 0; picture < stillPictures; picture++) pictures.push(await pictureNow(canvas));
		const atPose = (pose: Picture) => pictures.filter((picture) => atRest(picture, pose));
		const commonest = pictures.reduce((best, picture) => (atPose(picture).length > atPose(best).length ? picture : best));
		const rows = atPose(commonest).map((picture) => picture.rows).sort((first, second) => first - second);
		return { rows: rows[Math.floor(rows.length / 2)]!, nose: commonest.nose };
	}

	/** Expects the mouth to lie, in each of the next `stillPictures` pictures, within the flat vowel's distance of `resting` plus what the head's lift adds to a closed mouth's rows. */
	async function expectMouthStays(canvas: HTMLCanvasElement, resting: Picture): Promise<void> {
		for (let read = 0; read < stillPictures; read++) {
			const picture = await pictureNow(canvas);
			const lift = Math.max(0, resting.nose.y - picture.nose.y - unmovedLift);
			expect(Math.abs(picture.rows - resting.rows)).toBeLessThan(flattenedRows + rowsPerLiftedPixel * lift);
		}
	}

	/** Puts a small element of the page at `x` and `y` CSS pixels from the viewport's top left. */
	function speakerAt(x: number, y: number): HTMLElement {
		const speaker = document.createElement('div');
		speaker.style.cssText = `position: fixed; left: ${x}px; top: ${y}px; width: 20px; height: 20px`;
		document.body.append(speaker);
		speakers.push(speaker);
		return speaker;
	}

	/** A figure mounted with a running context and the analysers it makes. */
	async function figureWithContext(): Promise<{ canvas: HTMLCanvasElement; handle: FigureHandle; context: AudioContext; analysers: () => AnalyserNode[] }> {
		const context = await runningContext();
		const analysers = analysersOf(context);
		return { ...(await watch.mountFigure()), context, analysers };
	}

	describe.each([
		['normal motion', false],
		['reduced motion', true]
	])('in %s', (_, reduced) => {
		beforeEach(async () => {
			if (reduced) await emulateReducedMotion();
		});

		it('opens the mouth for a synthesized open vowel and closes it on speak(null)', async () => {
			const { canvas, handle, context } = await figureWithContext();
			const resting = await mouthNow(canvas);

			handle.speak({ voice: voiceOn(context, mouthShape.aa) });
			await waitForMouth(canvas, (rows) => rows >= resting + openedRows);
			handle.speak(null);

			await waitForMouth(canvas, (rows) => rows <= resting + swayRows);
		});

		it('gives two mouth shapes for two vowels', async () => {
			const { canvas, handle, context } = await figureWithContext();
			const resting = await mouthNow(canvas);

			handle.speak({ voice: voiceOn(context, mouthShape.aa) });
			await waitForMouth(canvas, (rows) => rows >= resting + openedRows);
			handle.speak({ voice: voiceOn(context, mouthShape.ih) });

			await waitForMouth(canvas, (rows) => rows <= resting - flattenedRows);
		});

		it('keeps the mouth closed for silence on a tapped voice and for speak({})', async () => {
			const { canvas, handle, context, analysers } = await figureWithContext();
			const resting = await restingMouth(canvas);

			handle.speak({ voice: voiceOn(context, mouthShape.aa, 0) });
			expect(analysers()).toHaveLength(1);
			await expectMouthStays(canvas, resting);
			handle.speak({});
			await expectMouthStays(canvas, resting);
		});
	});

	describe('the tap', () => {
		it('gives its analyser the smallest block that covers the window the analysis reads', async () => {
			const { handle, context, analysers } = await figureWithContext();

			handle.speak({ voice: voiceOn(context, mouthShape.aa) });

			const block = analysers()[0]!.fftSize;
			expect(block).toBeGreaterThanOrEqual(analysisWindowLength(context.sampleRate));
			expect(block / 2).toBeLessThan(analysisWindowLength(context.sampleRate));
		});

		it('connects its own analyser to a voice once, keeps it for the same voice and disconnects exactly it once on speak(null)', async () => {
			const { handle, context, analysers } = await figureWithContext();
			const voice = voiceOn(context, mouthShape.aa);
			const connect = vi.spyOn(voice, 'connect');
			const disconnect = vi.spyOn(voice, 'disconnect');

			handle.speak({ voice });
			handle.speak({ voice });

			expect(analysers()).toHaveLength(1);
			expect(connect).toHaveBeenCalledTimes(1);
			expect(connect.mock.calls[0]).toHaveLength(1);
			expect(connect.mock.calls[0]![0]).toBe(analysers()[0]);
			expect(disconnect).not.toHaveBeenCalled();

			handle.speak(null);
			handle.speak(null);
			handle.speak({});
			handle.dispose();

			expect(disconnect).toHaveBeenCalledTimes(1);
			expect(disconnect.mock.calls[0]).toHaveLength(1);
			expect(disconnect.mock.calls[0]![0]).toBe(analysers()[0]);
		});

		it('releases the first voice and follows the second when another voice comes', async () => {
			const { canvas, handle, context, analysers } = await figureWithContext();
			const resting = await mouthNow(canvas);
			const first = voiceOn(context, mouthShape.aa);
			const second = voiceOn(context, mouthShape.ih);
			const firstDisconnect = vi.spyOn(first, 'disconnect');
			const secondConnect = vi.spyOn(second, 'connect');
			const secondDisconnect = vi.spyOn(second, 'disconnect');

			handle.speak({ voice: first });
			handle.speak({ voice: second });

			expect(analysers()).toHaveLength(2);
			expect(firstDisconnect).toHaveBeenCalledTimes(1);
			expect(firstDisconnect.mock.calls[0]![0]).toBe(analysers()[0]);
			expect(secondConnect).toHaveBeenCalledTimes(1);
			expect(secondConnect.mock.calls[0]![0]).toBe(analysers()[1]);
			expect(secondDisconnect).not.toHaveBeenCalled();
			await waitForMouth(canvas, (rows) => rows <= resting - flattenedRows);
		});

		it('releases the tap on speak({}) and connects nothing to a destination', async () => {
			const { handle, context, analysers } = await figureWithContext();
			const voice = voiceOn(context, mouthShape.aa);
			const connect = vi.spyOn(voice, 'connect');
			const disconnect = vi.spyOn(voice, 'disconnect');

			handle.speak({ voice });
			handle.speak({});

			expect(disconnect).toHaveBeenCalledTimes(1);
			expect(disconnect.mock.calls[0]![0]).toBe(analysers()[0]);
			expect(connect.mock.calls.map(([target]) => target)).toEqual([analysers()[0]]);
		});

		it('reads nothing while the page is hidden and follows the voice again when it is shown', async () => {
			const { canvas, handle, context, analysers } = await figureWithContext();
			const resting = await mouthNow(canvas);
			handle.speak({ voice: voiceOn(context, mouthShape.aa) });
			await waitForMouth(canvas, (rows) => rows >= resting + openedRows);
			const reads = vi.spyOn(analysers()[0]!, 'getFloatTimeDomainData');

			setPageVisibility('hidden');
			const hiddenAt = reads.mock.calls.length;
			await new Promise<void>((resolve) => requestFrameOwn.call(window, () => resolve()));
			await new Promise<void>((resolve) => requestFrameOwn.call(window, () => resolve()));
			expect(reads.mock.calls).toHaveLength(hiddenAt);

			setPageVisibility('visible');
			await vi.waitFor(() => expect(reads.mock.calls.length).toBeGreaterThan(hiddenAt));
			await waitForMouth(canvas, (rows) => rows >= resting + openedRows);
		});

		it('does not read a suspended context, and follows the voice once the context runs', async () => {
			const { canvas, handle, context } = await figureWithContext();
			const resting = await restingMouth(canvas);
			await context.suspend();

			handle.speak({ voice: voiceOn(context, mouthShape.aa) });
			await expectMouthStays(canvas, resting);
			await context.resume();

			await waitForMouth(canvas, (rows) => rows >= resting.rows + openedRows);
		});

		it('closes the mouth while a context that was running is suspended, and opens it again once the context runs', async () => {
			const { canvas, handle, context } = await figureWithContext();
			const resting = await restingMouth(canvas);
			handle.speak({ voice: voiceOn(context, mouthShape.aa) });
			await waitForMouth(canvas, (rows) => rows >= resting.rows + openedRows);

			await context.suspend();
			await waitForMouth(canvas, (rows) => rows <= resting.rows + swayRows);
			await expectMouthStays(canvas, resting);
			await context.resume();

			await waitForMouth(canvas, (rows) => rows >= resting.rows + openedRows);
		});
	});

	describe('a voice that cannot be tapped', () => {
		/** The faults a host's voice can have, each as a way to arrange them on a running context; `tapped` is whether the context makes an analyser. */
		const faults: readonly [string, (context: AudioContext) => unknown][] = [
			[
				'a connect that throws',
				(context) => {
					const voice = voiceOn(context, mouthShape.aa);
					vi.spyOn(voice, 'connect').mockImplementation(() => {
						throw new Error('refused');
					});
					return voice;
				}
			],
			[
				'a createAnalyser that throws',
				(context) => {
					vi.spyOn(context, 'createAnalyser').mockImplementation(() => {
						throw new Error('refused');
					});
					return voiceOn(context, mouthShape.aa);
				}
			],
			['a string', () => 'a voice'],
			['a plain object', () => ({ connect: () => undefined })]
		];

		it.each(faults)('speaks with a still mouth and throws nothing for %s', async (_, arrange) => {
			const { canvas, handle, context } = await figureWithContext();
			const resting = await restingMouth(canvas);
			const voice = arrange(context);

			expect(() => handle.speak({ voice } as { voice: AudioNode })).not.toThrow();
			await expectMouthStays(canvas, resting);
			expect(() => handle.speak(null)).not.toThrow();
			expect(handle.signal).toBe(figureSignal.drawn);
		});

		it('speaks with a still mouth and makes no analyser on a closed context', async () => {
			const { canvas, handle, context, analysers } = await figureWithContext();
			const resting = await restingMouth(canvas);
			const voice = voiceOn(context, mouthShape.aa);
			await context.close();

			expect(() => handle.speak({ voice })).not.toThrow();
			await expectMouthStays(canvas, resting);
			expect(analysers()).toHaveLength(0);
		});

		it('releases a voice whose analyser cannot be read, with a still mouth and the figure still drawn', async () => {
			const { canvas, handle, context } = await figureWithContext();
			const resting = await restingMouth(canvas);
			const realCreate = AudioContext.prototype.createAnalyser.bind(context);
			const unreadable: AnalyserNode[] = [];
			vi.spyOn(context, 'createAnalyser').mockImplementation(() => {
				const analyser = realCreate();
				analyser.getFloatTimeDomainData = () => {
					throw new Error('unreadable');
				};
				unreadable.push(analyser);
				return analyser;
			});
			const voice = voiceOn(context, mouthShape.aa);
			const disconnect = vi.spyOn(voice, 'disconnect');

			expect(() => handle.speak({ voice })).not.toThrow();
			await expectMouthStays(canvas, resting);

			expect(disconnect).toHaveBeenCalledTimes(1);
			expect(disconnect.mock.calls[0]![0]).toBe(unreadable[0]);
			expect(handle.signal).toBe(figureSignal.drawn);
		});

		it('closes the mouth on speak(null) without a throw when the host disconnected the voice from everything', async () => {
			const { canvas, handle, context } = await figureWithContext();
			const resting = await mouthNow(canvas);
			const voice = voiceOn(context, mouthShape.aa);
			handle.speak({ voice });
			await waitForMouth(canvas, (rows) => rows >= resting + openedRows);

			voice.disconnect();

			expect(() => handle.speak(null)).not.toThrow();
			await waitForMouth(canvas, (rows) => rows <= resting + swayRows);
		});

		it('throws nothing and creates no node when the context closes while speaking, then on speak(null), speak again and dispose', async () => {
			const { canvas, handle, context, analysers } = await figureWithContext();
			const resting = await mouthNow(canvas);
			const voice = voiceOn(context, mouthShape.aa);
			handle.speak({ voice });
			await waitForMouth(canvas, (rows) => rows >= resting + openedRows);

			await context.close();

			expect(() => handle.speak(null)).not.toThrow();
			expect(() => handle.speak({ voice })).not.toThrow();
			expect(() => handle.dispose()).not.toThrow();
			expect(analysers()).toHaveLength(1);
		});
	});

	describe('the order of the states', () => {
		it('shows neither the thinking look nor the turn to a speaker while the agent speaks, and both in order after speak(null)', async () => {
			await emulateReducedMotion();
			const { canvas, handle, context } = await figureWithContext();
			const resting = await noseNow(canvas);
			const voice = voiceOn(context, mouthShape.aa);
			const speaker = speakerAt(farRight, level);

			handle.speak({ voice });
			handle.think(true);
			handle.listen(speaker);
			const speaking = await noseNow(canvas);
			handle.speak(null);
			const thinking = await noseNow(canvas);
			handle.think(false);
			const listening = await noseNow(canvas);

			expect(speaking).toEqual(resting);
			expect(thinking.x).toBeLessThan(resting.x - turnedPixels);
			expect(listening.x).toBeGreaterThan(resting.x + turnedPixels);
		});
	});

	describe.each([
		['normal motion', false],
		['reduced motion', true]
	])('the mood of a sentence in %s', (_, reduced) => {
		beforeEach(async () => {
			if (reduced) await emulateReducedMotion();
		});

		type Face = Awaited<ReturnType<FigureWatch['featuresNow']>>;

		/** The least difference of `shownPictures` pictures: a mood that shows differs in every one, and a blink that covers a few of them cannot make a neutral face differ in all. */
		async function differenceFrom(canvas: HTMLCanvasElement, baseline: Face): Promise<number> {
			const differences: number[] = [];
			for (let read = 0; read < shownPictures; read++) differences.push(faceDifference(baseline, await watch.featuresNow(canvas)));
			return Math.min(...differences);
		}

		/** Waits until the face differs from `baseline` by a number that `test` accepts. */
		async function waitForFace(canvas: HTMLCanvasElement, baseline: Face, test: (difference: number) => boolean): Promise<void> {
			await vi.waitFor(async () => expect(test(await differenceFrom(canvas, baseline))).toBe(true), { timeout: 15000 });
		}

		/** Waits until the face has stopped easing: three pictures in a row differ from the one before by less than a settled face's difference. */
		async function waitForSettledFace(canvas: HTMLCanvasElement): Promise<void> {
			let previous = await watch.featuresNow(canvas);
			let steady = 0;
			await vi.waitFor(
				async () => {
					const next = await watch.featuresNow(canvas);
					steady = faceDifference(previous, next) < settledFaceDifference ? steady + 1 : 0;
					previous = next;
					expect(steady).toBeGreaterThanOrEqual(settledPictures);
				},
				{ timeout: 15000 }
			);
		}

		/** The mouth of a figure that speaks `mood` with no voice once the mood has eased in: what a voice has to open further. */
		async function moodMouth(canvas: HTMLCanvasElement, handle: FigureHandle): Promise<Picture> {
			handle.speak({ mood: figureMood.angry });
			await waitForSettledFace(canvas);
			return restingMouth(canvas);
		}

		const shown = (difference: number) => difference >= shownFaceDifference;
		const neutral = (difference: number) => difference < neutralFaceDifference;

		it.each(Object.values(figureMood))('changes the face from the neutral one while the agent speaks %s', async (mood) => {
			const { canvas, handle } = await watch.mountFigure();
			const baseline = await watch.featuresNow(canvas);

			handle.speak({ mood });

			if (reduced) expect(shown(faceDifference(baseline, await watch.featuresOfNextFrame(canvas)))).toBe(true);
			else await waitForFace(canvas, baseline, shown);
		});

		it('shows two moods differently', async () => {
			const { canvas, handle } = await watch.mountFigure();
			const baseline = await watch.featuresNow(canvas);

			handle.speak({ mood: figureMood.happy });
			await waitForFace(canvas, baseline, shown);
			const happy = await watch.featuresNow(canvas);
			handle.speak({ mood: figureMood.sad });

			await waitForFace(canvas, happy, shown);
		});

		it.each([
			['speak(null)', (handle: FigureHandle) => handle.speak(null)],
			['a sentence without a mood', (handle: FigureHandle) => handle.speak({})]
		])('returns the face to the neutral one on %s', async (_, next) => {
			const { canvas, handle } = await watch.mountFigure();
			const baseline = await watch.featuresNow(canvas);
			handle.speak({ mood: figureMood.surprised });
			await waitForFace(canvas, baseline, shown);

			next(handle);

			await waitForFace(canvas, baseline, neutral);
		});

		// The sway and the glance move a neutral face between a baseline and a later picture; held still, a face that stays neutral reads the same.
		describe.runIf(reduced)('with a value that is no mood', () => {
			it.each([
				['a name that is no mood', 'furious'],
				['a number', 7],
				['an object', { happy: true }]
			])('leaves the face neutral and throws nothing for %s', async (_, unknown) => {
				const { canvas, handle } = await watch.mountFigure();
				const baseline = await watch.featuresNow(canvas);

				expect(() => handle.speak({ mood: unknown as FigureMood })).not.toThrow();

				expect(neutral(await differenceFrom(canvas, baseline))).toBe(true);
				await new Promise((resolve) => requestFrameOwn.call(window, resolve));
				expect(neutral(await differenceFrom(canvas, baseline))).toBe(true);
			});
		});

		it('shows the mood over the thinking look and the turn to a speaker', async () => {
			const { canvas, handle } = await watch.mountFigure();
			const baseline = await watch.featuresNow(canvas);

			handle.think(true);
			handle.listen(speakerAt(farRight, level));
			handle.speak({ mood: figureMood.angry });

			await waitForFace(canvas, baseline, shown);
		});

		describe('with a voice', () => {
			it.each([
				['a figure whose mood expressions leave the mouth to its own default', undefined],
				[
					'a figure whose mood expressions block it',
					buildGlb(
						vrmParts(undefined, (json) => {
							for (const mood of Object.values(figureMood)) json.extensions.VRMC_vrm.expressions.preset[mood].overrideMouth = 'block';
						})
					)
				]
			])('opens the mouth beyond what the mood alone gives, for %s', async (_, bytes) => {
				const context = await runningContext();
				const { canvas, handle } = await watch.mountFigure(bytes);
				const moodOnly = await moodMouth(canvas, handle);

				handle.speak({ voice: voiceOn(context, mouthShape.aa), mood: figureMood.angry });

				await waitForMouth(canvas, (rows) => rows >= moodOnly.rows + openedRows);
			});
		});
	});

	it('keeps the tap of the same voice when the mood changes', async () => {
		const { handle, context, analysers } = await figureWithContext();
		const voice = voiceOn(context, mouthShape.aa);
		const disconnect = vi.spyOn(voice, 'disconnect');

		handle.speak({ voice, mood: figureMood.happy });
		handle.speak({ voice, mood: figureMood.sad });

		expect(analysers()).toHaveLength(1);
		expect(disconnect).not.toHaveBeenCalled();
	});

	describe('a figure that ended', () => {
		/** Speaks a voice, then ends the figure by `end`, and expects the tap released once and nothing tapped by a later `speak`. */
		async function expectReleasedAndDeaf(end: (canvas: HTMLCanvasElement, handle: FigureHandle) => Promise<void>): Promise<void> {
			const { canvas, handle, context, analysers } = await figureWithContext();
			const voice = voiceOn(context, mouthShape.aa);
			const disconnect = vi.spyOn(voice, 'disconnect');
			handle.speak({ voice });
			expect(analysers()).toHaveLength(1);

			await end(canvas, handle);

			expect(disconnect).toHaveBeenCalledTimes(1);
			expect(disconnect.mock.calls[0]![0]).toBe(analysers()[0]);
			expect(() => handle.speak({ voice })).not.toThrow();
			expect(() => handle.speak({ voice: voiceOn(context, mouthShape.ih) })).not.toThrow();
			expect(analysers()).toHaveLength(1);
		}

		it('releases the tap on dispose, and speak afterwards does nothing', async () => {
			await expectReleasedAndDeaf(async (_, handle) => handle.dispose());
		});

		it('releases the tap when the context is lost, and speak afterwards does nothing', async () => {
			await expectReleasedAndDeaf(async (canvas, handle) => {
				canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext();
				await vi.waitFor(() => expect(handle.signal).toBe(figureSignal.lost));
			});
		});

		it('releases the tap when the figure is too slow to keep, and speak afterwards does nothing', async () => {
			watch.end();
			watch = startFigureWatch(true);
			await expectReleasedAndDeaf(async (_, handle) => {
				await vi.waitFor(() => expect(handle.signal).toBe(figureSignal.slow), { timeout: 15000 });
			});
		});

		it('taps nothing on a refused figure', async () => {
			const context = await runningContext();
			const analysers = analysersOf(context);
			const { handle } = await watch.mountFigure(new Uint8Array([1, 2, 3]));

			expect(() => handle.speak({ voice: voiceOn(context, mouthShape.aa) })).not.toThrow();
			expect(() => handle.speak(null)).not.toThrow();

			expect(handle.signal).toBe(figureSignal.refused);
			expect(analysers()).toHaveLength(0);
		});
	});
});
