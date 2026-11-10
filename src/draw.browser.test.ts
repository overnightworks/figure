import { afterEach, describe, expect, it } from 'vitest';
import { buildConformantVrm, buildVrmGlbWithImages } from '../tests/figureFixtures.js';
import { buildPng } from '../tests/glbBuilder.js';
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
		canvases.splice(0);
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

	it('is unsupported on a canvas that gives no WebGL 2 context', async () => {
		const canvas = newCanvas();
		canvas.getContext('2d');
		const { handle, signals } = await mountOn(canvas, buildConformantVrm());

		expect(handle.signal).toBe(figureSignal.unsupported);
		expect(signals).toEqual([figureSignal.unsupported]);
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
		expect(document.querySelectorAll('*').length).toBe(elementsBefore);
	});
});
