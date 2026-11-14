import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommand } from './cli.js';
import { clipProfile, figureProfile } from './profile.js';
import { conformantTrack, type ClipTrack } from '../tests/clipBuilder.js';
import { buildClipGlb, buildClipGlbOfSize, expressionNode, lookAtNode, retarget } from '../tests/clipFixtures.js';
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

	function codesPrinted(): string[] {
		return stdout.map((line) => line.split(':')[0] as string);
	}

	const track = (change: Partial<ClipTrack>): ClipTrack => ({ ...conformantTrack(), ...change });
	const zeroRotation = [0, 0, 0, 0] as const;

	it.each([
		['a STEP track', buildClipGlb({ animations: [[track({ interpolation: 'STEP' })]] })],
		[
			'a CUBICSPLINE track',
			buildClipGlb({
				animations: [[track({ interpolation: 'CUBICSPLINE', rotations: conformantTrack().rotations.flatMap((value) => [zeroRotation, value, zeroRotation]) })]]
			})
		],
		['several animations', buildClipGlb({ animations: [[conformantTrack()], [conformantTrack()]] })],
		['a first animation whose last key is at the length budget', buildClipGlb({ animations: [[track({ times: [0, 1, clipProfile.maxSeconds] })]] })],
		['a file at the byte budget', buildClipGlbOfSize(clipProfile.fileBudgetBytes)]
	])('exits 0 for a clip with %s under --as clip', (_name, bytes) => {
		expect(runCommand(['check', '--as', 'clip', writeFigure('ok.vrma', bytes)], output)).toBe(0);
		expect(stdout).toHaveLength(1);
		expect(stderr).toEqual([]);
	});

	it.each<[string, Uint8Array, string[]]>([
		['a file that is not a GLB', new TextEncoder().encode('not a clip'), ['not_glb']],
		['a file over the byte budget', buildClipGlbOfSize(clipProfile.fileBudgetBytes + 1), ['too_large']],
		['a GLB version other than 2', buildClipGlb({ glb: { version: 1 } }), ['glb_version']],
		['a header length that is not the file’s', buildClipGlb({ glb: { declaredLength: 20 } }), ['glb_length']],
		['a chunk that reaches past the end', buildClipGlb({ glb: { jsonChunkLengthField: 0xffffffff } }), ['glb_chunk']],
		['a JSON chunk that is not an object', buildClipGlb({ glb: { json: [] } }), ['glb_json']],
		['an extension the clip profile does not allow', buildClipGlb({ change: (json) => (json.extensionsRequired = ['KHR_draco_mesh_compression']) }), ['extension_not_allowed']],
		['a buffer that names a URI', buildClipGlb({ change: (json) => (json.buffers[0].uri = 'clip.bin') }), ['uri_not_allowed']],
		['a second buffer', buildClipGlb({ change: (json) => json.buffers.push({ byteLength: 1 }) }), ['buffer_outside_glb']],
		['a missing required bone', buildClipGlb({ change: (json) => delete json.extensions.VRMC_vrm_animation.humanoid.humanBones.hips }), ['humanoid_bone_missing']],
		['a part of the JSON that is no glTF shape', buildClipGlb({ change: (json) => (json.animations[0].samplers[0].input = 99) }), ['gltf_invalid']],
		['no VRMC_vrm_animation', buildClipGlb({ change: (json) => delete json.extensions.VRMC_vrm_animation }), ['not_vrm_animation']],
		['meshes', buildClipGlb({ change: (json) => (json.meshes = []) }), ['clip_content_not_allowed']],
		['no scene', buildClipGlb({ change: (json) => delete json.scenes }), ['clip_scene_missing']],
		['no animation', buildClipGlb({ change: (json) => delete json.animations }), ['clip_animation_missing']],
		['a rotation channel on an expression node', buildClipGlb({ change: (json) => retarget(json, expressionNode(json), 'rotation') }), ['clip_track_not_allowed']],
		['a translation channel on the look-at node', buildClipGlb({ change: (json) => retarget(json, lookAtNode(json), 'translation') }), ['clip_track_not_allowed']],
		['times that descend', buildClipGlb({ animations: [[track({ times: [0, 2, 1] })]] }), ['clip_keys_invalid']],
		['a first animation past the length budget', buildClipGlb({ animations: [[track({ times: [0, 1, clipProfile.maxSeconds + 1] })]] }), ['clip_too_long']]
	])('exits 1 with the code on its line for a clip with %s under --as clip', (_name, bytes, codes) => {
		expect(runCommand(['check', '--as', 'clip', writeFigure('bad.vrma', bytes)], output)).toBe(1);
		expect(codesPrinted()).toEqual(codes);
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
