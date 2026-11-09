import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/cli.js';
import { buildGlb } from './glb-builder.js';

describe('runCommand', () => {
	let directory: string;
	let stdout: string[];
	let stderr: string[];
	const output = { stdout: (line: string) => stdout.push(line), stderr: (line: string) => stderr.push(line) };

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), 'figure-cli-'));
		stdout = [];
		stderr = [];
	});
	afterEach(() => rmSync(directory, { recursive: true, force: true }));

	function writeFigure(name: string, bytes: Uint8Array): string {
		const path = join(directory, name);
		writeFileSync(path, bytes);
		return path;
	}

	it('exits 0 and says so on stdout for a GLB', () => {
		expect(runCommand(['check', writeFigure('ok.glb', buildGlb())], output)).toBe(0);
		expect(stdout).toHaveLength(1);
		expect(stderr).toEqual([]);
	});

	it('exits 1 with one line starting with the code for a file that is not GLB', () => {
		const path = writeFigure('bad.glb', new TextEncoder().encode('not a model, just text'));
		expect(runCommand(['check', path], output)).toBe(1);
		expect(stdout).toHaveLength(1);
		expect(stdout[0]).toMatch(/^not_glb\b/);
	});

	it('exits 2 with the reason on stderr when the file cannot be read', () => {
		expect(runCommand(['check', join(directory, 'missing.glb')], output)).toBe(2);
		expect(stdout).toEqual([]);
		expect(stderr).toHaveLength(1);
	});

	it.each([
		['no command', []],
		['an unknown command', ['draw', 'a.glb']],
		['no file', ['check']],
		['more than one file', ['check', 'a.glb', 'b.glb']]
	])('exits 2 for %s', (_name, argv) => {
		expect(runCommand(argv, output)).toBe(2);
		expect(stdout).toEqual([]);
		expect(stderr).toHaveLength(1);
	});
});
