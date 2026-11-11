import { existsSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import type { Page } from '@playwright/test';

export const origin = 'http://consumer.test';

declare global {
	interface Window {
		securityPolicyViolations: string[];
	}
}

/** Collects the page's errors and, in `window.securityPolicyViolations`, every violation of the script policy; returns the errors. */
export async function recordPolicyViolations(page: Page): Promise<string[]> {
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
