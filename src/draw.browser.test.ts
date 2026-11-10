import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cdp } from 'vitest/browser';
import { buildConformantVrm, buildVrmGlbWithImages } from '../tests/figureFixtures.js';
import { buildFigureTexturePng, buildPng } from '../tests/glbBuilder.js';
import { mount, type FigureHandle } from './draw.js';
import { figureSignal, type FigureSignal } from './signals.js';

describe('mount in a browser', () => {
	const canvases: HTMLCanvasElement[] = [];
	const handles: FigureHandle[] = [];

	function newCanvas(): HTMLCanvasElement {
		const canvas = document.createElement('canvas');
		canvases.push(canvas);
		return canvas;
	}

	async function mountOn(canvas: HTMLCanvasElement, bytes: Uint8Array) {
		const signals: FigureSignal[] = [];
		const handle = await mount(canvas, bytes, { onSignal: (signal) => signals.push(signal) });
		handles.push(handle);
		return { handle, signals };
	}

	afterEach(() => {
		handles.splice(0).forEach((handle) => handle.dispose());
		canvases.splice(0).forEach((canvas) => canvas.remove());
	});

	it('draws the conformant figure and tells it once', async () => {
		const { handle, signals } = await mountOn(newCanvas(), buildConformantVrm());

		expect(handle.signal).toBe(figureSignal.drawn);
		expect(signals).toEqual([figureSignal.drawn]);
		await new Promise((resolve) => requestAnimationFrame(resolve));
		await new Promise((resolve) => requestAnimationFrame(resolve));
		expect(signals).toEqual([figureSignal.drawn]);
	});

	it('refuses a file the check refuses without asking the canvas for a context', async () => {
		const canvas = newCanvas();
		const { handle, signals } = await mountOn(canvas, new TextEncoder().encode('plain text'));

		expect(handle.signal).toBe(figureSignal.refused);
		expect(signals).toEqual([figureSignal.refused]);
		expect(canvas.getContext('2d')).not.toBeNull();
	});

	it('refuses a file the check passes whose texture cannot be decoded', async () => {
		const { handle, signals } = await mountOn(newCanvas(), buildVrmGlbWithImages([buildPng(4, 2)]));

		expect(handle.signal).toBe(figureSignal.refused);
		expect(signals).toEqual([figureSignal.refused]);
	});

	it('draws a file whose texture data the browser decodes without an error, though the data is corrupt', async () => {
		const png = buildFigureTexturePng().slice();
		const pngSignatureLength = 8;
		const ihdrChunkLength = 25;
		const idatLengthAndTypeLength = 8;
		const firstZlibByte = pngSignatureLength + ihdrChunkLength + idatLengthAndTypeLength;
		png[firstZlibByte] ^= 0xff;

		const { handle, signals } = await mountOn(newCanvas(), buildVrmGlbWithImages([png]));

		expect(signals).toEqual([figureSignal.drawn]);
		expect(handle.signal).toBe(figureSignal.drawn);
	});

	it('resolves with refused instead of rejecting when the bytes are null', async () => {
		const { handle, signals } = await mountOn(newCanvas(), null as unknown as Uint8Array);

		expect(signals).toEqual([figureSignal.refused]);
		expect(handle.signal).toBe(figureSignal.refused);
	});

	it.each([
		['no options object', undefined],
		['an empty options object', {}],
	])('resolves with a signal when called with %s', async (_name, options) => {
		const handle = await mount(newCanvas(), buildConformantVrm(), options);
		handles.push(handle);

		expect(handle.signal).toBe(figureSignal.drawn);
	});

	it('is unsupported on a canvas that gives no WebGL 2 context', async () => {
		const canvas = newCanvas();
		canvas.getContext('2d');
		const { handle, signals } = await mountOn(canvas, buildConformantVrm());

		expect(handle.signal).toBe(figureSignal.unsupported);
		expect(signals).toEqual([figureSignal.unsupported]);
	});

	it('is unsupported, once, on a canvas whose control went to an offscreen canvas', async () => {
		const canvas = newCanvas();
		canvas.transferControlToOffscreen();

		const { handle, signals } = await mountOn(canvas, buildConformantVrm());

		expect(handle.signal).toBe(figureSignal.unsupported);
		expect(signals).toEqual([figureSignal.unsupported]);
	});

	it('resolves with lost, once, on a canvas whose figure was disposed', async () => {
		const canvas = newCanvas();
		const first = await mountOn(canvas, buildConformantVrm());
		first.handle.dispose();

		const { handle, signals } = await mountOn(canvas, buildConformantVrm());

		expect(handle.signal).toBe(figureSignal.lost);
		expect(signals).toEqual([figureSignal.lost]);
	});

	it('resolves with lost, once, on a canvas an earlier mount refused after loading', async () => {
		const canvas = newCanvas();
		const first = await mountOn(canvas, buildVrmGlbWithImages([buildPng(4, 2)]));
		expect(first.handle.signal).toBe(figureSignal.refused);

		const { handle, signals } = await mountOn(canvas, buildConformantVrm());

		expect(handle.signal).toBe(figureSignal.lost);
		expect(signals).toEqual([figureSignal.lost]);
	});

	it('gives its first signal before the promise resolves and the handle carries it', async () => {
		let resolved = false;
		const signalsBeforeResolve: FigureSignal[] = [];
		const pending = mount(newCanvas(), buildConformantVrm(), {
			onSignal: (signal) => {
				if (!resolved) signalsBeforeResolve.push(signal);
			}
		});
		const handle = await pending;
		resolved = true;
		handles.push(handle);

		expect(signalsBeforeResolve).toEqual([handle.signal]);
	});

	it('resolves when the app\'s signal callback throws and reports the error to the window', async () => {
		const reported: unknown[] = [];
		const report = (event: ErrorEvent) => {
			event.preventDefault();
			event.stopImmediatePropagation();
			reported.push(event.error);
		};
		window.addEventListener('error', report, { capture: true });
		const thrown = new Error('the app failed');
		const handle = await mount(newCanvas(), buildConformantVrm(), {
			onSignal: () => {
				throw thrown;
			}
		});
		window.removeEventListener('error', report, { capture: true });
		handles.push(handle);

		expect(handle.signal).toBe(figureSignal.drawn);
		expect(reported).toEqual([thrown]);
	});

	it('disposes twice without an error', async () => {
		const { handle } = await mountOn(newCanvas(), buildConformantVrm());

		handle.dispose();
		expect(() => handle.dispose()).not.toThrow();
	});

	it('frees the context on dispose and leaves a second handle drawn', async () => {
		const firstCanvas = newCanvas();
		const secondCanvas = newCanvas();
		const first = await mountOn(firstCanvas, buildConformantVrm());
		const second = await mountOn(secondCanvas, buildConformantVrm());

		first.handle.dispose();

		expect(firstCanvas.getContext('webgl2')?.isContextLost()).toBe(true);
		expect(secondCanvas.getContext('webgl2')?.isContextLost()).toBe(false);
		expect(second.handle.signal).toBe(figureSignal.drawn);
	});

	it('writes no style attribute and adds no element to the document', async () => {
		const canvas = newCanvas();
		const elementsBefore = document.querySelectorAll('*').length;

		await mountOn(canvas, buildConformantVrm());

		expect(canvas.hasAttribute('style')).toBe(false);
		expect(document.querySelectorAll('*')).toHaveLength(elementsBefore);
	});

	describe('a drawn figure follows its canvas', () => {
		let sizes: HTMLStyleElement;

		beforeAll(() => {
			sizes = document.createElement('style');
			sizes.textContent = '.small { width: 200px; height: 100px; } .wide { width: 300px; height: 150px; }';
			document.head.append(sizes);
		});

		afterAll(() => sizes.remove());

		afterEach(() => cdp().send('Emulation.clearDeviceMetricsOverride'));

		/** A canvas in the document, 200 CSS pixels wide by its stylesheet class (its attribute size is the default 300 by 150). */
		function attachedCanvas(): HTMLCanvasElement {
			const canvas = newCanvas();
			canvas.className = 'small';
			document.body.append(canvas);
			return canvas;
		}

		/** Whether the drawing buffer holds any pixel the figure covers: a buffer nothing was drawn into is transparent everywhere. */
		function figureIsDrawn(canvas: HTMLCanvasElement): boolean {
			const context = canvas.getContext('webgl2');
			if (context === null) throw new Error('the canvas has no WebGL 2 context');
			const pixels = new Uint8Array(canvas.width * canvas.height * 4);
			context.readPixels(0, 0, canvas.width, canvas.height, context.RGBA, context.UNSIGNED_BYTE, pixels);
			return pixels.some((value, index) => index % 4 === 3 && value > 0);
		}

		/** Waits for two animation frames, the frames in which a resize observer would have fired. */
		async function twoFrames(): Promise<void> {
			await new Promise((resolve) => requestAnimationFrame(resolve));
			await new Promise((resolve) => requestAnimationFrame(resolve));
		}

		it.each([
			[1, 200, 100],
			[1.5, 300, 150],
			[3, 400, 200]
		])('draws the buffer at the client size times the device pixel ratio capped at 2, at a ratio of %s', async (ratio, width, height) => {
			await emulateDevicePixelRatio(ratio);
			const canvas = attachedCanvas();
			await mountOn(canvas, buildConformantVrm());

			expect(canvas.width).toBe(width);
			expect(canvas.height).toBe(height);
		});

		it('follows a resize of the canvas by its host with no call on the handle, and the figure is still drawn', async () => {
			const canvas = attachedCanvas();
			await mountOn(canvas, buildConformantVrm());
			const bufferAtEachResize: { width: number; drawn: boolean }[] = [];
			const observer = new ResizeObserver(() => bufferAtEachResize.push({ width: canvas.width, drawn: figureIsDrawn(canvas) }));
			observer.observe(canvas);

			canvas.className = 'wide';
			await vi.waitFor(() => expect(canvas.width).toBe(300));
			observer.disconnect();

			expect(canvas.height).toBe(150);
			expect(bufferAtEachResize.at(-1)).toEqual({ width: 300, drawn: true });
		});

		it('follows a change of the device pixel ratio alone, with the canvas size unchanged', async () => {
			await emulateDevicePixelRatio(1);
			const queries: MediaQueryList[] = [];
			const matchMediaOwn = window.matchMedia;
			window.matchMedia = (query: string) => {
				const list = matchMediaOwn.call(window, query);
				queries.push(list);
				return list;
			};
			try {
				const canvas = attachedCanvas();
				await mountOn(canvas, buildConformantVrm());

				await emulateDevicePixelRatio(2);
				const ratioQuery = queries.filter((list) => list.media.startsWith('(resolution:')).at(-1);
				ratioQuery?.dispatchEvent(new Event('change'));
				await vi.waitFor(() => expect(canvas.width).toBe(400));

				expect(canvas.height).toBe(200);
			} finally {
				window.matchMedia = matchMediaOwn;
			}
		});

		it('writes no style attribute on a mount or a resize', async () => {
			const canvas = attachedCanvas();
			await mountOn(canvas, buildConformantVrm());

			canvas.className = 'wide';
			await vi.waitFor(() => expect(canvas.width).toBe(300));

			expect(canvas.hasAttribute('style')).toBe(false);
		});

		it('stops following on dispose, so a resize after it leaves the buffer as it was', async () => {
			const canvas = attachedCanvas();
			const { handle } = await mountOn(canvas, buildConformantVrm());
			handle.dispose();

			canvas.className = 'wide';
			await twoFrames();

			expect(canvas.width).toBe(200);
		});

		it('observes nothing once the figure is refused', async () => {
			const canvas = attachedCanvas();
			canvas.className = 'wide';
			await mountOn(canvas, new TextEncoder().encode('plain text'));

			canvas.className = 'small';
			await twoFrames();

			expect(canvas.width).toBe(300);
		});
	});
});

/**
 * Sets the page's device pixel ratio through the browser's own device emulation. Redefining `window.devicePixelRatio` would
 * change the value a read sees but fire no change, which is what a media query on the ratio reports.
 */
async function emulateDevicePixelRatio(ratio: number): Promise<void> {
	await cdp().send('Emulation.setDeviceMetricsOverride', {
		width: window.innerWidth,
		height: window.innerHeight,
		deviceScaleFactor: ratio,
		mobile: false
	});
}
