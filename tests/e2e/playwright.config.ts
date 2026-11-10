import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: '.',
	testMatch: '*.spec.ts',
	forbidOnly: !!process.env.CI,
	workers: 1,
	reporter: 'list',
	timeout: 120_000,
	use: { screenshot: 'only-on-failure', trace: 'retain-on-failure' }
});
