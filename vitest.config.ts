import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['lcov', 'text-summary'],
			include: ['src/**'],
			thresholds: { branches: 100 }
		}
	}
});
