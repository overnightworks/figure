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

/** The environment variable through which `scripts/run_consumer_check.sh` hands the specs a consumer it built before the drive. */
export const builtConsumerVariable = 'FIGURE_CONSUMER_BUNDLE';

/** The consumer the script built, or a fresh one when the specs run directly (as CI's `pnpm run test:consumer` does); the caller of a handed-over bundle removes it. */
export async function useConsumer(): Promise<BuiltConsumer> {
	const handedOver = process.env[builtConsumerVariable];
	return handedOver === undefined ? buildConsumer() : { bundleDirectory: handedOver, remove: () => undefined };
}

/** Installs the packed tarball into a temporary consumer and bundles the consumer for production. */
export async function buildConsumer(): Promise<BuiltConsumer> {
	const workDirectory = mkdtempSync(join(tmpdir(), 'figure-consumer-'));
	const packDirectory = join(workDirectory, 'pack');
	const consumerDirectory = join(workDirectory, 'consumer');
	const bundleDirectory = join(workDirectory, 'bundle');
	try {
		mkdirSync(packDirectory);
		cpSync(consumerSource, consumerDirectory, { recursive: true });
		const tarball = packTarball(packDirectory);
		execFileSync('npm', ['install', '--no-audit', '--no-fund', tarball], {
			cwd: consumerDirectory,
			stdio: 'pipe'
		});
		await build({
			root: consumerDirectory,
			configFile: false,
			logLevel: 'warn',
			build: { outDir: bundleDirectory, emptyOutDir: true }
		});
	} catch (failure) {
		rmSync(workDirectory, { recursive: true, force: true });
		throw failure;
	}
	return { bundleDirectory, remove: () => rmSync(workDirectory, { recursive: true, force: true }) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.stdout.write(`${(await buildConsumer()).bundleDirectory}\n`);
}
