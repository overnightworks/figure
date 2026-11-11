// Prints the gzip size of a production bundle of a consumer that only checks (`checkFigure` from the package root) and of one that
// also mounts (`mount` from `overnightworks-figure/draw`), both built with Vite from a packed figure tarball installed into a
// temporary directory that the script removes. A size is the sum of the gzip sizes (level 9) of the bundle's JavaScript files.
// Usage: node scripts/measure_bundle_size.mjs <tarball>; run it from the repository after `pnpm install`; the tarball is installed without install scripts,
// and that install reads the registry for three and @pixiv/three-vrm. The release build calls it and puts both lines into the release notes.
// Exit codes: 0 with the two lines on stdout, 2 for a missing tarball argument, non-zero for a failed install or build.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const bundles = [
	{
		label: 'check only',
		source: `import { checkFigure } from 'overnightworks-figure';
console.log(checkFigure(new Uint8Array(0)));
`
	},
	{
		label: 'check and mount',
		source: `import { checkFigure } from 'overnightworks-figure';
import { mount } from 'overnightworks-figure/draw';
console.log(checkFigure(new Uint8Array(0)));
mount(document.createElement('canvas'), new Uint8Array(0));
`
	}
];

function javascriptFilesIn(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return javascriptFilesIn(path);
		return entry.name.endsWith('.js') ? [path] : [];
	});
}

async function gzipBytesOfBundle(consumerDirectory, entryName, source, outDir) {
	const entry = join(consumerDirectory, `${entryName}.js`);
	writeFileSync(entry, source);
	await build({
		root: consumerDirectory,
		configFile: false,
		logLevel: 'error',
		build: { outDir, emptyOutDir: true, rollupOptions: { input: entry } }
	});
	return javascriptFilesIn(outDir).reduce((total, file) => total + gzipSync(readFileSync(file), { level: 9 }).length, 0);
}

async function main() {
	const [tarballArgument] = process.argv.slice(2);
	if (process.argv.length !== 3 || !existsSync(tarballArgument)) {
		console.error('usage: node scripts/measure_bundle_size.mjs <tarball>');
		return 2;
	}
	const workDirectory = mkdtempSync(join(tmpdir(), 'figure-bundle-size-'));
	try {
		const consumerDirectory = join(workDirectory, 'consumer');
		mkdirSync(consumerDirectory);
		writeFileSync(join(consumerDirectory, 'package.json'), '{"private":true,"type":"module"}');
		execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', resolve(tarballArgument)], { cwd: consumerDirectory, stdio: ['ignore', 'ignore', 'inherit'] });
		for (const { label, source } of bundles) {
			const bytes = await gzipBytesOfBundle(consumerDirectory, label.replaceAll(' ', '-'), source, join(workDirectory, label.replaceAll(' ', '-')));
			console.log(`${label}: ${bytes} bytes gzip`);
		}
		return 0;
	} finally {
		rmSync(workDirectory, { recursive: true, force: true });
	}
}

process.exitCode = await main();
