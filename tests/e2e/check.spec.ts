import { expect, test } from '@playwright/test';
import { buildConformantVrm } from '../figureFixtures.js';
import { buildConsumer, type BuiltConsumer } from './build-consumer.js';
import { origin, scriptPolicy, serveConsumer } from './serve-consumer.js';

declare global {
	interface Window {
		securityPolicyViolations: string[];
	}
}

test.describe('the packed package in a browser under the script policy', () => {
	let consumer: BuiltConsumer;
	test.beforeAll(async () => {
		consumer = await buildConsumer();
	});
	test.afterAll(() => consumer.remove());

	test('the check refuses a file that is not GLB and nothing else, and the policy is never violated', async ({ page }) => {
		const pageErrors: string[] = [];
		page.on('pageerror', (error) => pageErrors.push(error.message));
		await page.addInitScript(() => {
			window.securityPolicyViolations = [];
			document.addEventListener('securitypolicyviolation', (event) => {
				window.securityPolicyViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
			});
		});
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
});
