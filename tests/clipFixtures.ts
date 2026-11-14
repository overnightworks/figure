import { clipProfile } from '../src/profile.js';
import { clipParts, type ClipTrack } from './clipBuilder.js';
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
