import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cdp } from 'vitest/browser';
import { buildConformantVrm, buildVrmGlbWithImages } from '../tests/figureFixtures.js';
import { buildFigureTexturePng, buildPng } from '../tests/glbBuilder.js';
import { buildRoomGlb } from '../tests/roomBuilder.js';
import { centreOf, coversSomething, emulateReducedMotion, readPixels, restorePageVisibility, setPageVisibility, spotsOf, nextFrame, requestFrameOwn, fakeFrameClock, type FrameClock } from '../tests/browserCanvas.js';
import * as draw from './draw.js';
import { mount, type FigureHandle } from './draw.js';
import { figureSignal, type FigureSignal } from './signals.js';
import { figureGesture } from './gestures.js';
import { figureFraming } from './framings.js';

describe('mount in a browser', () => {
	const canvases: HTMLCanvasElement[] = [];
	const handles: FigureHandle[] = [];
	/** The frames the figure asked for and ran since the test began. */
	const frames = { requested: 0, ran: 0 };
	/** What the canvas held when the last frame the figure ran was done: read in the frame's own task, where the buffer still holds the picture. */
	let shown: { width: number; height: number; pixels: Uint8Array } | undefined;
	let watchedCanvas: HTMLCanvasElement | undefined;

	beforeEach(() => {
		frames.requested = 0;
		frames.ran = 0;
		shown = undefined;
		watchedCanvas = undefined;
		window.requestAnimationFrame = (callback) => {
			frames.requested++;
			return requestFrameOwn.call(window, (time) => {
				callback(time);
				frames.ran++;
				if (watchedCanvas !== undefined) shown = { width: watchedCanvas.width, height: watchedCanvas.height, pixels: readPixels(watchedCanvas) };
			});
		};
	});

	function newCanvas(): HTMLCanvasElement {
		const canvas = document.createElement('canvas');
		canvases.push(canvas);
		return canvas;
	}

	/** A canvas in the document, 200 CSS pixels wide by its stylesheet class where the test sets one (its attribute size is the default 300 by 150), whose frames the test reads. */
	function attachedCanvas(): HTMLCanvasElement {
		const canvas = newCanvas();
		canvas.className = 'small';
		document.body.append(canvas);
		watchedCanvas = canvas;
		return canvas;
	}

	/** Runs `count` frames of the fake clock, each `milliseconds` after the one before. */
	function runFrames(clock: FrameClock, count: number, milliseconds: number): void {
		for (let frame = 0; frame < count; frame++) clock.advance(milliseconds);
	}

	async function mountOn(canvas: HTMLCanvasElement, bytes: Uint8Array) {
		const signals: FigureSignal[] = [];
		const handle = await mount(canvas, bytes, { onSignal: (signal) => signals.push(signal) });
		handles.push(handle);
		return { handle, signals };
	}

	afterEach(async () => {
		window.requestAnimationFrame = requestFrameOwn;
		handles.splice(0).forEach((handle) => handle.dispose());
		canvases.splice(0).forEach((canvas) => canvas.remove());
		await cdp().send('Emulation.setEmulatedMedia', { features: [] });
	});

	it('draws the conformant figure and tells it once', async () => {
		const { handle, signals } = await mountOn(newCanvas(), buildConformantVrm());

		expect(handle.signal).toBe(figureSignal.drawn);
		expect(signals).toEqual([figureSignal.drawn]);
		await nextFrame();
		await nextFrame();
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

	it('resolves with lost, never drawn, on a canvas whose context is lost while the figure loads, and requests no frame', async () => {
		const canvas = newCanvas();
		const signals: FigureSignal[] = [];
		const mounting = mount(canvas, buildConformantVrm(), { onSignal: (signal) => signals.push(signal) });
		loseContext(canvas);
		const handle = await mounting;
		handles.push(handle);

		expect(handle.signal).toBe(figureSignal.lost);
		expect(signals).toEqual([figureSignal.lost]);
		expect(frames.requested).toBe(0);
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

	/** Collects the errors that reach the window until the returned `stop` runs, and keeps them from failing the test run. */
	function collectWindowErrors(): { reported: unknown[]; stop: () => void } {
		const reported: unknown[] = [];
		const report = (event: ErrorEvent) => {
			event.preventDefault();
			event.stopImmediatePropagation();
			reported.push(event.error);
		};
		window.addEventListener('error', report, { capture: true });
		return { reported, stop: () => window.removeEventListener('error', report, { capture: true }) };
	}

	it('resolves when the app\'s signal callback throws and reports the error to the window', async () => {
		const { reported, stop } = collectWindowErrors();
		try {
			const thrown = new Error('the app failed');
			const handle = await mount(newCanvas(), buildConformantVrm(), {
				onSignal: () => {
					throw thrown;
				}
			});
			handles.push(handle);
			handle.dispose();
			await new Promise((settled) => requestAnimationFrame(settled));

			expect(handle.signal).toBe(figureSignal.drawn);
			expect(reported).toEqual([thrown]);
		} finally {
			stop();
		}
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

	describe('a drawn figure lives on its canvas', () => {
		let sizes: HTMLStyleElement;

		beforeAll(() => {
			sizes = document.createElement('style');
			sizes.textContent = '.small { width: 200px; height: 100px; } .wide { width: 300px; height: 150px; } .away { margin-top: 20000px; }';
			document.head.append(sizes);
		});

		afterAll(() => sizes.remove());

		afterEach(async () => {
			restorePageVisibility();
			await cdp().send('Emulation.clearDeviceMetricsOverride');
		});

		/** Waits until a page frame passes in which the figure neither asks for nor runs a frame: the viewport observer reports the move out of view in a frame of its own, so one frame later is too early. */
		async function untilNoFrameComes(): Promise<void> {
			let before;
			do {
				before = { ...frames };
				await nextFrame();
			} while (frames.requested !== before.requested || frames.ran !== before.ran);
		}

		/** The canvas as the last frame left it, once there is one. */
		async function pictureNow(): Promise<Uint8Array> {
			await vi.waitFor(() => expect(shown).toBeDefined());
			return shown!.pixels;
		}

		/** The canvas as it is `count` frames of the figure later. */
		async function pictureAfterFrames(count: number): Promise<Uint8Array> {
			const ranBefore = frames.ran;
			await vi.waitFor(() => expect(frames.ran).toBeGreaterThanOrEqual(ranBefore + count), { timeout: 5000 });
			return pictureNow();
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

			canvas.className = 'wide';
			await vi.waitFor(() => expect(shown?.width).toBe(300));

			expect(shown?.height).toBe(150);
			expect(coversSomething(shown!.pixels)).toBe(true);
		});

		it('follows a change of the device pixel ratio alone, with the canvas size unchanged', async () => {
			await emulateDevicePixelRatio(1);
			const canvas = attachedCanvas();
			await mountOn(canvas, buildConformantVrm());

			await emulateDevicePixelRatio(2);
			await vi.waitFor(() => expect(canvas.width).toBe(400));

			expect(canvas.height).toBe(200);
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
			await nextFrame();
			await nextFrame();

			expect(canvas.width).toBe(200);
		});

		it('follows nothing once the figure is refused', async () => {
			const canvas = attachedCanvas();
			canvas.className = 'wide';
			await mountOn(canvas, new TextEncoder().encode('plain text'));

			canvas.className = 'small';
			await nextFrame();
			await nextFrame();

			expect(canvas.width).toBe(300);
		});

		it('shows the eyes, the nose and the mouth where a face has them: the nose below the eyes and between them, the mouth below the nose', async () => {
			await emulateDevicePixelRatio(1);
			await mountOn(attachedCanvas(), buildConformantVrm());

			const spots = spotsOf(await pictureNow(), shown!.width, shown!.height);
			const eyes = centreOf(spots.eye);
			const nose = centreOf(spots.nose);
			const mouth = centreOf(spots.dark.filter(({ y }) => y > nose.y));

			expect(spots.eye.length).toBeGreaterThan(2);
			expect(nose.count).toBeGreaterThan(2);
			expect(mouth.count).toBeGreaterThan(2);
			expect(nose.y).toBeGreaterThan(eyes.y);
			expect(nose.x).toBeGreaterThan(Math.min(...spots.eye.map(({ x }) => x)));
			expect(nose.x).toBeLessThan(Math.max(...spots.eye.map(({ x }) => x)));
		});

		it('draws frames that differ as time passes', async () => {
			await mountOn(attachedCanvas(), buildConformantVrm());
			const first = await pictureNow();

			await vi.waitFor(() => expect(sameBytes(shown!.pixels, first)).toBe(false), { timeout: 15000 });
		});

		it('draws the figure under reduced motion', async () => {
			await emulateReducedMotion();
			await mountOn(attachedCanvas(), buildConformantVrm());

			expect(coversSomething(await pictureNow())).toBe(true);
		});

		it('holds still when the page asks for reduced motion while the figure lives, between its blinks', async () => {
			await mountOn(attachedCanvas(), buildConformantVrm());
			await pictureNow();

			await emulateReducedMotion();

			await vi.waitFor(
				async () => {
					const earlier = await pictureAfterFrames(1);
					expect(sameBytes(earlier, await pictureAfterFrames(40))).toBe(true);
				},
				{ timeout: 30000 }
			);
		});

		it('asks for no frame and draws nothing after dispose', async () => {
			const { handle } = await mountOn(attachedCanvas(), buildConformantVrm());
			await pictureNow();
			handle.dispose();
			const { requested, ran } = frames;

			await nextFrame();
			await nextFrame();
			await nextFrame();

			expect(frames).toEqual({ requested, ran });
		});

		it('asks for no frame after dispose, though the page is hidden and shown again and the canvas leaves and re-enters the viewport', async () => {
			const canvas = attachedCanvas();
			const { handle } = await mountOn(canvas, buildConformantVrm());
			await pictureNow();
			handle.dispose();
			const { requested, ran } = frames;

			setPageVisibility('hidden');
			setPageVisibility('visible');
			canvas.className = 'small away';
			await vi.waitFor(() => expect(canvas.getBoundingClientRect().top).toBeGreaterThan(window.innerHeight));
			canvas.className = 'small';
			await nextFrame();
			await nextFrame();
			await nextFrame();

			expect(frames).toEqual({ requested, ran });
		});

		it('asks for no frame once the figure is refused', async () => {
			await mountOn(attachedCanvas(), new TextEncoder().encode('plain text'));

			await nextFrame();
			await nextFrame();

			expect(frames.requested).toBe(0);
		});

		it('draws no frame while the page is hidden and goes on once it is visible again', async () => {
			await mountOn(attachedCanvas(), buildConformantVrm());
			await pictureNow();
			setPageVisibility('hidden');
			await nextFrame();
			const { requested, ran } = frames;

			await nextFrame();
			await nextFrame();
			await nextFrame();

			expect(frames).toEqual({ requested, ran });
			setPageVisibility('visible');
			await pictureAfterFrames(1);
		});

		it('draws no frame while the canvas is out of the viewport and goes on once it is back', async () => {
			const canvas = attachedCanvas();
			await mountOn(canvas, buildConformantVrm());
			await pictureNow();
			canvas.className = 'small away';
			await vi.waitFor(() => expect(canvas.getBoundingClientRect().top).toBeGreaterThan(window.innerHeight));
			await untilNoFrameComes();
			const { requested, ran } = frames;

			await nextFrame();
			await nextFrame();
			await nextFrame();

			expect(frames).toEqual({ requested, ran });
			canvas.className = 'small';
			await pictureAfterFrames(1);
		});

		it('ends on a context loss once: the signal says lost, and no later frame or signal comes', async () => {
			const canvas = attachedCanvas();
			const { handle, signals } = await mountOn(canvas, buildConformantVrm());
			await pictureNow();

			const extension = loseContext(canvas);
			await vi.waitFor(() => expect(signals).toEqual([figureSignal.drawn, figureSignal.lost]));
			const { requested, ran } = frames;
			extension.restoreContext();
			await nextFrame();
			await nextFrame();

			expect(handle.signal).toBe(figureSignal.lost);
			expect(signals).toEqual([figureSignal.drawn, figureSignal.lost]);
			expect(frames).toEqual({ requested, ran });
		});

		it('resolves with lost on a new mount of a canvas whose context a figure lost while it lived', async () => {
			const canvas = attachedCanvas();
			await mountOn(canvas, buildConformantVrm());
			await pictureNow();
			loseContext(canvas);
			await vi.waitFor(() => expect(canvas.getContext('webgl2')?.isContextLost()).toBe(true));

			const { handle, signals } = await mountOn(canvas, buildConformantVrm());

			expect(handle.signal).toBe(figureSignal.lost);
			expect(signals).toEqual([figureSignal.lost]);
		});

		it('disposes a lost figure twice without an error, and gives no signal for it', async () => {
			const canvas = attachedCanvas();
			const { handle, signals } = await mountOn(canvas, buildConformantVrm());
			await pictureNow();
			loseContext(canvas);
			await vi.waitFor(() => expect(signals).toContain(figureSignal.lost));

			handle.dispose();

			expect(() => handle.dispose()).not.toThrow();
			expect(signals).toEqual([figureSignal.drawn, figureSignal.lost]);
		});

		it('gives no signal when a living figure is disposed on purpose', async () => {
			const canvas = attachedCanvas();
			const { handle, signals } = await mountOn(canvas, buildConformantVrm());
			await pictureNow();

			handle.dispose();
			await vi.waitFor(() => expect(canvas.getContext('webgl2')?.isContextLost()).toBe(true));
			await nextFrame();
			await nextFrame();

			expect(signals).toEqual([figureSignal.drawn]);
		});

		it('leaves a second figure drawn and moving when the first one loses its context', async () => {
			const lostCanvas = attachedCanvas();
			const liveCanvas = attachedCanvas();
			const lost = await mountOn(lostCanvas, buildConformantVrm());
			const live = await mountOn(liveCanvas, buildConformantVrm());
			await pictureNow();

			loseContext(lostCanvas);
			await vi.waitFor(() => expect(lost.signals).toContain(figureSignal.lost));
			const first = await pictureAfterFrames(1);

			expect(live.handle.signal).toBe(figureSignal.drawn);
			await vi.waitFor(() => expect(sameBytes(shown!.pixels, first)).toBe(false), { timeout: 15000 });
		});

		describe('a drawn figure that cannot keep its frame time', () => {
			let clock: FrameClock;

			beforeEach(() => {
				clock = fakeFrameClock();
			});

			afterEach(() => clock.restore());

			it('gives slow once through onSignal, reads slow, and requests no frame after it', async () => {
				const { handle, signals } = await mountOn(attachedCanvas(), buildConformantVrm());
				await vi.waitFor(() => expect(clock.pending).toBe(1));

				runFrames(clock, 40, 60);

				expect(signals).toEqual([figureSignal.drawn, figureSignal.slow]);
				expect(handle.signal).toBe(figureSignal.slow);
				const requested = clock.requested;
				runFrames(clock, 2, 60);
				expect(clock.requested).toBe(requested);
				expect(clock.pending).toBe(0);
				expect(signals).toEqual([figureSignal.drawn, figureSignal.slow]);
			});

			it('reports each throw of the app\'s signal callback to the window while the figure lives and none after its disposal', async () => {
				const { reported, stop } = collectWindowErrors();
				try {
					const thrown = new Error('the app failed');
					const handle = await mount(attachedCanvas(), buildConformantVrm(), {
						onSignal: () => {
							throw thrown;
						}
					});
					handles.push(handle);
					await vi.waitFor(() => expect(clock.pending).toBe(1));

					runFrames(clock, 40, 60);
					await new Promise((settled) => setTimeout(settled, 0));

					expect(handle.signal).toBe(figureSignal.slow);
					expect(reported).toEqual([thrown, thrown]);
					handle.dispose();
					runFrames(clock, 2, 60);
					await new Promise((settled) => setTimeout(settled, 0));
					expect(reported).toEqual([thrown, thrown]);
				} finally {
					stop();
				}
			});

			it('gives no slow for forty frames 33 ms apart', async () => {
				const { handle, signals } = await mountOn(attachedCanvas(), buildConformantVrm());
				await vi.waitFor(() => expect(clock.pending).toBe(1));

				runFrames(clock, 40, 33);

				expect(signals).toEqual([figureSignal.drawn]);
				expect(handle.signal).toBe(figureSignal.drawn);
			});

			it('starts the window anew after a pause, so a slow gap is not a slow frame', async () => {
				const { signals } = await mountOn(attachedCanvas(), buildConformantVrm());
				await vi.waitFor(() => expect(clock.pending).toBe(1));
				runFrames(clock, 39, 60);

				setPageVisibility('hidden');
				await vi.waitFor(() => expect(clock.pending).toBe(0));
				clock.advance(10000);
				setPageVisibility('visible');
				await vi.waitFor(() => expect(clock.pending).toBe(1));
				runFrames(clock, 1, 33);

				expect(signals).toEqual([figureSignal.drawn]);
			});

			it('leaves a second figure drawn and moving when the first one is ended by slow', async () => {
				const first = await mountOn(attachedCanvas(), buildConformantVrm());
				await vi.waitFor(() => expect(clock.pending).toBe(1));
				runFrames(clock, 20, 60);
				const second = await mountOn(attachedCanvas(), buildConformantVrm());
				await vi.waitFor(() => expect(clock.pending).toBe(2));

				runFrames(clock, 20, 60);

				expect(first.signals).toEqual([figureSignal.drawn, figureSignal.slow]);
				expect(second.handle.signal).toBe(figureSignal.drawn);
				expect(clock.pending).toBe(1);
				runFrames(clock, 1, 60);
				expect(second.signals).toEqual([figureSignal.drawn]);
			});

			it('disposes a slow figure twice without an error, and gives no further signal', async () => {
				const { handle, signals } = await mountOn(attachedCanvas(), buildConformantVrm());
				await vi.waitFor(() => expect(clock.pending).toBe(1));
				runFrames(clock, 40, 60);

				handle.dispose();

				expect(() => handle.dispose()).not.toThrow();
				expect(signals).toEqual([figureSignal.drawn, figureSignal.slow]);
			});
		});
	});

	describe('a figure that ended', () => {
		let clock: FrameClock;

		beforeEach(() => {
			clock = fakeFrameClock();
		});

		afterEach(() => clock.restore());

		/** Mounts bytes on a canvas in the document and returns the handle and the signals its `onSignal` got. */
		async function mountAttached(bytes: Uint8Array) {
			const canvas = attachedCanvas();
			return { canvas, ...(await mountOn(canvas, bytes)) };
		}

		const endings: Record<string, () => Promise<{ handle: FigureHandle; signals: FigureSignal[] }>> = {
			refused: () => mountAttached(new Uint8Array(4)),
			disposed: async () => {
				const mounted = await mountAttached(buildConformantVrm());
				mounted.handle.dispose();
				return mounted;
			},
			lost: async () => {
				const mounted = await mountAttached(buildConformantVrm());
				loseContext(mounted.canvas);
				await vi.waitFor(() => expect(mounted.signals).toContain(figureSignal.lost));
				return mounted;
			},
			slow: async () => {
				const mounted = await mountAttached(buildConformantVrm());
				await vi.waitFor(() => expect(clock.pending).toBe(1));
				runFrames(clock, 40, 60);
				expect(mounted.signals).toContain(figureSignal.slow);
				return mounted;
			}
		};

		const verbs: Record<string, (handle: FigureHandle) => void> = {
			think: (handle) => handle.think(true),
			listen: (handle) => handle.listen(document.body),
			'speak with a sentence': (handle) => handle.speak({ mood: 'happy' }),
			'speak with null': (handle) => handle.speak(null),
			gesture: (handle) => handle.gesture(figureGesture.wave),
			frame: (handle) => handle.frame(figureFraming.fullBody),
			'room with bytes': (handle) => handle.room(buildRoomGlb()),
			'room with null': (handle) => handle.room(null),
			dispose: (handle) => handle.dispose()
		};

		describe.each(Object.keys(endings))('%s', (ending) => {
			it.each(Object.keys(verbs))('ignores %s: throws nothing, gives no signal and asks for no frame', async (verb) => {
				const { handle, signals } = await endings[ending]!();
				const signalsAtEnd = [...signals];
				const requestedAtEnd = clock.requested;

				expect(() => verbs[verb]!(handle)).not.toThrow();
				clock.advance(60);
				clock.advance(60);

				expect(signals).toEqual(signalsAtEnd);
				expect(clock.requested).toBe(requestedAtEnd);
			});
		});
	});
});

function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
	return first.length === second.length && first.every((value, index) => value === second[index]);
}

/**
 * Sets the page's device pixel ratio through the browser's own device emulation, as a zoom or a move to another screen changes
 * it, so the figure's next read of `window.devicePixelRatio` sees the browser's value.
 */
async function emulateDevicePixelRatio(ratio: number): Promise<void> {
	await cdp().send('Emulation.setDeviceMetricsOverride', {
		width: window.innerWidth,
		height: window.innerHeight,
		deviceScaleFactor: ratio,
		mobile: false
	});
}

/**
 * Makes the canvas's context lost, as a GPU reset does, and gives the extension that restores it: a lost context gives no
 * extensions, so the restore uses this one. The browser delivers the loss event in a later task.
 */
function loseContext(canvas: HTMLCanvasElement): WEBGL_lose_context {
	const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
	if (!extension) throw new Error('the canvas has no WEBGL_lose_context extension');
	extension.loseContext();
	return extension;
}

describe('the drawing export', () => {
	it('gives the host mount and the signals alone', () => {
		expect(Object.keys(draw).sort()).toEqual(['figureSignal', 'mount']);
	});
});
