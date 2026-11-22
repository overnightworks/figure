import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { centreOf, emulateReducedMotion, mouthRows } from '../tests/browserCanvas.js';
import { startFigureWatch, type FigureWatch } from '../tests/figureWatch.js';
import { syntheticSequence, type SyntheticSequence } from '../tests/syntheticVoice.js';
import { mouthShape, type MouthShape } from './expressions.js';
import type { FigureHandle } from './draw.js';
import type { SpokenSound } from './mountOptions.js';

/** The rows by which an open vowel's mouth has to exceed the closed one, and by which the flat vowel's has to fall short of it, at a canvas 200 wide; the sway of the head moves a closed mouth by a row. */
const openedRows = 4;
const flattenedRows = 3;
const swayRows = 1;
/** The rows a closed mouth's window gains or loses for each pixel that the nose rises or sinks from another pose. */
const rowsPerShiftedPixel = 1.25;
/** The pictures in which a mouth that should not move is judged, every one of them. */
const stillPictures = 15;
const swayPixels = 2;

/** The mouth's rows and the nose's centre in one picture. */
interface Picture {
	readonly rows: number;
	readonly nose: { readonly x: number; readonly y: number };
}

/** One sound's length in seconds: long enough that a sound lasts through everything a test reads while it plays. */
const soundSeconds = 100;
const answer = ['a', 'm', 'iː', 'ʘ', 'b', 'p'] as const;
type Named = (typeof answer)[number];
const sounds: readonly SpokenSound[] = answer.map((ipa, index) => ({ ipa, start: index * soundSeconds, end: (index + 1) * soundSeconds }));
const inside = (sound: Named) => answer.indexOf(sound) * soundSeconds + soundSeconds / 2;
const afterTheLast = answer.length * soundSeconds + 10;

describe('a figure whose agent speaks with sounds', () => {
	let watch: FigureWatch;
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

	/** The mouth's rows and the nose's centre in the figure's next picture. */
	async function pictureNow(canvas: HTMLCanvasElement): Promise<Picture> {
		const features = await watch.featuresNow(canvas);
		return { rows: mouthRows(features), nose: centreOf(features.nose) };
	}

	const mouthNow = async (canvas: HTMLCanvasElement) => (await pictureNow(canvas)).rows;

	/** Waits until the mouth covers a number of rows for which `test` holds. */
	async function waitForMouth(canvas: HTMLCanvasElement, test: (rows: number) => boolean): Promise<void> {
		await vi.waitFor(async () => expect(test(await mouthNow(canvas))).toBe(true), { timeout: 15000 });
	}

	/** The nose of the picture `restingRows` last returned: what a mouth that should hold is judged against. */
	let restingNose: Picture['nose'];

	/** The rows of the mouth that shows the most in the next pictures of a figure at rest: the median of the pictures at the head's commonest pose. */
	async function restingRows(canvas: HTMLCanvasElement): Promise<number> {
		const pictures: Picture[] = [];
		for (let picture = 0; picture < stillPictures; picture++) pictures.push(await pictureNow(canvas));
		const atPose = (pose: Picture) => pictures.filter((other) => Math.abs(other.nose.x - pose.nose.x) <= swayPixels && Math.abs(other.nose.y - pose.nose.y) <= swayPixels);
		const commonest = pictures.reduce((best, picture) => (atPose(picture).length > atPose(best).length ? picture : best));
		const byRows = atPose(commonest).sort((first, second) => first.rows - second.rows);
		const median = byRows[Math.floor(byRows.length / 2)]!;
		restingNose = median.nose;
		return median.rows;
	}

	/** Expects the mouth, in each of the next `stillPictures` pictures, to hold what `holds` says of its rows given the rows the nose's rise or sink from the resting pose adds to a mouth. */
	async function expectMouthHolds(canvas: HTMLCanvasElement, holds: (rows: number, shiftRows: number) => boolean): Promise<void> {
		for (let read = 0; read < stillPictures; read++) {
			const picture = await pictureNow(canvas);
			expect(holds(picture.rows, rowsPerShiftedPixel * Math.abs(picture.nose.y - restingNose.y))).toBe(true);
		}
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
			const resting = await restingRows(canvas);
			handle.speak({ voice: sequence.output, sounds: sequence.sounds });

			for (const sound of ['a', 'm', 'a', 'b', 'a', 'p'] as const) {
				sequence.seek(inside(sound));
				if (sound === 'a') await waitForMouth(canvas, (rows) => rows >= resting + openedRows);
				else await waitForMouth(canvas, (rows) => rows <= resting + swayRows);
			}
		});

		it('shows the flat shape of iː from a silent voice, which the analyser cannot', async () => {
			const { canvas, handle, sequence } = await figureWithSequence(mouthShape.aa, 0);
			const resting = await restingRows(canvas);
			handle.speak({ voice: sequence.output, sounds: sequence.sounds });

			sequence.seek(inside('a'));
			await waitForMouth(canvas, (rows) => rows >= resting + openedRows);
			sequence.seek(inside('iː'));
			await waitForMouth(canvas, (rows) => rows <= resting - flattenedRows);
		});

		it('keeps the mouth open through a sound, with frames faster than the position changes', async () => {
			const { canvas, handle, sequence } = await figureWithSequence(mouthShape.aa, 0);
			const resting = await restingRows(canvas);
			handle.speak({ voice: sequence.output, sounds: sequence.sounds });

			await waitForMouth(canvas, (rows) => rows >= resting + openedRows);
			await expectMouthHolds(canvas, (rows, shift) => rows >= resting + openedRows - shift - swayRows);
		});

		it('goes on with the analyser for an unknown sound and for the time past the last sound', async () => {
			const { canvas, handle, sequence } = await figureWithSequence(mouthShape.aa);
			const resting = await restingRows(canvas);
			handle.speak({ voice: sequence.output, sounds: sequence.sounds });
			sequence.seek(inside('m'));
			await waitForMouth(canvas, (rows) => rows <= resting + swayRows);

			sequence.seek(inside('ʘ'));
			await waitForMouth(canvas, (rows) => rows >= resting + openedRows);
			sequence.seek(inside('m'));
			await waitForMouth(canvas, (rows) => rows <= resting + swayRows);
			sequence.seek(afterTheLast);
			await waitForMouth(canvas, (rows) => rows >= resting + openedRows);
		});

		it('rests the mouth while the position stands still, follows on when it moves, and leaves the time past the last sound to the analyser', async () => {
			const { canvas, handle, sequence } = await figureWithSequence(mouthShape.aa);
			const resting = await restingRows(canvas);
			handle.speak({ voice: sequence.output, sounds: sequence.sounds });
			sequence.seek(inside('a'));
			await waitForMouth(canvas, (rows) => rows >= resting + openedRows);

			sequence.hold();
			await waitForMouth(canvas, (rows) => rows <= resting + swayRows);
			sequence.release();
			await waitForMouth(canvas, (rows) => rows >= resting + openedRows);

			sequence.seek(afterTheLast);
			sequence.hold();
			await expectMouthHolds(canvas, (rows, shift) => rows >= resting + openedRows - shift - swayRows);
		});

		it('rests a mouth while a context that ran is suspended, and goes on at the clock\'s place once it runs', async () => {
			const { canvas, handle, context, sequence } = await figureWithSequence(mouthShape.aa, 0);
			const resting = await restingRows(canvas);
			await context.suspend();

			handle.speak({ voice: sequence.output, sounds: sequence.sounds });
			await expectMouthHolds(canvas, (rows, shift) => rows <= resting + flattenedRows + shift);
			await context.resume();

			await waitForMouth(canvas, (rows) => rows >= resting + openedRows);
		});
	});

	it.each([
		['a position read that throws', () => { throw new Error('the player is gone'); }],
		['a position that is not a number', () => Number.NaN],
		['an infinite position', () => Infinity]
	] as const)('goes on with the analyser for %s, and with the sounds on the next good read', async (_, bad) => {
		const { canvas, handle, sequence } = await figureWithSequence(mouthShape.aa);
		const resting = await restingRows(canvas);
		let broken = true;
		sequence.seek(inside('m'));
		handle.speak({ voice: sequence.output, sounds: { sounds, played: () => (broken ? bad() : sequence.sounds.played()) } });

		await waitForMouth(canvas, (rows) => rows >= resting + openedRows);
		broken = false;
		await waitForMouth(canvas, (rows) => rows <= resting + swayRows);
	});

	it('goes on with the analyser for a `played` that is no function and for a list that is not well formed', async () => {
		const { canvas, handle, sequence } = await figureWithSequence(mouthShape.aa);
		const resting = await restingRows(canvas);
		sequence.seek(inside('m'));

		for (const value of [{ sounds, played: 5 }, { sounds: [{ ipa: 'm', start: 1, end: 0 }], played: sequence.sounds.played }, { sounds: 'm', played: sequence.sounds.played }]) {
			handle.speak({ voice: sequence.output, sounds: value as never });
			await waitForMouth(canvas, (rows) => rows >= resting + openedRows);
		}
	});

	it('keeps the mouth still for sounds without a voice', async () => {
		const { canvas, handle, sequence } = await figureWithSequence(mouthShape.aa);
		const resting = await restingRows(canvas);
		sequence.seek(inside('a'));

		handle.speak({ sounds: sequence.sounds });

		await expectMouthHolds(canvas, (rows, shift) => rows <= resting + flattenedRows + shift);
	});

	it('goes on from the mouth it has when the next call brings a longer list for the same clock', async () => {
		const { canvas, handle, sequence } = await figureWithSequence(mouthShape.aa, 0);
		const resting = await restingRows(canvas);
		handle.speak({ voice: sequence.output, sounds: { played: sequence.sounds.played, sounds: sounds.slice(0, 1) } });
		await waitForMouth(canvas, (rows) => rows >= resting + openedRows);

		handle.speak({ voice: sequence.output, sounds: sequence.sounds });

		await expectMouthHolds(canvas, (rows, shift) => rows >= resting + openedRows - shift - swayRows);
	});

	it('closes the mouth on speak(null), and ignores sounds after dispose', async () => {
		const { canvas, handle, sequence } = await figureWithSequence(mouthShape.aa, 0);
		const resting = await restingRows(canvas);
		handle.speak({ voice: sequence.output, sounds: sequence.sounds });
		await waitForMouth(canvas, (rows) => rows >= resting + openedRows);

		handle.speak(null);
		await waitForMouth(canvas, (rows) => rows <= resting + swayRows);

		handle.dispose();
		expect(() => handle.speak({ voice: sequence.output, sounds: sequence.sounds })).not.toThrow();
	});
});
