import { describe, expect, it } from 'vitest';
import { checkClip } from './check.js';
import { clipProfile } from './profile.js';
import { clipParts, conformantTrack, identity, type ClipTrack, type Quaternion } from '../tests/clipBuilder.js';
import { buildClipGlb } from '../tests/clipFixtures.js';
import { buildGlb } from '../tests/glbBuilder.js';

type Json = Record<string, any>;

const SHORT = 5122;
const UNSIGNED_INT = 5125;

/** The conformant clip's accessors: the times, then the rotations. */
const times = 0;
const rotations = 1;

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
	it.each([
		['no accessors', (json: Json) => delete json.accessors],
		['a sampler input that names no accessor', (json: Json) => (json.animations[0].samplers[0].input = 99)],
		['a sampler output that names no accessor', (json: Json) => (json.animations[0].samplers[0].output = 99)],
		['times that are not SCALAR', (json: Json) => (json.accessors[times].type = 'VEC3')],
		['rotations that are not VEC4', (json: Json) => (json.accessors[rotations].type = 'SCALAR')],
		['times that are not float', (json: Json) => (json.accessors[times].componentType = SHORT)],
		['rotations of a component type glTF gives no rotation', (json: Json) => (json.accessors[rotations].componentType = UNSIGNED_INT)],
		['a component type that is no number', (json: Json) => (json.accessors[rotations].componentType = 'FLOAT')],
		['a count that is not a positive integer', (json: Json) => (json.accessors[times].count = 0)],
		['a buffer view that names none', (json: Json) => (json.accessors[times].bufferView = 99)],
		['a buffer view with a stride', (json: Json) => (json.bufferViews[times].byteStride = 4)],
		['an accessor offset that is not an integer', (json: Json) => (json.accessors[times].byteOffset = 1.5)],
		['an offset that is not a multiple of 4', (json: Json) => {
			json.accessors[times].byteOffset = 2;
			json.bufferViews[times].byteLength += 4;
		}],
		['a buffer view offset that is not a multiple of 4', (json: Json) => {
			json.bufferViews[times].byteOffset = 2;
			json.bufferViews[times].byteLength += 4;
		}],
		['fewer rotations than times', (json: Json) => (json.accessors[rotations].count = 2)],
		['fewer times than rotations', (json: Json) => (json.accessors[times].count = 2)],
		['an interpolation whose count does not fit', (json: Json) => (json.animations[0].samplers[0].interpolation = 'CUBICSPLINE')]
	])('refuse %s as gltf_invalid alone', (_name, change) => {
		expect(codesOfJson(change)).toEqual(['gltf_invalid']);
	});

	it.each([
		['a sparse accessor', (json: Json) => (json.accessors[rotations].sparse = { count: 1 })],
		['an accessor without a buffer view', (json: Json) => delete json.accessors[rotations].bufferView],
		['normalised integer rotations', (json: Json) => (json.accessors[rotations].componentType = SHORT)]
	])('refuse %s as clip_track_not_allowed alone', (_name, change) => {
		expect(codesOfJson(change)).toEqual(['clip_track_not_allowed']);
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

	it('are judged for every channel of every animation', () => {
		const bad = { ...conformantTrack(), times: [0, 2, 1] };
		const codes = checkClip(buildClipGlb({ animations: [[conformantTrack()], [bad]] })).map(({ code }) => code);
		expect(codes).toEqual(['clip_keys_invalid']);
	});
});
