import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cdp } from 'vitest/browser';
import { emulateReducedMotion, readPixels, restorePageVisibility, setPageVisibility, spotsOf, type FaceFeature, type Spot } from '../tests/browserCanvas.js';
import { buildConformantVrm } from '../tests/figureFixtures.js';
import { startFigureWatch, type FigureWatch, type WatchedFigure } from '../tests/figureWatch.js';
import { mount, type MountOptions } from './draw.js';
import { figureFraming, type FigureFraming } from './framings.js';

/** How many pixels the span between the outer edges of the eyes, at a canvas 200 wide, may differ between two pictures of one framing: the idle glance turns the head a little. */
const sameFramingPixels = 4;
/** The pictures watched after a change, enough seconds for it to arrive. */
const arrivalTimeoutMilliseconds = 8000;
/** How far the eye span may move between two pictures for a framing to count as arrived. */
const settledPixels = 1;
const framingsWidestLast = [figureFraming.face, figureFraming.shoulders, figureFraming.upperBody, figureFraming.fullBody];

/** The span between the outer edges of the eyes in a picture: the narrower the framing, the wider the span. */
function eyeSpan(features: Record<FaceFeature, Spot[]>): number {
	const columns = features.eye.map((spot) => spot.x);
	return Math.max(...columns) - Math.min(...columns);
}

describe('a figure seen from its face to its whole body', () => {
	let watch: FigureWatch;

	beforeEach(() => {
		watch = startFigureWatch();
	});

	afterEach(async () => {
		watch.end();
		restorePageVisibility();
		await cdp().send('Emulation.setEmulatedMedia', { features: [] });
	});

	/** The eye span of the picture a figure mounted in `framing` shows once it has stopped changing. */
	async function spanMountedIn(framing?: unknown): Promise<number> {
		const { canvas } = await watch.mountFigure(undefined, { framing: framing as FigureFraming });
		let previous = Number.POSITIVE_INFINITY;
		let span = previous;
		await vi.waitFor(async () => {
			previous = span;
			span = eyeSpan(await watch.featuresNow(canvas));
			expect(Math.abs(span - previous)).toBeLessThanOrEqual(settledPixels);
		}, { timeout: arrivalTimeoutMilliseconds });
		return span;
	}

	/** Expects `span` to be that of the framing `framing`, as a figure mounted in it shows. */
	async function expectFramed(span: number, framing: FigureFraming): Promise<void> {
		expect(Math.abs(span - (await spanMountedIn(framing)))).toBeLessThanOrEqual(sameFramingPixels);
	}

	/** Mounts a figure and waits for its loop to draw, so a call made next reaches a figure that is drawing. */
	async function mountDrawing(options?: MountOptions): Promise<WatchedFigure> {
		const figure = await watch.mountFigure(undefined, options);
		await watch.featuresNow(figure.canvas);
		return figure;
	}

	it('shows less of the figure and more of its face the narrower the framing the option names', async () => {
		const spans: number[] = [];
		for (const framing of framingsWidestLast) spans.push(await spanMountedIn(framing));
		expect(spans).toEqual([...spans].sort((first, second) => second - first));
		expect(new Set(spans.map((span) => Math.round(span / (2 * sameFramingPixels)))).size).toBe(spans.length);
	});

	it('draws the first frame in the framing the option names, with no ease', async () => {
		const canvas = document.createElement('canvas');
		canvas.style.width = '200px';
		canvas.style.height = '250px';
		document.body.append(canvas);
		const handle = await mount(canvas, buildConformantVrm(), { framing: figureFraming.fullBody });
		// The buffer still holds the first frame in the task that drew it.
		const first = eyeSpan(spotsOf(readPixels(canvas), canvas.width, canvas.height));
		handle.dispose();
		canvas.remove();
		await expectFramed(first, figureFraming.fullBody);
	});

	it.each([['no option', undefined], ['a name that is no framing', 'closeUp'], ['an inherited name', 'constructor'], ['a number', 3]])(
		'is the shoulders framing for %s',
		async (_, framing) => {
			await expectFramed(await spanMountedIn(framing), figureFraming.shoulders);
		}
	);

	it('is the shoulders framing when the options cannot be read', async () => {
		const options = {
			get framing(): FigureFraming {
				throw new Error('the option cannot be read');
			}
		};
		const { canvas } = await watch.mountFigure(undefined, options);
		await expectFramed(eyeSpan(await watch.featuresNow(canvas)), figureFraming.shoulders);
	});

	it('eases to the framing a call names, through pictures between the two, and arrives', async () => {
		const wide = await spanMountedIn(figureFraming.fullBody);
		const { canvas, handle } = await mountDrawing();
		const near = eyeSpan(await watch.featuresNow(canvas));
		handle.frame(figureFraming.fullBody);
		const spans: number[] = [];
		await vi.waitFor(
			async () => {
				spans.push(eyeSpan(await watch.featuresOfNextFrame(canvas)));
				expect(spans.at(-1)).toBeLessThanOrEqual(wide + sameFramingPixels);
			},
			{ timeout: arrivalTimeoutMilliseconds, interval: 0 }
		);
		expect(spans.some((span) => span < near - sameFramingPixels && span > wide + sameFramingPixels)).toBe(true);
		expect(Math.max(...spans.slice(1))).toBeLessThanOrEqual(spans[0]! + sameFramingPixels);
	});

	it('turns back toward the framing of a call made during a change, from the picture it is in', async () => {
		const wide = await spanMountedIn(figureFraming.fullBody);
		const { canvas, handle } = await mountDrawing();
		const near = eyeSpan(await watch.featuresNow(canvas));
		const halfway = (near + wide) / 2;
		handle.frame(figureFraming.fullBody);
		// Frame by frame, so the picture it is in does not depend on how long the frames last.
		let underway = near;
		await vi.waitFor(
			async () => {
				underway = eyeSpan(await watch.featuresOfNextFrame(canvas));
				expect(underway).toBeLessThan(halfway);
			},
			{ timeout: arrivalTimeoutMilliseconds, interval: 0 }
		);
		handle.frame(figureFraming.face);
		let turned = underway;
		await vi.waitFor(
			async () => {
				turned = eyeSpan(await watch.featuresOfNextFrame(canvas));
				expect(turned).toBeGreaterThan(underway + sameFramingPixels);
			},
			{ timeout: arrivalTimeoutMilliseconds, interval: 0 }
		);
		expect(turned).toBeLessThan(near);
		await vi.waitFor(async () => expect(eyeSpan(await watch.featuresNow(canvas))).toBeGreaterThan(near + sameFramingPixels), { timeout: arrivalTimeoutMilliseconds });
	});

	it('cuts to the framing a call names under reduced motion', async () => {
		await emulateReducedMotion();
		const { canvas, handle } = await mountDrawing();
		handle.frame(figureFraming.fullBody);
		await expectFramed(eyeSpan(await watch.featuresNow(canvas)), figureFraming.fullBody);
	});

	it.each([['a name that is no framing', 'closeUp'], ['an inherited name', 'constructor'], ['nothing', undefined]])(
		'keeps its framing for a call with %s and throws nothing',
		async (_, name) => {
			const { canvas, handle } = await mountDrawing({ framing: figureFraming.upperBody });
			expect(() => handle.frame(name as FigureFraming)).not.toThrow();
			await expectFramed(eyeSpan(await watch.featuresNow(canvas)), figureFraming.upperBody);
		}
	);

	it('keeps a call made while the page is hidden and shows it, with no ease, in the first frame after the page is shown', async () => {
		const { canvas, handle } = await mountDrawing();
		setPageVisibility('hidden');
		handle.frame(figureFraming.fullBody);
		setPageVisibility('visible');
		await expectFramed(eyeSpan(await watch.featuresNow(canvas)), figureFraming.fullBody);
	});

	it('throws nothing on a call after the figure is disposed', async () => {
		const { handle } = await watch.mountFigure();
		handle.dispose();
		expect(() => handle.frame(figureFraming.fullBody)).not.toThrow();
	});
});
