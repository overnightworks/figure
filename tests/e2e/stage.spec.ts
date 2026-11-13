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
/** The pixels of a canvas a shown mood changes at least: the brows and the mouth lie well beyond it, a sleeve's spring or a blink does not reach it. */
const shownPixels = 300;

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

/** The pixels of two screenshots that differ by more than a rounding of the colour: counted in the page, which decodes the PNGs. */
async function differingPixels(page: Page, first: Buffer, second: Buffer): Promise<number> {
	return page.evaluate(
		async ([before, after]) => {
			const pixelsOf = async (base64: string) => {
				const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))], { type: 'image/png' }));
				const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
				context.drawImage(bitmap, 0, 0);
				return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
			};
			const [one, other] = [await pixelsOf(before!), await pixelsOf(after!)];
			let differing = 0;
			for (let offset = 0; offset < one.length; offset += 4) {
				if ([0, 1, 2].some((channel) => Math.abs(one[offset + channel]! - other[offset + channel]!) > 32)) differing++;
			}
			return differing;
		},
		[first.toString('base64'), second.toString('base64')]
	);
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

	test('the think control reports the fact to both figures, which stay drawn', async ({ page }) => {
		const pageErrors = await openStage(page, stage);
		await expectTwoDrawings(page);

		await page.getByRole('button', { name: 'think' }).click();
		await expect(page.getByRole('button', { name: 'think' })).toHaveAttribute('aria-pressed', 'true');
		await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		await expectTwoDrawings(page);
		await expectNoViolations(page, pageErrors);
	});

	test('the speaker control names an element for both figures, which stay drawn while the dragged one moves', async ({ page }) => {
		const pageErrors = await openStage(page, stage);
		await expectTwoDrawings(page);

		for (const choice of ['left', 'right', 'drag', 'nobody']) {
			await page.getByLabel(choice === 'drag' ? 'drag me' : choice, { exact: true }).check();
			await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
			await expect(page.locator('[data-speaker]:not([hidden])')).toHaveCount(choice === 'nobody' ? 0 : 1);
		}
		await page.getByLabel('drag me').check();
		const marker = page.locator('[data-speaker="drag"]');
		const before = await marker.boundingBox();
		await marker.hover();
		await page.mouse.down();
		await page.mouse.move(before!.x - 50, before!.y - 50);
		await page.mouse.up();
		expect((await marker.boundingBox())!.x).toBeLessThan(before!.x);
		await expectTwoDrawings(page);
		await expectNoViolations(page, pageErrors);
	});

	/** A mono recording of a tone, as the bytes of a PCM WAV file: `seconds` long, at 8000 samples a second. */
	function toneRecording(seconds: number): Buffer {
		const rate = 8000;
		const samples = Math.round(rate * seconds);
		const bytes = Buffer.alloc(44 + 2 * samples);
		bytes.write('RIFF', 0);
		bytes.writeUInt32LE(36 + 2 * samples, 4);
		bytes.write('WAVEfmt ', 8);
		bytes.writeUInt32LE(16, 16);
		bytes.writeUInt16LE(1, 20);
		bytes.writeUInt16LE(1, 22);
		bytes.writeUInt32LE(rate, 24);
		bytes.writeUInt32LE(2 * rate, 28);
		bytes.writeUInt16LE(2, 32);
		bytes.writeUInt16LE(16, 34);
		bytes.write('data', 36);
		bytes.writeUInt32LE(2 * samples, 40);
		for (let sample = 0; sample < samples; sample++) bytes.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 220 * sample) / rate)), 44 + 2 * sample);
		return bytes;
	}

	test('the speak controls tell both figures a sentence with a synthesized vowel, without a voice and no more, and the figures stay drawn', async ({ page }) => {
		const pageErrors = await openStage(page, stage);
		await expectTwoDrawings(page);
		const status = page.locator('#voice-status');
		await expect(status).toHaveText('quiet');

		await page.getByLabel('oh', { exact: true }).check();
		await page.getByRole('button', { name: 'speak', exact: true }).click();
		await expect(status).toHaveText('speaking oh (audio running)');
		await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		await expectTwoDrawings(page);

		await page.getByRole('button', { name: 'speak without a voice' }).click();
		await expect(status).toHaveText('speaking without a voice');
		await page.getByRole('button', { name: 'stop' }).click();
		await expect(status).toHaveText('quiet');
		await expectTwoDrawings(page);
		await expectNoViolations(page, pageErrors);
	});

	test('the mood choice changes the face of the figure that speaks, a fresh figure is told at once, and none returns the face, with both figures still drawn', async ({ page }) => {
		// Held still, a figure's face changes only with the mood. The phone-wide figure lies in the viewport; both are told by the one control.
		await page.emulateMedia({ reducedMotion: 'reduce' });
		const pageErrors = await openStage(page, stage);
		await expectTwoDrawings(page);
		const figure = page.locator('canvas').nth(0);
		const pictures = () => figure.screenshot();
		const differs = (first: Buffer, second: Buffer) => differingPixels(page, first, second);
		const pickFigure = () => page.locator('#picker').setInputFiles({ name: 'figure.vrm', mimeType: 'model/gltf-binary', buffer: Buffer.from(buildConformantVrm()) });
		// Both figures are the picked one, so every picture is of the same model in the same state: speaking, held still.
		await pickFigure();
		await expectTwoDrawings(page);
		await page.getByRole('button', { name: 'speak without a voice' }).click();
		// A figure settles after its mount (its spring bones restart at the pose), so a picture counts once two successive ones no longer differ.
		const settledPicture = async () => {
			let latest = await pictures();
			await expect
				.poll(async () => {
					const next = await pictures();
					const moved = await differs(latest, next);
					latest = next;
					return moved;
				})
				.toBeLessThan(shownPixels / 10);
			return latest;
		};
		const neutral = await settledPicture();

		await page.getByLabel('surprised', { exact: true }).check();
		await expect.poll(async () => differs(neutral, await pictures())).toBeGreaterThan(shownPixels);
		const surprised = await pictures();
		await page.getByLabel('none', { exact: true }).check();
		await expect.poll(async () => differs(surprised, await pictures())).toBeGreaterThan(shownPixels);
		await expect.poll(async () => differs(neutral, await pictures())).toBeLessThan(shownPixels);

		await page.getByLabel('surprised', { exact: true }).check();
		await pickFigure();
		await expectTwoDrawings(page);
		const fresh = await settledPicture();
		expect(await differs(neutral, fresh)).toBeGreaterThan(shownPixels);
		expect(await differs(surprised, fresh)).toBeLessThan(shownPixels);
		await expectTwoDrawings(page);
		await expectNoViolations(page, pageErrors);
	});

	test('a picked audio file is played once and the figures are told when it ends', async ({ page }) => {
		const pageErrors = await openStage(page, stage);
		await expectTwoDrawings(page);
		const status = page.locator('#voice-status');

		await page.locator('#voice-picker').setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: toneRecording(1) });
		await expect(status).toHaveText('speaking tone.wav (audio running)');
		await expect(status).toHaveText('quiet', { timeout: drawingTimeout });
		await page.locator('#voice-picker').setInputFiles({ name: 'not-audio.wav', mimeType: 'audio/wav', buffer: Buffer.from('plain text') });
		await expect(status).toHaveText('not audio');
		await expectTwoDrawings(page);
		await expectNoViolations(page, pageErrors);
	});

	for (const [control, expected] of [
		['stop', 'quiet'],
		['speak without a voice', 'speaking without a voice']
	] as const) {
		test(`a picked audio file that is still decoding does not speak after ${control}`, async ({ page }) => {
			await page.addInitScript(() => {
				const held = window as unknown as { releaseDecode: () => void; decodeStarted: boolean; decodeFinished: boolean };
				const gate = new Promise<void>((release) => (held.releaseDecode = release));
				const decode = AudioContext.prototype.decodeAudioData;
				AudioContext.prototype.decodeAudioData = async function (this: AudioContext, bytes: ArrayBuffer) {
					held.decodeStarted = true;
					const recording = await decode.call(this, bytes);
					await gate;
					held.decodeFinished = true;
					return recording;
				};
			});
			const pageErrors = await openStage(page, stage);
			await expectTwoDrawings(page);
			const status = page.locator('#voice-status');

			await page.locator('#voice-picker').setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: toneRecording(30) });
			await page.waitForFunction(() => (window as unknown as { decodeStarted?: boolean }).decodeStarted === true);
			await page.getByRole('button', { name: control, exact: true }).click();
			await expect(status).toHaveText(expected);
			await page.evaluate(() => (window as unknown as { releaseDecode: () => void }).releaseDecode());
			await page.waitForFunction(() => (window as unknown as { decodeFinished?: boolean }).decodeFinished === true);
			await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

			await expect(status).toHaveText(expected);
			await expectTwoDrawings(page);
			await expectNoViolations(page, pageErrors);
		});
	}

	test('figures picked while the agent speaks are drawn and the stage still holds the sentence', async ({ page }) => {
		const pageErrors = await openStage(page, stage);
		await expectTwoDrawings(page);
		await page.getByRole('button', { name: 'speak without a voice' }).click();

		await page.locator('#picker').setInputFiles({ name: 'figure.vrm', mimeType: 'model/gltf-binary', buffer: Buffer.from(buildConformantVrm()) });
		await expectTwoDrawings(page);
		await expect(page.locator('#voice-status')).toHaveText('speaking without a voice');
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
