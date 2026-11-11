import { expect, test, type BrowserContext } from '@playwright/test';
import { buildConformantVrm } from '../figureFixtures.js';
import { buildFigureTexturePng, figureTexture } from '../glbBuilder.js';
import { buildConsumer, type BuiltConsumer } from './build-consumer.js';
import { origin, recordPolicyViolations, scriptPolicy, serveConsumer } from './serve-consumer.js';

/** The RGBA of the pixel at `across` and `down`, fractions of the PNG's width and height, decoded in a page that has no policy. */
async function pixelAt(context: BrowserContext, png: Buffer, across: number, down: number): Promise<number[]> {
	const decoder = await context.newPage();
	const pixel = await decoder.evaluate(async ({ base64, across, down }) => {
		const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const drawing = canvas.getContext('2d')!;
		drawing.drawImage(bitmap, 0, 0);
		return Array.from(drawing.getImageData(Math.floor(bitmap.width * across), Math.floor(bitmap.height * down), 1, 1).data);
	}, { base64: png.toString('base64'), across, down });
	await decoder.close();
	return pixel;
}

/** A canvas point the head covers: the middle of the width, a quarter of the height down. */
const headAcross = 0.5;
const headDown = 0.25;
/** How far the lit colour's channel ratios may lie from the texture's: lighting in linear space moves them, an untextured figure is far off. */
const hueTolerance = 0.15;

test.describe('the packed package in a browser under the script policy', () => {
	let consumer: BuiltConsumer;
	test.beforeAll(async () => {
		consumer = await buildConsumer();
	});
	test.afterAll(() => consumer.remove());

	test('the check refuses a file that is not GLB and nothing else, and the policy is never violated', async ({ page }) => {
		const pageErrors = await recordPolicyViolations(page);
		await serveConsumer(page, consumer.bundleDirectory, {
			'/figure.vrm': buildConformantVrm(),
			'/not-glb.txt': new TextEncoder().encode('plain text')
		});

		const response = await page.goto(`${origin}/`);
		expect(response?.headers()['content-security-policy']).toBe(scriptPolicy);
		await expect(page.locator('#refusals[data-done]')).toBeAttached();

		const refusalsByFile = JSON.parse((await page.locator('#refusals').textContent()) ?? '');
		expect(refusalsByFile).toEqual({ 'figure.vrm': [], 'not-glb.txt': [{ code: 'not_glb' }] });
		expect(await page.evaluate(() => window.securityPolicyViolations)).toEqual([]);
		expect(pageErrors).toEqual([]);

		const hasWebGl2 = await page.evaluate(() => document.createElement('canvas').getContext('webgl2') !== null);
		console.log(`webgl2 with default flags: ${hasWebGl2}`);
		test.info().annotations.push({ type: 'webgl2', description: String(hasWebGl2) });
	});

	test('the conformant figure is drawn with its texture, and the policy is never violated', async ({ page, context }) => {
		const pageErrors = await recordPolicyViolations(page);
		await serveConsumer(page, consumer.bundleDirectory, { '/figure.vrm': buildConformantVrm() });
		await page.goto(`${origin}/`);
		await expect(page.locator('#figure[data-signals]')).toBeAttached();

		expect(await page.locator('#figure').getAttribute('data-signals')).toBe('drawn');
		const [red, green, blue, alpha] = await pixelAt(context, await page.locator('#figure').screenshot({ omitBackground: true }), headAcross, headDown);
		const [textureRed, textureGreen, textureBlue] = figureTexture.colour;
		expect(alpha).toBe(255);
		expect(Math.abs(green / red - textureGreen / textureRed)).toBeLessThan(hueTolerance);
		expect(Math.abs(blue / red - textureBlue / textureRed)).toBeLessThan(hueTolerance);
		expect(await page.evaluate(() => window.securityPolicyViolations)).toEqual([]);
		expect(pageErrors).toEqual([]);
	});

	test('an image element loads the figure texture at the size the builder gave it', async ({ page }) => {
		const pageErrors = await recordPolicyViolations(page);
		await serveConsumer(page, consumer.bundleDirectory, {
			'/figure.vrm': buildConformantVrm(),
			'/not-glb.txt': new TextEncoder().encode('plain text'),
			'/texture.png': buildFigureTexturePng()
		});
		await page.goto(`${origin}/`);

		const size = await page.evaluate(async () => {
			const image = new Image();
			image.src = '/texture.png';
			await image.decode();
			return { width: image.naturalWidth, height: image.naturalHeight };
		});
		expect(size).toEqual({ width: figureTexture.width, height: figureTexture.height });
		expect(await page.evaluate(() => window.securityPolicyViolations)).toEqual([]);
		expect(pageErrors).toEqual([]);
	});
});
