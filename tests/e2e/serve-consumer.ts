import { existsSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import type { Page } from '@playwright/test';

export const origin = 'http://consumer.test';

/** The script policy a figure page runs under; every response of the page carries exactly this header. */
export const scriptPolicy =
	"default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' blob:; worker-src 'self'";

/** Serves the bundle and `files` (path to bytes) through request routing, so no server process exists. */
export async function serveConsumer(
	page: Page,
	bundleDirectory: string,
	files: Readonly<Record<string, Uint8Array>>
): Promise<void> {
	const headers = { 'Content-Security-Policy': scriptPolicy };
	await page.route(`${origin}/**`, async (route) => {
		const { pathname } = new URL(route.request().url());
		const served = files[pathname];
		if (served !== undefined) {
			return route.fulfill({ body: Buffer.from(served), contentType: 'application/octet-stream', headers });
		}
		const file = normalize(join(bundleDirectory, pathname === '/' ? 'index.html' : pathname));
		if (!file.startsWith(bundleDirectory + sep) || !existsSync(file) || !statSync(file).isFile()) {
			return route.fulfill({ status: 404, headers });
		}
		return route.fulfill({ path: file, headers });
	});
}
