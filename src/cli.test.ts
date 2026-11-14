import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommand } from './cli.js';
import { figureProfile } from './profile.js';
import { buildClipGlb } from '../tests/clipFixtures.js';
import { buildVrmGlb, vrmJson } from '../tests/figureFixtures.js';

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

	it('exits 0 and says so on stdout for a conformant VRM', () => {
		expect(runCommand(['check', writeFigure('ok.vrm', buildVrmGlb())], output)).toBe(0);
		expect(stdout).toHaveLength(1);
		expect(stderr).toEqual([]);
	});

	it('exits 1 with one line starting with the code for a file that is not GLB', () => {
		const path = writeFigure('bad.glb', new TextEncoder().encode('not a model, just text'));
		expect(runCommand(['check', path], output)).toBe(1);
		expect(stdout).toHaveLength(1);
		expect(stdout[0]).toMatch(/^not_glb\b/);
	});

	it('exits 1 with the code and the preset it names for a VRM that lacks a preset', () => {
		const [preset] = figureProfile.presets;
		const bytes = buildVrmGlb({ json: vrmJson((json) => delete json.extensions.VRMC_vrm.expressions.preset[preset as string]) });
		expect(runCommand(['check', writeFigure('no-preset.vrm', bytes)], output)).toBe(1);
		expect(stdout).toEqual([expect.stringMatching(new RegExp(`^preset_missing\\b.*${preset}`))]);
	});

	it('prints the text a refusal carries after its code', () => {
		const path = writeFigure('uri.glb', buildVrmGlb({ json: vrmJson((json) => (json.images = [{ uri: 'face.png' }])) }));
		expect(runCommand(['check', path], output)).toBe(1);
		expect(stdout).toHaveLength(1);
		expect(stdout[0]).toMatch(/^uri_not_allowed\b.*images\[0\]/);
	});

	it('prints one line per refusal', () => {
		const path = writeFigure('two.glb', buildVrmGlb({ version: 1, declaredLength: 0 }));
		expect(runCommand(['check', path], output)).toBe(1);
		expect(stdout.map((line) => line.split(':')[0])).toEqual(['glb_version', 'glb_length']);
	});

	it('exits 2 with the reason on stderr when the file cannot be read', () => {
		expect(runCommand(['check', join(directory, 'missing.glb')], output)).toBe(2);
		expect(stdout).toEqual([]);
		expect(stderr).toHaveLength(1);
	});

	it('exits 0 and says so on stdout for a conformant clip under --as clip', () => {
		expect(runCommand(['check', '--as', 'clip', writeFigure('ok.vrma', buildClipGlb())], output)).toBe(0);
		expect(stdout).toHaveLength(1);
		expect(stderr).toEqual([]);
	});

	it('exits 1 with the clip code and the text it found for a clip that breaks a clip rule', () => {
		const path = writeFigure('mesh.vrma', buildClipGlb({ change: (json) => (json.meshes = []) }));
		expect(runCommand(['check', '--as', 'clip', path], output)).toBe(1);
		expect(stdout).toEqual([expect.stringMatching(/^clip_content_not_allowed\b.*meshes/)]);
	});

	it('judges a figure as a clip under --as clip, and a clip as a figure without it', () => {
		expect(runCommand(['check', '--as', 'clip', writeFigure('figure.vrm', buildVrmGlb())], output)).toBe(1);
		expect(stdout.map((line) => line.split(':')[0])).toContain('not_vrm_animation');
		stdout = [];
		expect(runCommand(['check', writeFigure('clip.vrma', buildClipGlb())], output)).toBe(1);
		expect(stdout.map((line) => line.split(':')[0])).toContain('not_vrm');
	});

	it.each([
		['no command', []],
		['an unknown command', ['draw', 'a.glb']],
		['no file', ['check']],
		['more than one file', ['check', 'a.glb', 'b.glb']],
		['--as without a value', ['check', '--as']],
		['--as without a file', ['check', '--as', 'clip']],
		['--as with a value that is not clip', ['check', '--as', 'room', 'a.glb']],
		['--as after the file', ['check', 'a.glb', '--as', 'clip']],
		['more than one file under --as clip', ['check', '--as', 'clip', 'a.vrma', 'b.vrma']]
	])('exits 2 for %s', (_name, argv) => {
		expect(runCommand(argv, output)).toBe(2);
		expect(stdout).toEqual([]);
		expect(stderr).toHaveLength(1);
		expect(stderr[0]).toContain('usage: figure check [--as clip] <file>');
	});
});
