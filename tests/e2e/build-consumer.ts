import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const consumerSource = join(dirname(fileURLToPath(import.meta.url)), 'consumer');
const repositoryRoot = resolve(consumerSource, '../../..');

/** Packs the working tree into `directory` as pnpm does for a release and returns the tarball's path. */
function packTarball(directory: string): string {
	execFileSync('pnpm', ['pack', '--pack-destination', directory], { cwd: repositoryRoot, stdio: 'pipe' });
	return join(directory, readdirSync(directory).find((name) => name.endsWith('.tgz'))!);
}

export interface BuiltConsumer {
	readonly bundleDirectory: string;
	remove(): void;
}

/** Installs the packed tarball into a temporary consumer and bundles the consumer for production. */
export async function buildConsumer(): Promise<BuiltConsumer> {
	const workDirectory = mkdtempSync(join(tmpdir(), 'figure-consumer-'));
	const packDirectory = join(workDirectory, 'pack');
	const consumerDirectory = join(workDirectory, 'consumer');
	mkdirSync(packDirectory);
	cpSync(consumerSource, consumerDirectory, { recursive: true });
	const tarball = packTarball(packDirectory);
	execFileSync('npm', ['install', '--no-audit', '--no-fund', tarball], {
		cwd: consumerDirectory,
		stdio: 'pipe'
	});
	const bundleDirectory = join(workDirectory, 'bundle');
	await build({
		root: consumerDirectory,
		configFile: false,
		logLevel: 'warn',
		build: { outDir: bundleDirectory, emptyOutDir: true }
	});
	return { bundleDirectory, remove: () => rmSync(workDirectory, { recursive: true, force: true }) };
}
