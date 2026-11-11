import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { scriptPolicy } from '../e2e/serve-consumer.js';

/** The stage builds into `dist/` beside its page, which the package's `files` never packs; the preview serves that build on localhost only. */
export default defineConfig({
	root: fileURLToPath(new URL('.', import.meta.url)),
	build: { outDir: fileURLToPath(new URL('./dist', import.meta.url)), emptyOutDir: true },
	preview: {
		host: '127.0.0.1',
		port: 4173,
		strictPort: true,
		headers: { 'Content-Security-Policy': scriptPolicy }
	}
});
