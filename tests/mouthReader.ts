// What the browser tests share to read a figure's mouth: its rows and the nose's centre in the next picture, the wait for a mouth, and the mouth a figure rests in.
import { expect, vi } from 'vitest';
import { centreOf, mouthRows } from './browserCanvas.js';
import type { FigureWatch } from './figureWatch.js';

/** How far the sway moves the nose, in pixels at a canvas 200 wide; the idle glance turns it by far more, and the glance moves a closed mouth's rows by more than the sway does. */
const swayPixels = 2;
/** The pictures in which a mouth that should not move is judged, every one of them, and over which the head's resting pose is read. */
export const stillPictures = 15;

/** The mouth's rows and the nose's centre in one picture. */
export interface MouthPicture {
	readonly rows: number;
	readonly nose: { readonly x: number; readonly y: number };
}

/** Whether `picture` shows the nose where the sway leaves it around `pose`'s. */
function atRest(picture: MouthPicture, pose: MouthPicture): boolean {
	return Math.abs(picture.nose.x - pose.nose.x) <= swayPixels && Math.abs(picture.nose.y - pose.nose.y) <= swayPixels;
}

/** The readings of a test's watch, which `watch` hands over when they are read, as a test starts its watch only in `beforeEach`. */
export function mouthReader(watch: () => FigureWatch) {
	/** The rows the mouth covers in the figure's next picture. */
	async function mouthNow(canvas: HTMLCanvasElement): Promise<number> {
		return mouthRows(await watch().featuresNow(canvas));
	}

	/** The mouth and the nose in the figure's next picture. */
	async function pictureNow(canvas: HTMLCanvasElement): Promise<MouthPicture> {
		const features = await watch().featuresNow(canvas);
		return { rows: mouthRows(features), nose: centreOf(features.nose) };
	}

	/** Waits until the rows the mouth covers are rows for which `test` holds. */
	async function waitForMouth(canvas: HTMLCanvasElement, test: (rows: number) => boolean): Promise<void> {
		await vi.waitFor(async () => expect(test(await mouthNow(canvas))).toBe(true), { timeout: 15000 });
	}

	/**
	 * The picture with the median mouth among those at the head's most common pose in the next `stillPictures` pictures, which the idle glance cannot
	 * outvote; its rows and its nose come from one picture, as the sway's reach around that pose spans more than a pixel of the nose's height.
	 */
	async function restingMouth(canvas: HTMLCanvasElement): Promise<MouthPicture> {
		const pictures: MouthPicture[] = [];
		for (let picture = 0; picture < stillPictures; picture++) pictures.push(await pictureNow(canvas));
		const atPose = (pose: MouthPicture) => pictures.filter((picture) => atRest(picture, pose));
		const commonest = pictures.reduce((best, picture) => (atPose(picture).length > atPose(best).length ? picture : best));
		const byRows = atPose(commonest).sort((first, second) => first.rows - second.rows);
		return byRows[Math.floor(byRows.length / 2)]!;
	}

	return { mouthNow, pictureNow, waitForMouth, restingMouth };
}
