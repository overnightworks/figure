import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { centreOf, emulateReducedMotion, mouthRows } from '../tests/browserCanvas.js';
import { startFigureWatch, type FigureWatch } from '../tests/figureWatch.js';
import { syntheticVoice, type SyntheticVoice } from '../tests/syntheticVoice.js';
import { mouthShape, type MouthShape } from './expressions.js';
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
/** The pictures after which a mouth that should not move has had every chance to. */
const stillPictures = 15;
const farRight = 5000;
const level = 100;

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
		Reflect.deleteProperty(document, 'visibilityState');
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

	/** Reads `stillPictures` pictures and expects the mouth to cover `rows` in each, give or take the sway of the head. */
	async function expectMouthStays(canvas: HTMLCanvasElement, rows: number): Promise<void> {
		for (let picture = 0; picture < stillPictures; picture++) expect(Math.abs((await mouthNow(canvas)) - rows)).toBeLessThanOrEqual(swayRows);
	}

	/** Puts a small element of the page at `x` and `y` CSS pixels from the viewport's top left. */
	function speakerAt(x: number, y: number): HTMLElement {
		const speaker = document.createElement('div');
		speaker.style.cssText = `position: fixed; left: ${x}px; top: ${y}px; width: 20px; height: 20px`;
		document.body.append(speaker);
		speakers.push(speaker);
		return speaker;
	}

	/** Sets the document's visibility state and fires its `visibilitychange` event, as a tab switch does. */
	function setPageVisibility(state: 'hidden' | 'visible'): void {
		Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
		document.dispatchEvent(new Event('visibilitychange'));
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
			const resting = await mouthNow(canvas);

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
			expect(reads.mock.calls.length).toBe(hiddenAt);

			setPageVisibility('visible');
			await vi.waitFor(() => expect(reads.mock.calls.length).toBeGreaterThan(hiddenAt));
			await waitForMouth(canvas, (rows) => rows >= resting + openedRows);
		});

		it('does not read a suspended context, and follows the voice once the context runs', async () => {
			const { canvas, handle, context } = await figureWithContext();
			const resting = await mouthNow(canvas);
			await context.suspend();

			handle.speak({ voice: voiceOn(context, mouthShape.aa) });
			await expectMouthStays(canvas, resting);
			await context.resume();

			await waitForMouth(canvas, (rows) => rows >= resting + openedRows);
		});

		it('closes the mouth while a context that was running is suspended, and opens it again once the context runs', async () => {
			const { canvas, handle, context } = await figureWithContext();
			const resting = await mouthNow(canvas);
			handle.speak({ voice: voiceOn(context, mouthShape.aa) });
			await waitForMouth(canvas, (rows) => rows >= resting + openedRows);

			await context.suspend();
			await waitForMouth(canvas, (rows) => rows <= resting + swayRows);
			await expectMouthStays(canvas, resting);
			await context.resume();

			await waitForMouth(canvas, (rows) => rows >= resting + openedRows);
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
			const resting = await mouthNow(canvas);
			const voice = arrange(context);

			expect(() => handle.speak({ voice } as { voice: AudioNode })).not.toThrow();
			await expectMouthStays(canvas, resting);
			expect(() => handle.speak(null)).not.toThrow();
			expect(handle.signal).toBe(figureSignal.drawn);
		});

		it('speaks with a still mouth and makes no analyser on a closed context', async () => {
			const { canvas, handle, context, analysers } = await figureWithContext();
			const resting = await mouthNow(canvas);
			const voice = voiceOn(context, mouthShape.aa);
			await context.close();

			expect(() => handle.speak({ voice })).not.toThrow();
			await expectMouthStays(canvas, resting);
			expect(analysers()).toHaveLength(0);
		});

		it('releases a voice whose analyser cannot be read, with a still mouth and the figure still drawn', async () => {
			const { canvas, handle, context } = await figureWithContext();
			const resting = await mouthNow(canvas);
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
