import { clipProfile } from '../src/profile.js';
import { clipParts, conformantTrack, type ClipTrack } from './clipBuilder.js';
import { buildGlb, type GlbOptions } from './glbBuilder.js';

export type ClipJson = ReturnType<typeof clipParts>['json'];

/** How a clip differs from the conformant one; every field left out is what the conformant clip has. */
export interface ClipVariant {
	/** The tracks of each animation, instead of the conformant clip's one track. */
	readonly animations?: readonly (readonly ClipTrack[])[];
	/** Turns the clip's JSON into a counter-example. */
	readonly change?: (json: ClipJson) => void;
	/** Replaces the chunks or the header, as `buildGlb`'s options do. */
	readonly glb?: GlbOptions;
}

/** A GLB of the conformant clip's JSON and binary chunk, varied as the variant says. */
export function buildClipGlb({ animations, change, glb }: ClipVariant = {}): Uint8Array {
	const parts = clipParts(clipProfile, animations);
	change?.(parts.json);
	return buildGlb({ ...parts, ...glb });
}

/** A GLB of the conformant clip padded in its binary chunk to exactly `size` bytes. */
export function buildClipGlbOfSize(size: number): Uint8Array {
	const { json, binary } = clipParts(clipProfile);
	const padded = new Uint8Array(size - buildGlb({ json, binary }).length + binary.length);
	padded.set(binary);
	return buildGlb({ json, binary: padded });
}

/** The node of a bone in the conformant clip, which lists the required bones first and the tracks' other bones after. */
export function nodeOf(bone: string): number {
	return clipProfile.requiredHumanBones.indexOf(bone as (typeof clipProfile.requiredHumanBones)[number]);
}

/** Adds a node outside the humanoid and returns its index. */
export function addNode(json: ClipJson): number {
	json.nodes.push({ name: 'extra' });
	return json.nodes.length - 1;
}

/** Adds a node the clip names as the `happy` expression and returns its index. */
export function expressionNode(json: ClipJson): number {
	const node = addNode(json);
	json.extensions.VRMC_vrm_animation.expressions = { preset: { happy: { node } } };
	return node;
}

/** Adds a node the clip names as its look-at target and returns its index. */
export function lookAtNode(json: ClipJson): number {
	const node = addNode(json);
	json.extensions.VRMC_vrm_animation.lookAt = { node };
	return node;
}

/** Points the first channel of an animation at `node` with `path`, over a sampler of the matching shape (a translation or scale reads VEC3). */
export function retarget(json: ClipJson, node: number | undefined, path: string, animation = 0): void {
	const channel = json.animations[animation].channels[0];
	channel.target = node === undefined ? { path } : { node, path };
	if (path !== 'rotation') {
		const output = json.accessors[json.animations[animation].samplers[0].output];
		output.type = 'VEC3';
		output.count = 3;
		json.bufferViews[output.bufferView].byteLength = 3 * 3 * 4;
	}
}

/** The properties a clip may not hold, each of which the check refuses by name. */
export const forbiddenClipContent = ['meshes', 'skins', 'materials', 'textures', 'images', 'samplers', 'cameras'] as const;

/** The conformant clip's accessors: the times, then the rotations. */
export const timesAccessor = 0;
export const rotationsAccessor = 1;

const SHORT = 5122;
const UNSIGNED_INT = 5125;

/** A change that makes a clip a counter-example, with the one code the check gives for it. */
export type ClipRefusalCase = readonly [name: string, change: (json: ClipJson) => void, code: 'gltf_invalid' | 'clip_track_not_allowed'];

/** Each accessor shape of a clip's keys the check does not accept. */
export const rejectedAccessorShapes: readonly ClipRefusalCase[] = [
	['no accessors', (json) => delete json.accessors, 'gltf_invalid'],
	['a sampler input that names no accessor', (json) => (json.animations[0].samplers[0].input = 99), 'gltf_invalid'],
	['a sampler output that names no accessor', (json) => (json.animations[0].samplers[0].output = 99), 'gltf_invalid'],
	['times that are not SCALAR', (json) => (json.accessors[timesAccessor].type = 'VEC3'), 'gltf_invalid'],
	['rotations that are not VEC4', (json) => (json.accessors[rotationsAccessor].type = 'SCALAR'), 'gltf_invalid'],
	['times that are not float', (json) => (json.accessors[timesAccessor].componentType = SHORT), 'gltf_invalid'],
	['rotations of a component type glTF gives no rotation', (json) => (json.accessors[rotationsAccessor].componentType = UNSIGNED_INT), 'gltf_invalid'],
	[
		'translations of a component type other than float',
		(json) => {
			retarget(json, nodeOf('hips'), 'translation');
			json.accessors[rotationsAccessor].componentType = SHORT;
		},
		'gltf_invalid'
	],
	['float times that are normalised', (json) => (json.accessors[timesAccessor].normalized = true), 'gltf_invalid'],
	['float rotations that are normalised', (json) => (json.accessors[rotationsAccessor].normalized = true), 'gltf_invalid'],
	['no buffers', (json) => delete json.buffers, 'gltf_invalid'],
	['a component type that is no number', (json) => (json.accessors[rotationsAccessor].componentType = 'FLOAT'), 'gltf_invalid'],
	['a count that is not a positive integer', (json) => (json.accessors[timesAccessor].count = 0), 'gltf_invalid'],
	['a buffer view that names none', (json) => (json.accessors[timesAccessor].bufferView = 99), 'gltf_invalid'],
	['a buffer view with a stride', (json) => (json.bufferViews[timesAccessor].byteStride = 4), 'gltf_invalid'],
	['an accessor offset that is not an integer', (json) => (json.accessors[timesAccessor].byteOffset = 1.5), 'gltf_invalid'],
	[
		'an offset that is not a multiple of 4',
		(json) => {
			json.accessors[timesAccessor].byteOffset = 2;
			json.bufferViews[timesAccessor].byteLength += 4;
		},
		'gltf_invalid'
	],
	[
		'a buffer view offset that is not a multiple of 4',
		(json) => {
			json.bufferViews[timesAccessor].byteOffset = 2;
			json.bufferViews[timesAccessor].byteLength += 4;
		},
		'gltf_invalid'
	],
	['fewer rotations than times', (json) => (json.accessors[rotationsAccessor].count = 2), 'gltf_invalid'],
	['fewer times than rotations', (json) => (json.accessors[timesAccessor].count = 2), 'gltf_invalid'],
	['an interpolation whose count does not fit', (json) => (json.animations[0].samplers[0].interpolation = 'CUBICSPLINE'), 'gltf_invalid'],
	['a sparse accessor', (json) => (json.accessors[rotationsAccessor].sparse = { count: 1 }), 'clip_track_not_allowed'],
	['an accessor without a buffer view', (json) => delete json.accessors[rotationsAccessor].bufferView, 'clip_track_not_allowed'],
	['normalised integer rotations', (json) => (json.accessors[rotationsAccessor].componentType = SHORT), 'clip_track_not_allowed']
];

const secondAnimation = (track: Partial<ClipTrack>): readonly (readonly ClipTrack[])[] => [[conformantTrack()], [{ ...conformantTrack(), ...track }]];

/** A clip whose second animation differs from the conformant one: the check judges it as it judges the first, except for the length budget, which only the first animation answers to. */
export const secondAnimationCases: readonly (readonly [name: string, variant: ClipVariant, codes: readonly string[]])[] = [
	[
		'a second animation past the length budget',
		{ animations: secondAnimation({ times: [0, 1, clipProfile.maxSeconds + 1] }) },
		[]
	],
	[
		'a second animation with a channel the profile does not allow',
		{ animations: secondAnimation({}), change: (json) => retarget(json, nodeOf('spine'), 'scale', 1) },
		['clip_track_not_allowed']
	],
	['a second animation with keys that descend', { animations: secondAnimation({ times: [0, 2, 1] }) }, ['clip_keys_invalid']]
];
