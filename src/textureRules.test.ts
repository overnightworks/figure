import { describe, expect, it } from 'vitest';
import { checkFigure } from './check.js';
import { figureProfile } from './profile.js';
import { buildVrmGlb, buildVrmGlbWithImages, vrmJson } from '../tests/figureFixtures.js';
import { buildGlb, buildPng, embedImages } from '../tests/glbBuilder.js';

type Json = Record<string, any>;

const side = figureProfile.maxTextureSidePixels;
const texels = figureProfile.maxTexels;

function codesOf(bytes: Uint8Array): string[] {
	return checkFigure(bytes).map(({ code }) => code);
}

function pngCodes(...sizes: [number, number][]): string[] {
	return codesOf(buildVrmGlbWithImages(sizes.map(([width, height]) => buildPng(width, height))));
}

/** Sizes whose texels add up to exactly the budget, each within the side budget. */
function sizesAddingUpToBudget(): [number, number][] {
	const height = Math.floor(texels / (2 * side));
	return [[side, height], [side, height], [texels - 2 * side * height, 1]];
}

describe('the texture side budget', () => {
	it('passes a side of exactly the budget', () => {
		expect(pngCodes([side, 1], [1, side])).toEqual([]);
	});

	it.each([
		['width', (): [number, number] => [side + 1, 1]],
		['height', (): [number, number] => [1, side + 1]]
	])('refuses one pixel more in %s as texture_too_large, naming the image', (_name, size) => {
		const refusals = checkFigure(buildVrmGlbWithImages([buildPng(...size())]));
		expect(refusals.map(({ code }) => code)).toEqual(['texture_too_large']);
		expect(refusals[0]?.detail).toMatch(/^images\[0\]/);
	});

	it('states a huge size in the header without holding its pixels', () => {
		expect(pngCodes([0xffffffff, 0xffffffff])).toEqual(['texture_too_large', 'too_many_texels']);
	});
});

describe('the texel budget', () => {
	it('passes images that add up to exactly the budget', () => {
		expect(pngCodes(...sizesAddingUpToBudget())).toEqual([]);
	});

	it('refuses one image more as too_many_texels', () => {
		expect(pngCodes(...sizesAddingUpToBudget(), [1, 1])).toEqual(['too_many_texels']);
	});

	it('counts an image that two textures use once', () => {
		const bytes = buildVrmGlbWithImages([buildPng(side, side)], (json) => (json.textures = [{ source: 0 }, { source: 0 }]));
		expect(codesOf(bytes)).toEqual([]);
		expect(pngCodes([side, side], [side, side])).toEqual(['too_many_texels']);
	});

	it('adds nothing for an image it cannot size', () => {
		const unsized = buildPng(side, side).subarray(0, 10);
		const bytes = buildVrmGlbWithImages([...sizesAddingUpToBudget().map(([w, h]) => buildPng(w, h)), unsized]);
		expect(codesOf(bytes)).toEqual(['image_invalid']);
	});
});

describe('an image the check cannot find or size', () => {
	const png = buildPng(1, 1);
	const withBytes = (replace: (bytes: Uint8Array) => Uint8Array) => buildVrmGlbWithImages([replace(Uint8Array.from(png))]);

	it.each([
		['a header cut short', () => withBytes((bytes) => bytes.subarray(0, 20))],
		['an empty image', () => withBytes((bytes) => bytes.subarray(0, 0))],
		['a wrong signature', () => withBytes((bytes) => bytes.map((byte, index) => (index === 1 ? 0 : byte)))],
		['a first chunk that is not the header chunk', () => withBytes((bytes) => bytes.map((byte, index) => (index === 12 ? 0x4a : byte)))],
		['a header chunk of another length', () => withBytes((bytes) => bytes.map((byte, index) => (index === 11 ? 14 : byte)))],
		['a width of zero', () => buildVrmGlbWithImages([buildPng(0, 1)])],
		['a height of zero', () => buildVrmGlbWithImages([buildPng(1, 0)])],
		['bytes that start like a JPEG', () => buildVrmGlbWithImages([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(0)])])],
		['bytes that start like a WebP', () => buildVrmGlbWithImages([new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ' + 'x'.repeat(30))])],
		['no binary chunk', () => buildGlb({ json: vrmJson((json) => embedImages(json, [png])) })],
		[
			'a range that ends past the end of the chunk',
			() => buildVrmGlbWithImages([png], (json) => (json.bufferViews[0].byteLength = png.length + 1))
		],
		[
			'a range that starts past the end of the chunk',
			() => buildVrmGlbWithImages([png], (json) => (json.bufferViews[0].byteOffset = png.length))
		],
		[
			'an offset and a length too large to add up',
			() => buildVrmGlbWithImages([png], (json) => ((json.bufferViews[0].byteOffset = 2 ** 53), (json.bufferViews[0].byteLength = 2 ** 53)))
		]
	])('refuses %s as image_invalid alone', (_name, build) => {
		expect(codesOf(build())).toEqual(['image_invalid']);
	});

	it('names the image', () => {
		const refusals = checkFigure(buildVrmGlbWithImages([png, png.subarray(0, 4)]));
		expect(refusals[0]?.detail).toMatch(/^images\[1\]/);
	});

	it('does not read past the chunk even when the file goes on', () => {
		const json = vrmJson();
		const binary = embedImages(json, [png]);
		json.bufferViews[0].byteLength = png.length + 4;
		expect(codesOf(buildGlb({ json, binary, trailing: new Uint8Array(8) }))).toEqual(['image_invalid']);
	});
});

describe('a part of the JSON the texture rules cannot read', () => {
	const png = buildPng(1, 1);
	const broken = (change: (json: Json) => void) => codesOf(buildVrmGlbWithImages([png], change));

	it.each<[string, (json: Json) => void]>([
		['images that are not a list', (json) => (json.images = 3)],
		['an image that is not an object', (json) => (json.images = [null])],
		['an image without a buffer view', (json) => delete json.images[0].bufferView],
		['an image with a null buffer view', (json) => (json.images[0].bufferView = null)],
		['a buffer view index that is not an integer', (json) => (json.images[0].bufferView = 0.5)],
		['a negative buffer view index', (json) => (json.images[0].bufferView = -1)],
		['a buffer view that names nothing', (json) => (json.images[0].bufferView = 1)],
		['buffer views that are not a list', (json) => (json.bufferViews = {})],
		['no buffer views', (json) => delete json.bufferViews],
		['a buffer view that is not an object', (json) => (json.bufferViews = [7])],
		['a buffer other than 0', (json) => (json.bufferViews[0].buffer = 1)],
		['a buffer view without a buffer', (json) => delete json.bufferViews[0].buffer],
		['an offset that is not a number', (json) => (json.bufferViews[0].byteOffset = '0')],
		['a null offset', (json) => (json.bufferViews[0].byteOffset = null)],
		['a negative offset', (json) => (json.bufferViews[0].byteOffset = -1)],
		['a fractional length', (json) => (json.bufferViews[0].byteLength = 1.5)],
		['a missing length', (json) => delete json.bufferViews[0].byteLength]
	])('gives gltf_invalid for %s', (_name, change) => {
		expect(broken(change)).toEqual(['gltf_invalid']);
	});

	it('reads an absent offset as 0', () => {
		expect(broken((json) => delete json.bufferViews[0].byteOffset)).toEqual([]);
	});

	it('reads the other images when one cannot be read', () => {
		const bytes = buildVrmGlbWithImages([png, buildPng(side + 1, 1)], (json) => delete json.images[0].bufferView);
		expect(codesOf(bytes)).toEqual(['texture_too_large', 'gltf_invalid']);
	});

	it('leaves an image with a uri to uri_not_allowed alone', () => {
		const bytes = buildVrmGlb({ json: vrmJson((json) => (json.images = [{ uri: 'face.png', bufferView: 9 }])) });
		expect(codesOf(bytes)).toEqual(['uri_not_allowed']);
	});
});
