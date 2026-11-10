import { describe, expect, it } from 'vitest';
import { checkFigure } from './check.js';
import { figureProfile } from './profile.js';
import { vrmJson } from '../tests/figureFixtures.js';
import { buildGlb } from '../tests/glbBuilder.js';

type Json = Record<string, any>;

function codesOf(change: (json: Json) => void): string[] {
	return checkFigure(buildGlb({ json: vrmJson(change) })).map(({ code }) => code);
}

/** Replaces the conformant mesh with primitives whose vertex counts sit in accessor fields only. */
function withPrimitives(primitives: Json[], counts: number[]) {
	return (json: Json) => {
		json.meshes = [{ primitives }];
		json.accessors = counts.map((count) => ({ componentType: 5123, count, type: 'SCALAR' }));
	};
}

const budget = figureProfile.maxTriangles;
const verticesPerTriangleMode = [
	{ mode: 4, atBudget: 3 * budget, overBudget: 3 * budget + 3 },
	{ mode: 5, atBudget: budget + 2, overBudget: budget + 3 },
	{ mode: 6, atBudget: budget + 2, overBudget: budget + 3 }
];

describe('the triangle budget', () => {
	describe.each(verticesPerTriangleMode)('in mode $mode', ({ mode, atBudget, overBudget }) => {
		it.each([
			['an indexed primitive', (count: number) => withPrimitives([{ attributes: { POSITION: 1 }, indices: 0, mode }], [count, 1])],
			['a non-indexed primitive', (count: number) => withPrimitives([{ attributes: { POSITION: 0 }, mode }], [count])]
		])('passes exactly the budget and refuses one more for %s', (_name, build) => {
			expect(codesOf(build(atBudget))).toEqual([]);
			expect(codesOf(build(overBudget))).toEqual(['too_many_triangles']);
		});
	});

	it('takes mode 4 as the default', () => {
		const build = (count: number) => withPrimitives([{ attributes: { POSITION: 0 } }], [count]);
		expect(codesOf(build(3 * budget))).toEqual([]);
		expect(codesOf(build(3 * budget + 3))).toEqual(['too_many_triangles']);
	});

	it.each([0, 1, 2, 3])('counts no triangle for mode %s', (mode) => {
		expect(codesOf(withPrimitives([{ attributes: { POSITION: 0 }, mode }], [10 * budget]))).toEqual([]);
	});

	it('counts no triangle for a strip or a fan of fewer than three vertices', () => {
		expect(codesOf(withPrimitives([{ attributes: { POSITION: 0 }, mode: 5 }, { attributes: { POSITION: 1 }, mode: 6 }], [1, 0]))).toEqual([]);
	});

	it('reads the indices accessor before the POSITION accessor', () => {
		expect(codesOf(withPrimitives([{ attributes: { POSITION: 1 }, indices: 0 }], [3, 10 * budget]))).toEqual([]);
	});

	it('adds up every primitive of every mesh', () => {
		const half = (3 * budget) / 2;
		const change = (json: Json) => {
			json.meshes = [
				{ primitives: [{ attributes: { POSITION: 0 } }, { attributes: { POSITION: 0 } }] },
				{ primitives: [{ attributes: { POSITION: 1 } }] }
			];
			json.accessors = [{ count: half }, { count: 3 }];
		};
		expect(codesOf(change)).toEqual(['too_many_triangles']);
	});

	it('counts a mesh once however many nodes use it', () => {
		const change = (json: Json) => {
			withPrimitives([{ attributes: { POSITION: 0 } }], [3 * budget])(json);
			json.nodes = [{ mesh: 0 }, { mesh: 0 }, { mesh: 0 }];
		};
		expect(codesOf(change)).toEqual([]);
	});

	it('passes a file without meshes', () => {
		expect(codesOf((json) => delete json.meshes)).toEqual([]);
	});
});

describe('the morph-target budget', () => {
	const targets = (count: number) => new Array<object>(count).fill({});
	const primitiveWith = (count: number) => ({ attributes: { POSITION: 0 }, targets: targets(count) });

	it('passes exactly the budget and refuses one more', () => {
		const max = figureProfile.maxMorphTargetsPerPrimitive;
		expect(codesOf(withPrimitives([primitiveWith(max)], [3]))).toEqual([]);
		expect(codesOf(withPrimitives([primitiveWith(max + 1)], [3]))).toEqual(['too_many_morph_targets']);
	});

	it('judges each primitive alone and refuses each one over the budget', () => {
		const max = figureProfile.maxMorphTargetsPerPrimitive;
		expect(codesOf(withPrimitives([primitiveWith(max), primitiveWith(max)], [3]))).toEqual([]);
		expect(codesOf(withPrimitives([primitiveWith(max + 1), primitiveWith(max + 1)], [3]))).toEqual([
			'too_many_morph_targets',
			'too_many_morph_targets'
		]);
	});

	it('reports a morph-target and a triangle refusal together', () => {
		const max = figureProfile.maxMorphTargetsPerPrimitive;
		const primitive = { attributes: { POSITION: 0 }, targets: targets(max + 1) };
		expect(codesOf(withPrimitives([primitive], [3 * budget + 3]))).toEqual(['too_many_triangles', 'too_many_morph_targets']);
	});
});

describe('gltf_invalid', () => {
	const valid = { attributes: { POSITION: 0 } };
	it.each([
		['meshes that are not a list', (json: Json) => (json.meshes = {})],
		['a mesh that is not an object', (json: Json) => (json.meshes = [5])],
		['a mesh without primitives', (json: Json) => (json.meshes = [{}])],
		['primitives that are not a list', (json: Json) => (json.meshes = [{ primitives: 'x' }])],
		['a primitive that is not an object', (json: Json) => (json.meshes = [{ primitives: [null] }])],
		['accessors that are not a list', (json: Json) => (json.accessors = {})],
		['an accessor that is not an object', (json: Json) => (json.accessors = [7])],
		['an accessor without a count', (json: Json) => (json.accessors = [{}])],
		['a negative count', withPrimitives([valid], [-3])],
		['a fractional count', withPrimitives([valid], [1.5])],
		['a count that is a string', (json: Json) => (json.accessors = [{ count: '3' }])],
		['a mode that is a string', withPrimitives([{ ...valid, mode: '4' }], [3])],
		['a mode that is null', withPrimitives([{ ...valid, mode: null }], [3])],
		['an indices that is null', withPrimitives([{ ...valid, indices: null }], [3])],
		['a mode of 7', withPrimitives([{ ...valid, mode: 7 }], [3])],
		['a negative mode', withPrimitives([{ ...valid, mode: -1 }], [3])],
		['a fractional mode', withPrimitives([{ ...valid, mode: 4.5 }], [3])],
		['an indices index past the accessors', withPrimitives([{ ...valid, indices: 1 }], [3])],
		['a negative indices index', withPrimitives([{ ...valid, indices: -1 }], [3])],
		['a fractional indices index', withPrimitives([{ ...valid, indices: 0.5 }], [3])],
		['an indices index that is a string', withPrimitives([{ ...valid, indices: '0' }], [3])],
		['a POSITION index past the accessors', withPrimitives([{ attributes: { POSITION: 4 } }], [3])],
		['a primitive without indices and POSITION', withPrimitives([{ attributes: {} }], [3])],
		['a primitive without attributes', withPrimitives([{}], [3])],
		['attributes that are a list', withPrimitives([{ attributes: [] }], [3])],
		['targets that are not a list', withPrimitives([{ ...valid, targets: 5 }], [3])]
	])('refuses %s as gltf_invalid, never counting it as zero', (_name, change) => {
		expect(codesOf(change)).toEqual(['gltf_invalid']);
	});

	it('names the place that cannot be read', () => {
		const refusals = checkFigure(buildGlb({ json: vrmJson(withPrimitives([valid, { ...valid, mode: 9 }], [3])) }));
		expect(refusals[0]?.detail).toContain('meshes[0].primitives[1]');
	});

	it('does not read the accessors of a mode that counts no triangle', () => {
		expect(codesOf(withPrimitives([{ attributes: {}, mode: 1 }], []))).toEqual([]);
	});
});
