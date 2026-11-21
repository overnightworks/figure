import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Mesh, type BufferGeometry, type Material, type Object3D, type Texture } from 'three';
import { emulateReducedMotion, pixelAt, restorePageVisibility, setPageVisibility } from '../tests/browserCanvas.js';
import { cdp } from 'vitest/browser';
import { buildImagePng, buildPng, type Rgba } from '../tests/glbBuilder.js';
import { startFigureWatch, type FigureWatch, type Picture } from '../tests/figureWatch.js';
import { buildRoomGlb } from '../tests/roomBuilder.js';
import type { MountOptions } from './draw.js';
import type { RoomLoad } from './figureMount.js';
import { figureFraming } from './framings.js';
import { figureSignal, type FigureSignal } from './signals.js';
import { loadRoom } from './roomLoader.js';

const green: Rgba = [30, 200, 40, 255];
const red: Rgba = [200, 30, 40, 255];
/** A room whose floor and wall are one colour, which is what a pixel the figure does not cover shows of it. */
const roomOf = (colour: Rgba) => buildRoomGlb({ look: 'textured', images: [buildImagePng(4, 2, colour)] });
/** A room that passes the check and whose image does not decode. */
const undecodableRoom = () => buildRoomGlb({ look: 'textured', images: [buildPng(4, 2)] });
const notARoom = () => new Uint8Array(4);

/** How far the dominant channel of a pixel exceeds the others for it to count as that colour. */
const dominance = 80;
const isGreen = ([r, g, b, a]: readonly number[]) => a === 255 && g > r! + dominance && g > b! + dominance;
const isRed = ([r, g, b, a]: readonly number[]) => a === 255 && r! > g! + dominance && r! > b! + dominance;
const isTransparent = (pixel: readonly number[]) => pixel[3] === 0;

/** The pixel at the left edge, in the middle of the picture, which the figure never covers. */
const edgeOf = ({ pixels, width, height }: Picture) => pixelAt(pixels, width, height, 3, Math.floor(height / 2));

const frames = 3;
/** The longest a test waits for something the page does on its own. */
const settleMilliseconds = 5000;
const requestFrameOwn = window.requestAnimationFrame;
const nextFrame = () => new Promise<void>((resolve) => requestFrameOwn.call(window, () => resolve()));

/** What a parsed room's geometries, materials and textures report through three's own `dispose` events. */
function freedOf(room: Object3D): () => boolean {
	const things = new Set<BufferGeometry | Material | Texture>();
	room.traverse((node) => {
		if (!(node instanceof Mesh)) return;
		things.add(node.geometry);
		for (const material of [node.material].flat()) {
			things.add(material);
			if ('map' in material && material.map !== null) things.add(material.map);
		}
	});
	const freed = new Set<unknown>();
	for (const thing of things) (thing as BufferGeometry).addEventListener('dispose', () => freed.add(thing));
	return () => freed.size === things.size;
}

/** One call of the room parse, held until the test ends it. */
interface HeldParse {
	readonly bytes: Uint8Array;
	/** Parses the bytes with figure's own loader and hands the room to the mount. */
	finish(): Promise<void>;
	/** Ends the parse in a failure. */
	fail(): void;
	/** Whether everything the parsed room holds has been freed; false until it parsed. */
	freed(): boolean;
}

/** A room parse that waits on the test: each call the mount makes is a held parse in `parses`, in call order. */
function holdRoomLoad() {
	const parses: HeldParse[] = [];
	const load: RoomLoad = (bytes) =>
		new Promise((resolve, reject) => {
			let isFreed = () => false;
			parses.push({
				bytes,
				async finish() {
					const room = await loadRoom(bytes);
					isFreed = freedOf(room);
					resolve(room);
				},
				fail: () => reject(new Error('the parse failed')),
				freed: () => isFreed()
			});
		});
	return { load, parses };
}

describe('mount with a room', { timeout: 60_000 }, () => {
	let watch: FigureWatch;
	const problems: unknown[] = [];
	const onUnhandledRejection = (event: PromiseRejectionEvent) => problems.push(event.reason);

	beforeEach(() => {
		watch = startFigureWatch();
		problems.length = 0;
		window.addEventListener('unhandledrejection', onUnhandledRejection);
	});

	afterEach(async () => {
		window.removeEventListener('unhandledrejection', onUnhandledRejection);
		watch.end();
		restorePageVisibility();
		await cdp().send('Emulation.setEmulatedMedia', { features: [] });
	});

	/** The edge of the picture after a few frames, long enough for anything the figure was told to have reached it. */
	async function edgeAfterFrames(canvas: HTMLCanvasElement): Promise<readonly number[]> {
		let picture = await watch.pictureOfNextFrame(canvas);
		for (let frame = 1; frame < frames; frame++) picture = await watch.pictureOfNextFrame(canvas);
		return edgeOf(picture);
	}

	async function expectEdge(canvas: HTMLCanvasElement, matches: (pixel: readonly number[]) => boolean): Promise<void> {
		await vi.waitFor(async () => expect(matches(edgeOf(await watch.pictureOfNextFrame(canvas)))).toBe(true), { timeout: settleMilliseconds });
	}

	async function mountHolding(options?: MountOptions, bytes?: Uint8Array) {
		const held = holdRoomLoad();
		const mounted = await watch.mountFigure(bytes, options, undefined, held.load);
		return { ...mounted, ...held };
	}

	it('draws the figure and gives its signal before the room has parsed, then shows the room behind it', async () => {
		const signals: FigureSignal[] = [];
		const { canvas, handle, parses } = await mountHolding({ room: roomOf(green), onSignal: (signal) => signals.push(signal) });

		expect(signals).toEqual([figureSignal.drawn]);
		expect(isTransparent(await edgeAfterFrames(canvas))).toBe(true);
		await parses[0]!.finish();
		await expectEdge(canvas, isGreen);
		expect(handle.signal).toBe(figureSignal.drawn);
		expect(problems).toEqual([]);
	});

	it.each(Object.values(figureFraming))('shows the room in the %s framing', async (framing) => {
		const { canvas: plain } = await watch.mountFigure(undefined, { framing });
		const { canvas } = await watch.mountFigure(undefined, { framing, room: roomOf(green) });
		const opaquePixels = async (target: HTMLCanvasElement) => {
			const { pixels } = await watch.pictureOfNextFrame(target);
			return pixels.filter((value, index) => index % 4 === 3 && value > 0).length;
		};

		await vi.waitFor(async () => expect(await opaquePixels(canvas)).toBeGreaterThan(1.2 * (await opaquePixels(plain))), { timeout: settleMilliseconds });
	});

	it('shows a room that is handed after the mount, and the transparent canvas without one', async () => {
		const { canvas, handle, parses } = await mountHolding();

		expect(isTransparent(await edgeAfterFrames(canvas))).toBe(true);
		handle.room(roomOf(green));
		await parses[0]!.finish();
		await expectEdge(canvas, isGreen);
	});

	it.each([
		['fails the check', notARoom],
		['passes the check and fails the load', undecodableRoom]
	])('leaves the transparent canvas and the figure alive for a room that %s', async (_, bytes) => {
		const signals: FigureSignal[] = [];
		const { canvas, handle } = await watch.mountFigure(undefined, { room: bytes(), onSignal: (signal) => signals.push(signal) });

		expect(isTransparent(await edgeAfterFrames(canvas))).toBe(true);
		expect((await watch.featuresNow(canvas)).eye.length).toBeGreaterThan(0);
		expect(handle.signal).toBe(figureSignal.drawn);
		expect(signals).toEqual([figureSignal.drawn]);
		expect(problems).toEqual([]);
	});

	it('hands the parse no room that fails the check', async () => {
		const { handle, parses } = await mountHolding({ room: notARoom() });

		handle.room(new Uint8Array(0));

		expect(parses).toHaveLength(0);
	});

	it('shows the room of the last call and frees the other, whichever parse ends first', async () => {
		for (const order of [
			[0, 1],
			[1, 0]
		] as const) {
			const { canvas, handle, parses } = await mountHolding();
			handle.room(roomOf(green));
			handle.room(roomOf(red));
			for (const index of order) await parses[index]!.finish();
			await nextFrame();

			await expectEdge(canvas, isRed);
			expect(parses[0]!.freed()).toBe(true);
			expect(parses[1]!.freed()).toBe(false);
		}
		expect(problems).toEqual([]);
	});

	it('keeps the room on screen until its replacement has parsed, then swaps it in and frees it', async () => {
		const { canvas, handle, parses } = await mountHolding({ room: roomOf(green) });
		await parses[0]!.finish();
		await expectEdge(canvas, isGreen);

		handle.room(roomOf(red));
		expect(isGreen(await edgeAfterFrames(canvas))).toBe(true);
		await parses[1]!.finish();

		await expectEdge(canvas, isRed);
		expect(parses[0]!.freed()).toBe(true);
	});

	it.each([
		['fails the check', () => notARoom(), false],
		['fails the load', () => roomOf(red), true]
	])('leaves none when its replacement %s', async (_, replacement, reachesLoad) => {
		const { canvas, handle, parses } = await mountHolding({ room: roomOf(green) });
		await parses[0]!.finish();
		await expectEdge(canvas, isGreen);

		handle.room(replacement());
		if (reachesLoad) parses[1]!.fail();

		await expectEdge(canvas, isTransparent);
		expect(parses[0]!.freed()).toBe(true);
	});

	it('removes the room at once and frees it with room(null)', async () => {
		const { canvas, handle, parses } = await mountHolding({ room: roomOf(green) });
		await parses[0]!.finish();
		await expectEdge(canvas, isGreen);

		handle.room(null);

		await expectEdge(canvas, isTransparent);
		expect(parses[0]!.freed()).toBe(true);
	});

	it('drops a room that is still loading when room(null) is called, and frees it when it has parsed', async () => {
		const { canvas, handle, parses } = await mountHolding({ room: roomOf(green) });

		handle.room(null);
		await parses[0]!.finish();

		await vi.waitFor(() => expect(parses[0]!.freed()).toBe(true), { timeout: settleMilliseconds });
		expect(isTransparent(await edgeAfterFrames(canvas))).toBe(true);
	});

	it('frees a room that parses after dispose, and the one on screen when it is disposed', async () => {
		const loading = await mountHolding({ room: roomOf(green) });
		loading.handle.dispose();
		await loading.parses[0]!.finish();
		const shown = await mountHolding({ room: roomOf(red) });
		await shown.parses[0]!.finish();
		await expectEdge(shown.canvas, isRed);
		shown.handle.dispose();

		await vi.waitFor(() => expect(loading.parses[0]!.freed()).toBe(true), { timeout: settleMilliseconds });
		expect(shown.parses[0]!.freed()).toBe(true);
	});

	it('ignores a call after dispose', async () => {
		const { handle, parses } = await mountHolding();
		handle.dispose();

		expect(() => handle.room(roomOf(green))).not.toThrow();
		expect(parses).toHaveLength(0);
	});

	it('ignores a value that is neither bytes nor null and leaves the room and a running load as they are', async () => {
		const { canvas, handle, parses } = await mountHolding({ room: roomOf(green) });
		await parses[0]!.finish();
		await expectEdge(canvas, isGreen);
		handle.room(roomOf(red));

		for (const value of [undefined, 42, 'room', {}, [1, 2], new ArrayBuffer(8)]) handle.room(value as unknown as Uint8Array);
		await parses[1]!.finish();

		await expectEdge(canvas, isRed);
		expect(parses).toHaveLength(2);
	});

	it('changes nothing for the same bytes as the latest call', async () => {
		const bytes = roomOf(green);
		const { handle, parses } = await mountHolding({ room: bytes });

		handle.room(bytes);

		expect(parses).toHaveLength(1);
	});

	it('draws the figure without a room for an option that cannot be read', async () => {
		const options = {
			get room(): Uint8Array {
				throw new Error('unreadable');
			}
		};
		const { canvas, handle } = await mountHolding(options);

		expect(handle.signal).toBe(figureSignal.drawn);
		expect(isTransparent(await edgeAfterFrames(canvas))).toBe(true);
	});

	it('shows a room that parsed while the page was hidden when the page shows again', async () => {
		const { canvas, handle, parses } = await mountHolding();
		setPageVisibility('hidden');

		handle.room(roomOf(green));
		await parses[0]!.finish();
		await nextFrame();
		setPageVisibility('visible');

		await expectEdge(canvas, isGreen);
	});

	it('keeps the room under reduced motion', async () => {
		await emulateReducedMotion();
		const { canvas } = await watch.mountFigure(undefined, { room: roomOf(green) });

		await expectEdge(canvas, isGreen);
	});
});
