import { describe, expect, it } from 'vitest';
import { checkFigure } from './check.js';
import { figureProfile } from './profile.js';
import { buildVrmGlb, vrmJson } from '../tests/figureFixtures.js';
import { buildGlb } from '../tests/glbBuilder.js';

function refusalsOf(change: Parameters<typeof vrmJson>[0]) {
	return checkFigure(buildGlb({ json: vrmJson(change) }));
}

function codesOf(change: Parameters<typeof vrmJson>[0]): string[] {
	return refusalsOf(change).map(({ code }) => code);
}

describe('the VRM rules', () => {
	it('pass the conformant synthetic VRM with no refusal', () => {
		expect(checkFigure(buildVrmGlb())).toEqual([]);
	});

	it.each([
		['no extensions', (json: Record<string, any>) => delete json.extensions],
		['extensions that are not an object', (json: Record<string, any>) => (json.extensions = 'VRMC_vrm')],
		['no VRMC_vrm', (json: Record<string, any>) => delete json.extensions.VRMC_vrm],
		['a VRMC_vrm that is a string', (json: Record<string, any>) => (json.extensions.VRMC_vrm = 'vrm')],
		['a VRMC_vrm that is a list', (json: Record<string, any>) => (json.extensions.VRMC_vrm = [])],
		['a VRMC_vrm that is null', (json: Record<string, any>) => (json.extensions.VRMC_vrm = null)],
		['no specVersion', (json: Record<string, any>) => delete json.extensions.VRMC_vrm.specVersion],
		['specVersion 0.0', (json: Record<string, any>) => (json.extensions.VRMC_vrm.specVersion = '0.0')],
		['a numeric specVersion', (json: Record<string, any>) => (json.extensions.VRMC_vrm.specVersion = 1)]
	])('refuse a file with %s as not_vrm alone among the VRM rules', (_name, change) => {
		expect(codesOf(change)).toEqual(['not_vrm']);
	});

	it('still judge the budgets of a file that is not a VRM', () => {
		const codes = codesOf((json) => {
			delete json.extensions;
			json.meshes[0].primitives[0].targets = new Array(figureProfile.maxMorphTargetsPerPrimitive + 1).fill({});
		});
		expect(codes).toEqual(['not_vrm', 'too_many_morph_targets']);
	});

	it.each(figureProfile.presets)('refuses the preset %s removed alone as preset_missing naming it', (preset) => {
		const refusals = refusalsOf((json) => delete json.extensions.VRMC_vrm.expressions.preset[preset]);
		expect(refusals.map(({ code }) => code)).toEqual(['preset_missing']);
		expect(refusals[0]?.detail).toContain(preset);
	});

	it('refuses one preset_missing per missing preset', () => {
		const [first, second] = figureProfile.presets;
		const refusals = refusalsOf((json) => {
			delete json.extensions.VRMC_vrm.expressions.preset[first as string];
			delete json.extensions.VRMC_vrm.expressions.preset[second as string];
		});
		expect(refusals.map(({ detail }) => detail)).toEqual([expect.stringContaining(first as string), expect.stringContaining(second as string)]);
	});

	it.each([
		['no expressions', (json: Record<string, any>) => delete json.extensions.VRMC_vrm.expressions],
		['no preset list', (json: Record<string, any>) => (json.extensions.VRMC_vrm.expressions = {})],
		['expressions that are a string', (json: Record<string, any>) => (json.extensions.VRMC_vrm.expressions = 'x')],
		['a preset list that is null', (json: Record<string, any>) => (json.extensions.VRMC_vrm.expressions.preset = null)]
	])('refuses every preset of a file with %s', (_name, change) => {
		expect(codesOf(change)).toEqual(figureProfile.presets.map(() => 'preset_missing'));
	});

	it('does not count a preset that is not an expression object as present', () => {
		expect(codesOf((json) => (json.extensions.VRMC_vrm.expressions.preset.aa = null))).toEqual(['preset_missing']);
	});

	it.each([
		['absent', (json: Record<string, any>) => delete json.extensions.VRMC_vrm.lookAt],
		['null', (json: Record<string, any>) => (json.extensions.VRMC_vrm.lookAt = null)],
		['a string', (json: Record<string, any>) => (json.extensions.VRMC_vrm.lookAt = 'bone')],
		['a list', (json: Record<string, any>) => (json.extensions.VRMC_vrm.lookAt = [])]
	])('refuses a look-at that is %s as look_at_missing', (_name, change) => {
		expect(codesOf(change)).toEqual(['look_at_missing']);
	});

	it.each([
		['allowRedistribution', 'licence_redistribution', [false, 'true', null]],
		['avatarPermission', 'licence_avatar_permission', ['onlyAuthor', 'onlySeparatelyLicensedPerson', 7]],
		['creditNotation', 'licence_credit', ['required', true]]
	])('refuses %s absent or with another value as %s', (field, code, otherValues) => {
		const absent = codesOf((json) => delete json.extensions.VRMC_vrm.meta[field]);
		expect(absent).toEqual([code]);
		for (const value of otherValues) {
			expect(codesOf((json) => (json.extensions.VRMC_vrm.meta[field] = value))).toEqual([code]);
		}
	});

	it.each([
		['absent', (json: Record<string, any>) => delete json.extensions.VRMC_vrm.meta],
		['a string', (json: Record<string, any>) => (json.extensions.VRMC_vrm.meta = 'meta')]
	])('refuses all three licence fields of a meta that is %s', (_name, change) => {
		expect(codesOf(change)).toEqual(['licence_redistribution', 'licence_avatar_permission', 'licence_credit']);
	});
});
