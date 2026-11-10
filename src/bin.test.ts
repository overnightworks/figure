import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { figureProfile } from './profile.js';
import { buildJpeg, buildPng } from '../tests/glbBuilder.js';
import { buildConformantVrm, buildVrmGlb, buildVrmGlbWithImages, vrmJson } from '../tests/figureFixtures.js';

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

	it('exits 0 on the conformant synthetic VRM', () => {
		const path = join(directory, 'ok.glb');
		writeFileSync(path, buildConformantVrm());
		expect(figure('check', path).status).toBe(0);
	});

	it('exits 0 on a synthetic VRM whose embedded texture is a JPEG', () => {
		const path = join(directory, 'jpeg.glb');
		writeFileSync(path, buildVrmGlbWithImages([buildJpeg(figureProfile.maxTextureSidePixels, 1)]));
		expect(figure('check', path).status).toBe(0);
	});

	it('exits 1 with texture_too_large on a synthetic VRM whose embedded image is over the side budget', () => {
		const path = join(directory, 'wide.glb');
		writeFileSync(path, buildVrmGlbWithImages([buildPng(figureProfile.maxTextureSidePixels + 1, 1)]));
		const result = figure('check', path);
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(/^texture_too_large\b.*images\[0\]/);
	});

	it('exits 1 with the code of the rule a synthetic VRM breaks', () => {
		const path = join(directory, 'no-look-at.vrm');
		writeFileSync(path, buildVrmGlb({ json: vrmJson((json) => delete json.extensions.VRMC_vrm.lookAt) }));
		const result = figure('check', path);
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(/^look_at_missing\b/);
	});

	it('exits 1 with the code of a required humanoid bone a synthetic VRM lacks', () => {
		const path = join(directory, 'no-bone.vrm');
		const [bone] = figureProfile.requiredHumanBones;
		writeFileSync(path, buildVrmGlb({ json: vrmJson((json) => delete json.extensions.VRMC_vrm.humanoid.humanBones[bone as string]) }));
		const result = figure('check', path);
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(/^humanoid_bone_missing\b/);
	});

	it('exits 1 with the code not_glb on a file that is not GLB', () => {
		const path = join(directory, 'bad.glb');
		writeFileSync(path, 'plain text');
		const result = figure('check', path);
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(/^not_glb\b/);
	});

	it('exits 1 with the code and the text it found on a file that names a URI', () => {
		const path = join(directory, 'uri.glb');
		writeFileSync(path, buildVrmGlb({ json: vrmJson((json) => (json.buffers = [{ uri: 'model.bin' }])) }));
		const result = figure('check', path);
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(/^uri_not_allowed\b.*buffers\[0\]/);
	});

	it('exits 2 when it cannot read the file', () => {
		const result = figure('check', join(directory, 'missing.glb'));
		expect(result.status).toBe(2);
		expect(result.stderr).not.toBe('');
	});
});
