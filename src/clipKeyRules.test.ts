import { describe, expect, it } from 'vitest';
import { checkClip } from './check.js';
import { clipProfile } from './profile.js';
import { clipParts, conformantTrack, identity, type ClipTrack, type Quaternion } from '../tests/clipBuilder.js';
import { buildClipGlb, rejectedAccessorShapes, rotationsAccessor, timesAccessor } from '../tests/clipFixtures.js';
import { buildGlb } from '../tests/glbBuilder.js';

type Json = Record<string, any>;

const times = timesAccessor;
const rotations = rotationsAccessor;

function codesOfJson(change: (json: Json) => void): string[] {
	const parts = clipParts(clipProfile);
	change(parts.json);
	return checkClip(buildGlb(parts)).map(({ code }) => code);
}

function codesOfTrack(track: Partial<ClipTrack>): string[] {
	return checkClip(buildClipGlb({ animations: [[{ ...conformantTrack(), ...track }]] })).map(({ code }) => code);
}

const unit = (length: number): Quaternion => [0, 0, 0, length];

describe('the accessors of a clip’s keys', () => {
	it.each(rejectedAccessorShapes)('refuse %s alone', (_name, change, code) => {
		expect(codesOfJson(change)).toEqual([code]);
	});

	it.each([
		['names none', (json: Json) => (json.bufferViews[times].buffer = 99)],
		['is left out', (json: Json) => delete json.bufferViews[times].buffer]
	])('refuse a key buffer view whose buffer %s as gltf_invalid, besides the buffer_outside_glb the container rules give', (_name, change) => {
		expect(codesOfJson(change)).toEqual(['buffer_outside_glb', 'gltf_invalid']);
	});

	it('accept an accessor offset that is a multiple of 4', () => {
		const codes = codesOfJson((json) => {
			json.accessors[times].byteOffset = 4;
			json.accessors[times].count = 2;
			json.accessors[rotations].count = 2;
			json.bufferViews[rotations].byteOffset += 16;
			json.bufferViews[rotations].byteLength = 32;
		});
		expect(codes).toEqual([]);
	});
});

describe('the bytes of a clip’s keys', () => {
	it('refuse keys that reach past their buffer view as clip_keys_invalid alone', () => {
		expect(codesOfJson((json) => (json.bufferViews[rotations].byteLength -= 4))).toEqual(['clip_keys_invalid']);
	});

	it('refuse keys that reach past the binary chunk as clip_keys_invalid alone', () => {
		const parts = clipParts(clipProfile);
		const codes = checkClip(buildGlb({ ...parts, binary: parts.binary.subarray(0, parts.binary.length - 4) })).map(({ code }) => code);
		expect(codes).toEqual(['clip_keys_invalid']);
	});

	it('refuse keys in a file with no binary chunk as clip_keys_invalid', () => {
		const codes = checkClip(buildGlb({ ...clipParts(clipProfile), binary: undefined })).map(({ code }) => code);
		expect(codes).toContain('clip_keys_invalid');
	});

	it.each([
		['a time that is not a number', [0, Number.NaN, 2]],
		['an infinite time', [0, 1, Number.POSITIVE_INFINITY]],
		['a negative time', [-1, 1, 2]],
		['times that repeat', [0, 1, 1]],
		['times that descend', [0, 2, 1]]
	])('refuse %s as clip_keys_invalid alone', (_name, keyTimes) => {
		expect(codesOfTrack({ times: keyTimes })).toEqual(['clip_keys_invalid']);
	});

	it.each([
		['a rotation with a component that is not a number', [identity, [0, Number.NaN, 0, 1], identity] as Quaternion[]],
		['a rotation that is not of unit length', [identity, unit(2), identity]],
		['a rotation of zero length', [identity, unit(0), identity]],
		['a rotation just past the tolerance', [identity, unit(1 + 2 * clipProfile.rotationLengthTolerance), identity]]
	])('refuse %s as clip_keys_invalid alone', (_name, keyRotations) => {
		expect(codesOfTrack({ rotations: keyRotations })).toEqual(['clip_keys_invalid']);
	});

	it('accept a rotation inside the tolerance and a first key later than 0', () => {
		const rotationsInside = [unit(1 + clipProfile.rotationLengthTolerance / 2), unit(1 - clipProfile.rotationLengthTolerance / 2), identity];
		expect(codesOfTrack({ times: [0.5, 1, 2], rotations: rotationsInside })).toEqual([]);
	});

	describe('of a cubic spline', () => {
		const cubic = (tangent: Quaternion, value: Quaternion): Partial<ClipTrack> => ({
			interpolation: 'CUBICSPLINE',
			rotations: [tangent, value, tangent, tangent, identity, tangent, tangent, value, tangent]
		});

		it('are judged by the value of each key, not by its tangents', () => {
			expect(codesOfTrack(cubic(unit(5), identity))).toEqual([]);
		});

		it('refuse a tangent that is not finite', () => {
			expect(codesOfTrack(cubic([0, 0, Number.POSITIVE_INFINITY, 0], identity))).toEqual(['clip_keys_invalid']);
		});

		it('refuse a value that is not of unit length', () => {
			expect(codesOfTrack(cubic(identity, unit(2)))).toEqual(['clip_keys_invalid']);
		});
	});

	it('do not read the values of a translation', () => {
		const parts = clipParts(clipProfile);
		const hips = clipProfile.requiredHumanBones.indexOf('hips');
		const output = parts.json.accessors[rotations];
		output.type = 'VEC3';
		output.count = 3;
		parts.json.animations[0].channels[0].target = { node: hips, path: 'translation' };
		new DataView(parts.binary.buffer, parts.binary.byteOffset).setFloat32(parts.json.bufferViews[rotations].byteOffset, Number.NaN, true);
		expect(checkClip(buildGlb(parts))).toEqual([]);
	});
});
