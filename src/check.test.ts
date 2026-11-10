import { describe, expect, it } from 'vitest';
import { checkFigure } from './check.js';
import { figureProfile } from './profile.js';
import { buildVrmGlb, vrmJson } from '../tests/figureFixtures.js';
import { buildGlb, buildHeaderOnlyGlb } from '../tests/glbBuilder.js';

function codesOf(bytes: Uint8Array): string[] {
	return checkFigure(bytes).map(({ code }) => code);
}

describe('checkFigure', () => {
	it('passes a synthetic GLB with a JSON chunk, a binary chunk and an allowed extension in use', () => {
		const bytes = buildVrmGlb({
			json: vrmJson((json) => (json.buffers = [{ byteLength: 4 }])),
			binary: new Uint8Array(4)
		});
		expect(checkFigure(bytes)).toEqual([]);
	});

	it.each(figureProfile.allowedExtensions)('passes the allowed extension %s used and required', (extension) => {
		const json = vrmJson((vrm) => {
			vrm.extensionsUsed.push(extension);
			vrm.extensionsRequired = [extension];
		});
		expect(checkFigure(buildGlb({ json }))).toEqual([]);
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
		expect(codesOf(buildGlb({ json }))).toEqual(['glb_json']);
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
		const refusals = checkFigure(buildGlb({ json: vrmJson((vrm) => (vrm.extensionsUsed = [extension])) }));
		expect(refusals.map(({ code }) => code)).toEqual(['extension_not_allowed']);
		expect(refusals[0]?.detail).toContain(extension);
	});

	it('refuses an extension named only in extensionsRequired', () => {
		expect(codesOf(buildGlb({ json: vrmJson((vrm) => (vrm.extensionsRequired = ['KHR_materials_clearcoat'])) }))).toEqual([
			'extension_not_allowed'
		]);
	});

	it('names each disallowed extension once per place and leaves the allowed ones out', () => {
		const json = vrmJson((vrm) => {
			vrm.extensionsUsed.push('A_one', 'B_two');
			vrm.extensionsRequired = ['A_one'];
		});
		const details = checkFigure(buildGlb({ json })).map(({ detail }) => detail ?? '');
		expect(details).toHaveLength(3);
		expect(details.join(' ')).not.toContain('VRMC_vrm');
	});

	it.each([
		['a string instead of a list', 'A_one'],
		['a list with a number', [7]]
	])('refuses extensionsUsed as %s', (_name, extensionsUsed) => {
		expect(codesOf(buildGlb({ json: vrmJson((vrm) => (vrm.extensionsUsed = extensionsUsed)) }))).toEqual(['extension_not_allowed']);
	});

	it.each([
		['a buffer with an external URI', { buffers: [{ byteLength: 1, uri: 'model.bin' }] }],
		['a buffer with a data URI', { buffers: [{ byteLength: 1, uri: 'data:application/octet-stream;base64,AA==' }] }],
		['an image with an external URI', { images: [{ uri: 'face.png' }] }],
		['an image with a data URI', { images: [{ uri: 'data:image/png;base64,AA==' }] }]
	])('refuses %s as uri_not_allowed and names its place', (_name, json) => {
		const refusals = checkFigure(buildGlb({ json: { ...vrmJson(), ...json } }));
		expect(refusals.map(({ code }) => code)).toEqual(['uri_not_allowed']);
		expect(refusals[0]?.detail).toMatch(/^(buffers|images)\[0\]/);
	});

	it('passes buffers and images that name no URI, and ignores entries that are not objects', () => {
		const json = { buffers: [{ byteLength: 1 }, 5, null], images: [{ bufferView: 0 }], nodes: [{ uri: 'x' }] };
		expect(checkFigure(buildGlb({ json: { ...vrmJson(), ...json } }))).toEqual([]);
	});

	it('ignores buffers and images that are not lists', () => {
		expect(checkFigure(buildGlb({ json: { ...vrmJson(), buffers: { uri: 'a' }, images: 3 } }))).toEqual([]);
	});

	it('reports an extension and a URI together', () => {
		const json = { extensionsUsed: ['A_one'], images: [{ uri: 'face.png' }] };
		expect(codesOf(buildGlb({ json: { ...vrmJson(), ...json } }))).toEqual(['extension_not_allowed', 'uri_not_allowed']);
	});

	it('refuses a file one byte over the budget as too_large alone, and passes one at the budget', () => {
		const overhead = buildVrmGlb({ binary: new Uint8Array(4) }).length - 4;
		const atBudget = buildVrmGlb({ binary: new Uint8Array(figureProfile.fileBudgetBytes - overhead) });
		expect(atBudget).toHaveLength(figureProfile.fileBudgetBytes);
		expect(checkFigure(atBudget)).toEqual([]);
		const overBudget = buildVrmGlb({ binary: new Uint8Array(figureProfile.fileBudgetBytes - overhead + 1) });
		expect(codesOf(overBudget)).toEqual(['too_large']);
	});

	it('reports too_large beside not_glb for a large file that is not GLB', () => {
		expect(codesOf(new Uint8Array(figureProfile.fileBudgetBytes + 1))).toEqual(['too_large', 'not_glb']);
	});
});
