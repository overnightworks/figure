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
