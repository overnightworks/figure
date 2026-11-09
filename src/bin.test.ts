import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGlb } from '../tests/glbBuilder.js';

const binPath = join(import.meta.dirname, '..', 'dist', 'bin.js');

describe('the figure command from the build output', () => {
	let directory: string;

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), 'figure-bin-'));
	});
	afterEach(() => rmSync(directory, { recursive: true, force: true }));

	function figure(...args: string[]) {
		return spawnSync(process.execPath, [binPath, ...args], { encoding: 'utf8' });
	}

	it('exits 0 on a synthetic GLB', () => {
		const path = join(directory, 'ok.glb');
		writeFileSync(path, buildGlb());
		expect(figure('check', path).status).toBe(0);
	});

	it('exits 1 with the code not_glb on a file that is not GLB', () => {
		const path = join(directory, 'bad.glb');
		writeFileSync(path, 'plain text');
		const result = figure('check', path);
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(/^not_glb\b/);
	});

	it('exits 2 when it cannot read the file', () => {
		const result = figure('check', join(directory, 'missing.glb'));
		expect(result.status).toBe(2);
		expect(result.stderr).not.toBe('');
	});
});

describe('the figure entry module', () => {
	let directory: string;

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), 'figure-entry-'));
		vi.resetModules();
	});
	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = undefined;
		rmSync(directory, { recursive: true, force: true });
	});

	it('writes a verdict to stdout and sets exit code 0 for a GLB', async () => {
		const path = join(directory, 'ok.glb');
		writeFileSync(path, buildGlb());
		vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'figure', 'check', path]);
		const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
		await import('./bin.js');
		expect(stdout).toHaveBeenCalledTimes(1);
		expect(process.exitCode).toBe(0);
	});

	it('writes the reason to stderr and sets exit code 2 when no file is named', async () => {
		vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'figure', 'check']);
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
		await import('./bin.js');
		expect(stderr).toHaveBeenCalledTimes(1);
		expect(process.exitCode).toBe(2);
	});
});
