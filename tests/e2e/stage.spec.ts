import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'vite';
import { buildConformantVrm } from '../figureFixtures.js';
import { origin, recordPolicyViolations, scriptPolicy, serveConsumer } from './serve-consumer.js';

const stageConfig = fileURLToPath(new URL('../stage/vite.config.ts', import.meta.url));
/** Mounting two figures in a page takes longer than a plain page load, so the signals are awaited with this bound. */
const drawingTimeout = 30_000;

interface BuiltStage {
	readonly bundleDirectory: string;
	remove(): void;
}

/** Builds the stage page from its source into a temporary directory, as the stage command builds it into its own `dist/`. */
async function buildStage(): Promise<BuiltStage> {
	const workDirectory = mkdtempSync(join(tmpdir(), 'figure-stage-'));
	const bundleDirectory = join(workDirectory, 'bundle');
	await build({ configFile: stageConfig, logLevel: 'warn', build: { outDir: bundleDirectory, emptyOutDir: true } });
	return { bundleDirectory, remove: () => rmSync(workDirectory, { recursive: true, force: true }) };
}

/** Opens the stage under the script policy and returns the page errors it collects; it does not wait for the drawings. */
async function openStage(page: Page, stage: BuiltStage): Promise<string[]> {
	const pageErrors = await recordPolicyViolations(page);
	await serveConsumer(page, stage.bundleDirectory, {});
	const response = await page.goto(`${origin}/`);
	expect(response?.headers()['content-security-policy']).toBe(scriptPolicy);
	return pageErrors;
}

async function expectTwoDrawings(page: Page): Promise<void> {
	await expect(page.locator('canvas[data-signal="drawn"]')).toHaveCount(2, { timeout: drawingTimeout });
}

async function pickNotAFigure(page: Page): Promise<void> {
	await page.locator('#picker').setInputFiles({
		name: 'not-glb.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from('plain text')
	});
}

/** The closing assertions of every test: no script-policy violation and no page error. */
async function expectNoViolations(page: Page, pageErrors: string[]): Promise<void> {
	expect(await page.evaluate(() => window.securityPolicyViolations)).toEqual([]);
	expect(pageErrors).toEqual([]);
}

test.describe('the demo stage under the script policy', () => {
	let stage: BuiltStage;
	test.beforeAll(async () => {
		stage = await buildStage();
	});
	test.afterAll(() => stage.remove());

	test('mounts the synthetic figure at 390 and 1280 px, and the policy is never violated', async ({ page }) => {
		const pageErrors = await openStage(page, stage);
		await expectTwoDrawings(page);
		await expect(page.locator('canvas').nth(0)).toHaveCSS('width', '390px');
		await expect(page.locator('canvas').nth(1)).toHaveCSS('width', '1280px');
		await expectNoViolations(page, pageErrors);
	});

	test('a picked figure replaces both drawings on fresh canvases', async ({ page }) => {
		const pageErrors = await openStage(page, stage);
		await expectTwoDrawings(page);
		const previousCanvas = await page.locator('canvas').nth(0).elementHandle();

		await page.locator('#picker').setInputFiles({
			name: 'figure.vrm',
			mimeType: 'model/gltf-binary',
			buffer: Buffer.from(buildConformantVrm())
		});
		await expect.poll(() => previousCanvas!.evaluate((canvas) => canvas.isConnected), { timeout: drawingTimeout }).toBe(false);
		await expectTwoDrawings(page);
		await expectNoViolations(page, pageErrors);
	});

	test('a picked file that is no figure ends both drawings with their signal and offers mount again', async ({ page }) => {
		const pageErrors = await openStage(page, stage);
		await expectTwoDrawings(page);

		await pickNotAFigure(page);
		await expect(page.locator('canvas[data-signal="refused"]')).toHaveCount(2, { timeout: drawingTimeout });
		await expect(page.getByRole('button', { name: 'mount again' })).toHaveCount(2);
		await expect(page.getByRole('button', { name: 'mount again' }).first()).toBeVisible();
		await expectNoViolations(page, pageErrors);
	});

	test('mount again replaces an ended canvas with a fresh one', async ({ page }) => {
		const pageErrors = await openStage(page, stage);
		await expectTwoDrawings(page);
		await pickNotAFigure(page);
		await expect(page.getByRole('button', { name: 'mount again' })).toHaveCount(2, { timeout: drawingTimeout });
		const endedCanvas = await page.locator('canvas').nth(0).elementHandle();

		await page.getByRole('button', { name: 'mount again' }).first().click();
		await expect.poll(() => endedCanvas!.evaluate((canvas) => canvas.isConnected), { timeout: drawingTimeout }).toBe(false);
		await expect(page.locator('canvas')).toHaveCount(2);
		await expect(page.locator('canvas[data-signal="refused"]')).toHaveCount(2, { timeout: drawingTimeout });
		await expect(page.getByRole('button', { name: 'mount again' })).toHaveCount(2);
		await expectNoViolations(page, pageErrors);
	});
});
