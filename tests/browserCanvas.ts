// What the browser tests share to read a drawn canvas: its pixels, the face's features in them, and the page's reduced-motion setting.
import { cdp } from 'vitest/browser';

/** The canvas's drawing buffer as RGBA bytes; read in the task that drew it, a buffer holds nothing afterwards. */
export function readPixels(canvas: HTMLCanvasElement): Uint8Array {
	const context = canvas.getContext('webgl2');
	if (context === null) throw new Error('the canvas has no WebGL 2 context');
	const pixels = new Uint8Array(canvas.width * canvas.height * 4);
	context.readPixels(0, 0, canvas.width, canvas.height, context.RGBA, context.UNSIGNED_BYTE, pixels);
	return pixels;
}

/** A face feature as the screen paints it: the eyes, the nose, or a dark feature, which is the mouth or a brow. */
export type FaceFeature = 'eye' | 'nose' | 'dark';

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
 * The face feature a pixel paints, or undefined for the skin and the background. The eyes are blue, the nose yellow, both far from the
 * skin's colour under the light, and a dark pixel is a mouth or a brow.
 */
export function faceFeatureOf(pixel: readonly number[]): FaceFeature | undefined {
	const [red, green, blue, alpha] = pixel as [number, number, number, number];
	if (alpha < OPAQUE_ALPHA) return undefined;
	if (Math.max(red, green, blue) < DARK_LIMIT) return 'dark';
	if (blue > 180 && red < 150) return 'eye';
	if (red > 200 && green > 190 && blue < 150) return 'nose';
	return undefined;
}

/** The spots of each face feature in a drawing buffer read from the bottom row up, measured from the top left. */
export function spotsOf(pixels: Uint8Array, width: number, height: number): Record<FaceFeature, Spot[]> {
	const spots: Record<FaceFeature, Spot[]> = { eye: [], nose: [], dark: [] };
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

/** Whether the pixels hold any the figure covers: a buffer nothing was drawn into is transparent everywhere. */
export function coversSomething(pixels: Uint8Array): boolean {
	return pixels.some((value, index) => index % 4 === 3 && value > 0);
}

/** Sets the page's `prefers-reduced-motion` to `reduce` through the browser's own media emulation, which is what a person's setting reaches the package as. */
export async function emulateReducedMotion(): Promise<void> {
	await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
}
