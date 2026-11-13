// What the browser tests share to read a drawn canvas: its pixels, the face's features in them, the mouth's opening, and the page's reduced-motion setting.
import { cdp } from 'vitest/browser';

/** The canvas's drawing buffer as RGBA bytes; read in the task that drew it, a buffer holds nothing afterwards. */
export function readPixels(canvas: HTMLCanvasElement): Uint8Array {
	const context = canvas.getContext('webgl2');
	if (context === null) throw new Error('the canvas has no WebGL 2 context');
	const pixels = new Uint8Array(canvas.width * canvas.height * 4);
	context.readPixels(0, 0, canvas.width, canvas.height, context.RGBA, context.UNSIGNED_BYTE, pixels);
	return pixels;
}

/** A feature as the screen paints it: the eyes, the nose, a dark feature (the mouth or a brow), an arm, or a sleeve. */
export type FaceFeature = 'eye' | 'nose' | 'dark' | 'arm' | 'sleeve';

/** A pixel's position on the canvas, measured from its top left corner. */
export interface Spot {
	readonly x: number;
	readonly y: number;
}

/** A pixel darker than this on every channel is a dark feature: the mouth and the brows stay below it under the light, the skin above it. */
const DARK_LIMIT = 120;
/** A pixel covered this much or more is part of a feature, not an antialiased edge against the background. */
const OPAQUE_ALPHA = 200;

/**
 * The feature a pixel paints, or undefined for the skin and the background. The eyes are blue, the nose yellow, the arms green and the sleeves magenta, all far
 * from the skin's colour under the light, and a dark pixel is a mouth or a brow.
 */
export function faceFeatureOf(pixel: readonly number[]): FaceFeature | undefined {
	const [red, green, blue, alpha] = pixel as [number, number, number, number];
	if (alpha < OPAQUE_ALPHA) return undefined;
	if (Math.max(red, green, blue) < DARK_LIMIT) return 'dark';
	if (blue > 180 && red < 150) return 'eye';
	if (red > 200 && green > 190 && blue < 150) return 'nose';
	if (green > red + 60 && green > blue + 60) return 'arm';
	if (red > 150 && blue > 120 && green < red - 80 && green < blue - 40) return 'sleeve';
	return undefined;
}

/** The spots of each face feature in a drawing buffer read from the bottom row up, measured from the top left. */
export function spotsOf(pixels: Uint8Array, width: number, height: number): Record<FaceFeature, Spot[]> {
	const spots: Record<FaceFeature, Spot[]> = { eye: [], nose: [], dark: [], arm: [], sleeve: [] };
	for (let row = 0; row < height; row++) {
		for (let column = 0; column < width; column++) {
			const offset = 4 * (row * width + column);
			const feature = faceFeatureOf(Array.from(pixels.subarray(offset, offset + 4)));
			if (feature !== undefined) spots[feature].push({ x: column, y: height - 1 - row });
		}
	}
	return spots;
}

/** The number of spots and their mean position. */
export function centreOf(spots: readonly Spot[]): { count: number; x: number; y: number } {
	const sum = spots.reduce((total, { x, y }) => ({ x: total.x + x, y: total.y + y }), { x: 0, y: 0 });
	return { count: spots.length, x: sum.x / spots.length, y: sum.y / spots.length };
}

/** How far from the nose's column, in pixels at a canvas 200 wide, a dark pixel still belongs to the mouth rather than to a corner of it. */
const MOUTH_REACH = 6;

/** The mouth's dark pixels: those below the nose and within `MOUTH_REACH` of its column, where the mouth is the only dark feature. */
function mouthPixels(spots: Record<FaceFeature, Spot[]>): Spot[] {
	const nose = centreOf(spots.nose);
	return spots.dark.filter(({ x, y }) => y > nose.y && Math.abs(x - nose.x) <= MOUTH_REACH);
}

/** How many rows the mouth covers. */
export function mouthRows(spots: Record<FaceFeature, Spot[]>): number {
	return new Set(mouthPixels(spots).map(({ y }) => y)).size;
}

/** How far below the nose's centre the mouth's lowest row lies, in pixels. */
export function mouthDepthBelowNose(spots: Record<FaceFeature, Spot[]>): number {
	return Math.max(...mouthPixels(spots).map(({ y }) => y)) - centreOf(spots.nose).y;
}

/** Whether the pixels hold any the figure covers: a buffer nothing was drawn into is transparent everywhere. */
export function coversSomething(pixels: Uint8Array): boolean {
	return pixels.some((value, index) => index % 4 === 3 && value > 0);
}

/** Sets the page's `prefers-reduced-motion` to `reduce` through the browser's own media emulation, which is what a person's setting reaches the package as. */
export async function emulateReducedMotion(): Promise<void> {
	await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
}

/** How far, in pixels, a dark pixel of one picture may lie from one of the other, once both are measured from the nose, and still be the same feature. */
const SAME_FEATURE_REACH = 1;

/**
 * How many dark pixels (the mouth, its corners and the brows) of either picture have none of the other within `SAME_FEATURE_REACH`, each
 * measured from its own picture's nose, so a head that moved as a whole changes little and a feature that moved on the face changes much.
 */
export function faceDifference(first: Record<FaceFeature, Spot[]>, second: Record<FaceFeature, Spot[]>): number {
	const fromNose = (spots: Record<FaceFeature, Spot[]>) => {
		const nose = centreOf(spots.nose);
		return spots.dark.map(({ x, y }) => ({ x: x - nose.x, y: y - nose.y }));
	};
	const unmatched = (from: readonly Spot[], to: readonly Spot[]) =>
		from.filter((spot) => !to.some((other) => Math.abs(other.x - spot.x) <= SAME_FEATURE_REACH && Math.abs(other.y - spot.y) <= SAME_FEATURE_REACH)).length;
	const [firstDark, secondDark] = [fromNose(first), fromNose(second)];
	return unmatched(firstDark, secondDark) + unmatched(secondDark, firstDark);
}
