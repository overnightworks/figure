import { describe, expect, it } from 'vitest';
import { checkClip, checkFigure } from './check.js';
import { clipProfile, figureProfile } from './profile.js';
import { buildVrmGlb, vrmJson, vrmParts } from '../tests/figureFixtures.js';
import { buildClipGlb, buildClipGlbOfSize, type ClipJson } from '../tests/clipFixtures.js';
import { buildGlb, buildHeaderOnlyGlb } from '../tests/glbBuilder.js';

function codesOf(bytes: Uint8Array): string[] {
	return checkFigure(bytes).map(({ code }) => code);
}

describe('checkFigure', () => {
	it('passes a synthetic GLB with a JSON chunk, a binary chunk and an allowed extension in use', () => {
		expect(checkFigure(buildVrmGlb())).toEqual([]);
	});

	it.each(figureProfile.allowedExtensions)('passes the allowed extension %s used and required', (extension) => {
		const json = vrmJson((vrm) => {
			vrm.extensionsUsed.push(extension);
			vrm.extensionsRequired = [extension];
		});
		expect(checkFigure(buildVrmGlb({ json }))).toEqual([]);
	});

	it.each([
		['an empty file', new Uint8Array()],
		['a file one byte short of the header', buildVrmGlb().subarray(0, 11)],
		['a text file', new TextEncoder().encode('this is not a model at all')],
		['a header with the wrong magic', Uint8Array.from(buildVrmGlb(), (byte, index) => (index === 3 ? 0x00 : byte))],
		['a short file with the right magic', buildVrmGlb().subarray(0, 4)]
	])('refuses %s as not_glb alone', (_name, bytes) => {
		expect(codesOf(bytes)).toEqual(['not_glb']);
	});

	it('refuses a version other than 2 as glb_version', () => {
		expect(codesOf(buildVrmGlb({ version: 1 }))).toEqual(['glb_version']);
	});

	it.each([
		['longer than the file', 1_000_000],
		['shorter than the file', 20]
	])('refuses a header length %s as glb_length', (_name, declaredLength) => {
		expect(codesOf(buildVrmGlb({ declaredLength }))).toEqual(['glb_length']);
	});

	it('reports a wrong version and a wrong length together', () => {
		expect(codesOf(buildVrmGlb({ version: 3, declaredLength: 0 }))).toEqual(['glb_version', 'glb_length']);
	});

	it.each([
		['a JSON chunk longer than the file', buildVrmGlb({ jsonChunkLengthField: 0xffffffff })],
		['a binary chunk longer than the file', buildVrmGlb({ binary: new Uint8Array(4), binaryChunkLengthField: 4096 })],
		['a chunk header cut short', buildVrmGlb({ trailing: new Uint8Array(7) })],
		['a first chunk that is not the JSON chunk', buildVrmGlb({ firstChunkType: 0x004e4942 })],
		['no chunk at all', buildHeaderOnlyGlb()]
	])('refuses %s as glb_chunk alone', (_name, bytes) => {
		expect(codesOf(bytes)).toEqual(['glb_chunk']);
	});

	it('does not judge extensions or URIs of a file whose chunk is out of bounds', () => {
		const json = { extensionsUsed: ['KHR_draco_mesh_compression'], buffers: [{ uri: 'a.bin' }] };
		expect(codesOf(buildGlb({ json, binary: new Uint8Array(4), binaryChunkLengthField: 4096 }))).toEqual([
			'glb_chunk'
		]);
	});

	it.each([
		['text that is not JSON', new TextEncoder().encode('{"asset": ')],
		['bytes that are not UTF-8', Uint8Array.of(0x7b, 0xff, 0xfe, 0x7d)],
		['nesting too deep to parse', new TextEncoder().encode('['.repeat(2_000_000) + ']'.repeat(2_000_000))]
	])('refuses a JSON chunk of %s as glb_json', (_name, jsonBytes) => {
		expect(codesOf(buildGlb({ jsonBytes }))).toEqual(['glb_json']);
	});

	it.each([
		['an array', []],
		['a number', 7],
		['null', null],
		['a string', 'asset']
	])('refuses a JSON chunk that is %s as glb_json', (_name, json) => {
		expect(codesOf(buildVrmGlb({ json }))).toEqual(['glb_json']);
	});

	it('does not judge extensions or URIs of a file whose JSON is unreadable', () => {
		expect(codesOf(buildGlb({ json: [{ extensionsUsed: ['x'] }] }))).toEqual(['glb_json']);
	});

	it.each([
		'KHR_draco_mesh_compression',
		'EXT_meshopt_compression',
		'KHR_texture_basisu',
		'KHR_techniques_webgl'
	])('refuses the profile-refused extension %s in extensionsUsed', (extension) => {
		const refusals = checkFigure(buildVrmGlb({ json: vrmJson((vrm) => (vrm.extensionsUsed = [extension])) }));
		expect(refusals.map(({ code }) => code)).toEqual(['extension_not_allowed']);
		expect(refusals[0]?.detail).toContain(extension);
	});

	it('refuses an extension named only in extensionsRequired', () => {
		expect(codesOf(buildVrmGlb({ json: vrmJson((vrm) => (vrm.extensionsRequired = ['KHR_materials_clearcoat'])) }))).toEqual([
			'extension_not_allowed'
		]);
	});

	it('names each disallowed extension once per place and leaves the allowed ones out', () => {
		const json = vrmJson((vrm) => {
			vrm.extensionsUsed.push('A_one', 'B_two');
			vrm.extensionsRequired = ['A_one'];
		});
		const details = checkFigure(buildVrmGlb({ json })).map(({ detail }) => detail ?? '');
		expect(details).toHaveLength(3);
		expect(details.join(' ')).not.toContain('VRMC_vrm');
	});

	it.each([
		['a string instead of a list', 'A_one'],
		['a list with a number', [7]]
	])('refuses extensionsUsed as %s', (_name, extensionsUsed) => {
		expect(codesOf(buildVrmGlb({ json: vrmJson((vrm) => (vrm.extensionsUsed = extensionsUsed)) }))).toEqual(['extension_not_allowed']);
	});

	it.each([
		['a buffer with an external URI', { buffers: [{ byteLength: 1, uri: 'model.bin' }] }],
		['a buffer with a data URI', { buffers: [{ byteLength: 1, uri: 'data:application/octet-stream;base64,AA==' }] }],
		['an image with an external URI', { images: [{ uri: 'face.png' }] }],
		['an image with a data URI', { images: [{ uri: 'data:image/png;base64,AA==' }] }]
	])('refuses %s as uri_not_allowed and names its place', (_name, json) => {
		const refusals = checkFigure(buildVrmGlb({ json: { ...vrmJson(), ...json } }));
		expect(refusals.map(({ code }) => code)).toEqual(['uri_not_allowed']);
		expect(refusals[0]?.detail).toMatch(/^(buffers|images)\[0\]/);
	});

	it('passes a buffer that names no URI, and ignores a buffer entry that is not an object', () => {
		const json = vrmJson((vrm) => {
			vrm.buffers = [5];
			vrm.nodes.push({ uri: 'x' });
		});
		expect(checkFigure(buildVrmGlb({ json }))).toEqual([]);
	});

	it.each([
		['a second buffer that names no URI', (json: Record<string, any>) => json.buffers.push({ byteLength: 1 })],
		['a buffer view in buffer 1', (json: Record<string, any>) => (json.bufferViews.at(-1).buffer = 1)]
	])('refuses %s as buffer_outside_glb', (_name, change) => {
		const refusals = checkFigure(buildVrmGlb({ json: vrmJson(change) }));
		expect(refusals.map(({ code }) => code)).toEqual(['buffer_outside_glb']);
		expect(refusals[0]?.detail).toMatch(/^(buffers|bufferViews\[\d+\])/);
	});

	it('ignores bufferViews that are not a list', () => {
		expect(codesOf(buildVrmGlb({ json: vrmJson((json) => (json.bufferViews = { buffer: 1 })) }))).not.toContain('buffer_outside_glb');
	});

	it('ignores buffers that are not a list', () => {
		expect(checkFigure(buildVrmGlb({ json: { ...vrmJson(), buffers: { uri: 'a' } } }))).toEqual([]);
	});

	it('reports an extension and a URI together', () => {
		const json = { extensionsUsed: ['A_one'], images: [{ uri: 'face.png' }] };
		expect(codesOf(buildVrmGlb({ json: { ...vrmJson(), ...json } }))).toEqual(['extension_not_allowed', 'uri_not_allowed']);
	});

	it('refuses a file one byte over the budget as too_large alone, and passes one at the budget', () => {
		const { json, binary } = vrmParts();
		const withFileSize = (size: number) => {
			const padded = new Uint8Array(size - buildGlb({ json, binary }).length + binary.length);
			padded.set(binary);
			return buildGlb({ json, binary: padded });
		};
		const atBudget = withFileSize(figureProfile.fileBudgetBytes);
		expect(atBudget).toHaveLength(figureProfile.fileBudgetBytes);
		expect(checkFigure(atBudget)).toEqual([]);
		const overBudget = withFileSize(figureProfile.fileBudgetBytes + 1);
		expect(codesOf(overBudget)).toEqual(['too_large']);
	});

	it('reports too_large beside not_glb for a large file that is not GLB', () => {
		expect(codesOf(new Uint8Array(figureProfile.fileBudgetBytes + 1))).toEqual(['too_large', 'not_glb']);
	});
});

describe('checkClip', () => {
	const clipCodesOf = (bytes: Uint8Array) => checkClip(bytes).map(({ code }) => code);

	it('passes the conformant clip', () => {
		expect(checkClip(buildClipGlb())).toEqual([]);
	});

	it.each([
		['a text file', new TextEncoder().encode('this is not a clip'), ['not_glb']],
		['a version other than 2', buildClipGlb({ glb: { version: 1 } }), ['glb_version']],
		['a header length that is not the file’s', buildClipGlb({ glb: { declaredLength: 20 } }), ['glb_length']],
		['a chunk that reaches past the end', buildClipGlb({ glb: { jsonChunkLengthField: 0xffffffff } }), ['glb_chunk']],
		['a JSON chunk that is not a JSON object', buildClipGlb({ glb: { json: [] } }), ['glb_json']]
	])('refuses %s with the container code', (_name, bytes, codes) => {
		expect(clipCodesOf(bytes)).toEqual(codes);
	});

	it('refuses an extension the clip profile does not allow, and one only the figure profile allows', () => {
		for (const extension of ['KHR_draco_mesh_compression', ...figureProfile.allowedExtensions]) {
			const change = (clip: ClipJson) => (clip.extensionsRequired = [extension]);
			expect(clipCodesOf(buildClipGlb({ change }))).toEqual(['extension_not_allowed']);
		}
	});

	it('passes the extension the clip profile allows, used and required', () => {
		const change = (clip: ClipJson) => (clip.extensionsRequired = [...clipProfile.allowedExtensions]);
		expect(clipCodesOf(buildClipGlb({ change }))).toEqual([]);
	});

	it('refuses a buffer that names a URI as uri_not_allowed', () => {
		const change = (clip: ClipJson) => (clip.buffers[0].uri = 'clip.bin');
		expect(clipCodesOf(buildClipGlb({ change }))).toEqual(['uri_not_allowed']);
	});

	it('refuses a second buffer as buffer_outside_glb', () => {
		const change = (clip: ClipJson) => clip.buffers.push({ byteLength: 1 });
		expect(clipCodesOf(buildClipGlb({ change }))).toEqual(['buffer_outside_glb']);
	});

	it('refuses a file one byte over the clip budget as too_large alone, and passes one at the budget', () => {
		const atBudget = buildClipGlbOfSize(clipProfile.fileBudgetBytes);
		expect(atBudget).toHaveLength(clipProfile.fileBudgetBytes);
		expect(checkClip(atBudget)).toEqual([]);
		expect(clipCodesOf(buildClipGlbOfSize(clipProfile.fileBudgetBytes + 1))).toEqual(['too_large']);
	});

	it('refuses a figure as not_vrm_animation, and a clip is not a figure', () => {
		expect(clipCodesOf(buildVrmGlb())).toContain('not_vrm_animation');
		expect(codesOf(buildClipGlb())).toContain('not_vrm');
	});
});
