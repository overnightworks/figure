import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { emulateReducedMotion } from '../tests/browserCanvas.js';
import { startFigureWatch, type FigureWatch } from '../tests/figureWatch.js';
import { flattenedRows, mouthReader, openedRows, rowsPerShiftedPixel, stillPictures, swayRows, type MouthPicture } from '../tests/mouthReader.js';
import { syntheticSequence, type SyntheticSequence } from '../tests/syntheticVoice.js';
import { mouthShape, type MouthShape } from './expressions.js';
import type { FigureHandle } from './draw.js';
import type { SpokenSound } from './mountOptions.js';

/** One sound's length in seconds: long enough that a sound lasts through everything a test reads while it plays. */
const soundSeconds = 100;
const answer = ['a', 'm', 'iː', 'ʘ', 'b', 'p'] as const;
type Named = (typeof answer)[number];
const sounds: readonly SpokenSound[] = answer.map((ipa, index) => ({ ipa, start: index * soundSeconds, end: (index + 1) * soundSeconds }));
const inside = (sound: Named) => answer.indexOf(sound) * soundSeconds + soundSeconds / 2;
const afterTheLast = answer.length * soundSeconds + 10;

describe('a figure whose agent speaks with sounds', () => {
	let watch: FigureWatch;
	const { pictureNow, pictureOfNextFrame, waitForMouth, restingMouth } = mouthReader(() => watch);
	const contexts: AudioContext[] = [];
	const voices: SyntheticSequence[] = [];

	beforeEach(async () => {
		watch = startFigureWatch();
		const button = document.createElement('button');
		document.body.append(button);
		await userEvent.click(button);
		button.remove();
	});

	afterEach(async () => {
		watch.end();
		voices.splice(0).forEach((voice) => voice.stop());
		await Promise.all(contexts.splice(0).map((context) => (context.state === 'closed' ? undefined : context.close())));
		await cdp().send('Emulation.setEmulatedMedia', { features: [] });
	});

	/** A figure and a running context with a sequence on it, whose voice holds `vowel` at `gain`: a loud one the analyser opens the mouth for, or a silent one it cannot. */
	async function figureWithSequence(vowel: MouthShape, gain?: number): Promise<{ canvas: HTMLCanvasElement; handle: FigureHandle; context: AudioContext; sequence: SyntheticSequence }> {
		const context = new AudioContext();
		contexts.push(context);
		await context.resume();
		const sequence = syntheticSequence(context, vowel, sounds, gain);
		voices.push(sequence);
		return { ...(await watch.mountFigure()), context, sequence };
	}

	/** Expects the mouth in `picture` to hold what `holds` says of its rows given the rows the nose's rise or sink from `resting`'s pose adds to a mouth. */
	function expectPictureHolds(picture: MouthPicture, resting: MouthPicture, holds: (rows: number, shiftRows: number) => boolean): void {
		expect(holds(picture.rows, rowsPerShiftedPixel * Math.abs(picture.nose.y - resting.nose.y))).toBe(true);
	}

	/** Expects the mouth, in each of the next `stillPictures` pictures, to hold what `holds` says of its rows. */
	async function expectMouthHolds(canvas: HTMLCanvasElement, resting: MouthPicture, holds: (rows: number, shiftRows: number) => boolean): Promise<void> {
		for (let read = 0; read < stillPictures; read++) expectPictureHolds(await pictureNow(canvas), resting, holds);
	}

	describe.each([
		['normal motion', false],
		['reduced motion', true]
	])('in %s', (_, reduced) => {
		beforeEach(async () => {
			if (reduced) await emulateReducedMotion();
		});

		it('closes the lips on m, b and p and opens the mouth for a, whatever vowel the loud voice holds', async () => {
			const { canvas, handle, sequence } = await figureWithSequence(mouthShape.aa);
			const resting = await restingMouth(canvas);
			handle.speak({ voice: sequence.output, sounds: sequence.sounds });

			for (const sound of ['a', 'm', 'a', 'b', 'a', 'p'] as const) {
				sequence.seek(inside(sound));
				if (sound === 'a') await waitForMouth(canvas, (rows) => rows >= resting.rows + openedRows);
				else await waitForMouth(canvas, (rows) => rows <= resting.rows + swayRows);
			}
		});

		it('shows the flat shape of iː from a silent voice, which the analyser cannot', async () => {
			const { canvas, handle, sequence } = await figureWithSequence(mouthShape.aa, 0);
			const resting = await restingMouth(canvas);
			handle.speak({ voice: sequence.output, sounds: sequence.sounds });

			sequence.seek(inside('a'));
			await waitForMouth(canvas, (rows) => rows >= resting.rows + openedRows);
			sequence.seek(inside('iː'));
			await waitForMouth(canvas, (rows) => rows <= resting.rows - flattenedRows);
		});

		it('keeps the mouth open through a sound, with frames faster than the position changes', async () => {
			const { canvas, handle, sequence } = await figureWithSequence(mouthShape.aa, 0);
			const resting = await restingMouth(canvas);
			handle.speak({ voice: sequence.output, sounds: sequence.sounds });

			await waitForMouth(canvas, (rows) => rows >= resting.rows + openedRows);
			await expectMouthHolds(canvas, resting, (rows, shift) => rows >= resting.rows + openedRows - shift - swayRows);
		});

		it('goes on with the analyser for an unknown sound and for the time past the last sound', async () => {
			const { canvas, handle, sequence } = await figureWithSequence(mouthShape.aa);
			const resting = await restingMouth(canvas);
			handle.speak({ voice: sequence.output, sounds: sequence.sounds });
			sequence.seek(inside('m'));
			await waitForMouth(canvas, (rows) => rows <= resting.rows + swayRows);

			sequence.seek(inside('ʘ'));
			await waitForMouth(canvas, (rows) => rows >= resting.rows + openedRows);
			sequence.seek(inside('m'));
			await waitForMouth(canvas, (rows) => rows <= resting.rows + swayRows);
			sequence.seek(afterTheLast);
			await waitForMouth(canvas, (rows) => rows >= resting.rows + openedRows);
		});

		it('rests the mouth while the position stands still, follows on when it moves, and leaves the time past the last sound to the analyser', async () => {
			const { canvas, handle, sequence } = await figureWithSequence(mouthShape.aa);
			const resting = await restingMouth(canvas);
			handle.speak({ voice: sequence.output, sounds: sequence.sounds });
			sequence.seek(inside('a'));
			await waitForMouth(canvas, (rows) => rows >= resting.rows + openedRows);

			sequence.hold();
			await waitForMouth(canvas, (rows) => rows <= resting.rows + swayRows);
			sequence.release();
			await waitForMouth(canvas, (rows) => rows >= resting.rows + openedRows);

			sequence.seek(afterTheLast);
			sequence.hold();
			await expectMouthHolds(canvas, resting, (rows, shift) => rows >= resting.rows + openedRows - shift - swayRows);
		});

		it('rests a mouth while a context that ran is suspended, and goes on at the clock\'s place once it runs', async () => {
			const { canvas, handle, context, sequence } = await figureWithSequence(mouthShape.aa, 0);
			const resting = await restingMouth(canvas);
			await context.suspend();

			handle.speak({ voice: sequence.output, sounds: sequence.sounds });
			await expectMouthHolds(canvas, resting, (rows, shift) => rows <= resting.rows + flattenedRows + shift);
			await context.resume();

			await waitForMouth(canvas, (rows) => rows >= resting.rows + openedRows);
		});
	});

	it.each([
		['a position read that throws', () => { throw new Error('the player is gone'); }],
		['a position that is not a number', () => Number.NaN],
		['an infinite position', () => Infinity]
	] as const)('goes on with the analyser for %s, and with the sounds on the next good read', async (_, bad) => {
		const { canvas, handle, sequence } = await figureWithSequence(mouthShape.aa);
		const resting = await restingMouth(canvas);
		let broken = true;
		sequence.seek(inside('m'));
		handle.speak({ voice: sequence.output, sounds: { sounds, played: () => (broken ? bad() : sequence.sounds.played()) } });

		await waitForMouth(canvas, (rows) => rows >= resting.rows + openedRows);
		broken = false;
		await waitForMouth(canvas, (rows) => rows <= resting.rows + swayRows);
	});

	/** Sentences a host should not send, each of which would close the lips at `inside('m')`, where the loud voice's analyser opens the mouth, if its sounds were kept or read. */
	it.each([
		['a `played` that is no function', (voice: AudioNode) => ({ voice, sounds: { sounds, played: 5 } })],
		['a list that is not a list', (voice: AudioNode, played: () => number) => ({ voice, sounds: { sounds: 'm', played } })],
		['a sound that ends before it starts', (voice: AudioNode, played: () => number) => ({ voice, sounds: { sounds: [{ ipa: 'm', start: 100, end: 200 }, { ipa: 'a', start: 160, end: 140 }], played } })],
		['a list that is not sorted by start', (voice: AudioNode, played: () => number) => ({ voice, sounds: { sounds: [{ ipa: 'a', start: 160, end: 200 }, { ipa: 'm', start: 100, end: 200 }], played } })],
		[
			'sounds that cannot be read',
			(voice: AudioNode) => ({
				voice,
				get sounds(): never {
					throw new Error('a getter that throws');
				}
			})
		]
	])('goes on with the analyser for %s', async (_, sentenceOf) => {
		const { canvas, handle, sequence } = await figureWithSequence(mouthShape.aa);
		const resting = await restingMouth(canvas);
		sequence.seek(inside('m'));

		expect(() => handle.speak(sentenceOf(sequence.output, sequence.sounds.played) as never)).not.toThrow();

		await waitForMouth(canvas, (rows) => rows >= resting.rows + openedRows);
	});

	it('keeps the mouth still for sounds without a voice', async () => {
		const { canvas, handle, sequence } = await figureWithSequence(mouthShape.aa);
		const resting = await restingMouth(canvas);
		sequence.seek(inside('a'));

		handle.speak({ sounds: sequence.sounds });

		await expectMouthHolds(canvas, resting, (rows, shift) => rows <= resting.rows + flattenedRows + shift);
	});

	/** The mouth is open before the call: the silent voice opens it through the sounds it has, the loud one through its analyser. */
	it.each([
		['a longer list for the same clock', 0, sounds.slice(0, 1)],
		['sounds for a sentence that had none', undefined, undefined]
	])('goes on from the open mouth it has when the next call brings %s', async (_, gain, before) => {
		const { canvas, handle, sequence } = await figureWithSequence(mouthShape.aa, gain);
		const resting = await restingMouth(canvas);
		handle.speak({ voice: sequence.output, ...(before === undefined ? {} : { sounds: { played: sequence.sounds.played, sounds: before } }) });
		await waitForMouth(canvas, (rows) => rows >= resting.rows + openedRows);

		handle.speak({ voice: sequence.output, sounds: sequence.sounds });

		// The first frame after the call shows the mouth as open as it was, which a mouth that went to rest and began to rise again falls short of.
		expectPictureHolds(await pictureOfNextFrame(canvas), resting, (rows, shift) => rows >= resting.rows + openedRows + swayRows - shift);
		await expectMouthHolds(canvas, resting, (rows, shift) => rows >= resting.rows + openedRows - shift - swayRows);
	});

	it('closes the mouth on speak(null), and ignores sounds after dispose', async () => {
		const { canvas, handle, sequence } = await figureWithSequence(mouthShape.aa, 0);
		const resting = await restingMouth(canvas);
		handle.speak({ voice: sequence.output, sounds: sequence.sounds });
		await waitForMouth(canvas, (rows) => rows >= resting.rows + openedRows);

		handle.speak(null);
		await waitForMouth(canvas, (rows) => rows <= resting.rows + swayRows);

		handle.dispose();
		expect(() => handle.speak({ voice: sequence.output, sounds: sequence.sounds })).not.toThrow();
	});
});
