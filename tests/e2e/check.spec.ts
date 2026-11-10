import { expect, test, type Page } from '@playwright/test';
import { buildConformantVrm } from '../figureFixtures.js';
import { buildFigureTexturePng, figureTexture } from '../glbBuilder.js';
import { buildConsumer, type BuiltConsumer } from './build-consumer.js';
import { origin, scriptPolicy, serveConsumer } from './serve-consumer.js';

declare global {
	interface Window {
		securityPolicyViolations: string[];
	}
}

/** Collects the page's errors and, in `window.securityPolicyViolations`, every violation of the script policy; returns the errors. */
async function recordPolicyViolations(page: Page): Promise<string[]> {
	const pageErrors: string[] = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	await page.addInitScript(() => {
		window.securityPolicyViolations = [];
		document.addEventListener('securitypolicyviolation', (event) => {
			window.securityPolicyViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
		});
	});
	return pageErrors;
}

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
