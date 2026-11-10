import { figureProfile } from '../src/profile.js';
import { buildConformantVrmGlb, buildConformantVrmJson, buildConformantVrmParts, buildGlb, type GlbOptions } from './glbBuilder.js';

type VrmJson = ReturnType<typeof buildConformantVrmJson>;

/** The conformant synthetic VRM's JSON, changed by `change` into a counter-example. */
export function vrmJson(change: (json: VrmJson) => void = () => {}): VrmJson {
	const json = buildConformantVrmJson(figureProfile);
	change(json);
	return json;
}

/** The conformant synthetic VRM's JSON and binary chunk with `images` as its texture sources, the JSON changed by `change`. */
export function vrmParts(images?: readonly Uint8Array[], change: (json: VrmJson) => void = () => {}) {
	const parts = buildConformantVrmParts(figureProfile, images);
	change(parts.json);
	return parts;
}

/** A GLB holding the conformant VRM's JSON and binary chunk, unless the options bring their own. */
export function buildVrmGlb(options: GlbOptions = {}): Uint8Array {
	return buildGlb({ ...vrmParts(), ...options });
}

/** The conformant synthetic VRM as the command's tarball step writes it. */
export function buildConformantVrm(): Uint8Array {
	return buildConformantVrmGlb(figureProfile);
}

/** A GLB of the conformant VRM whose texture sources are `images`, with `change` applied to the JSON afterwards. */
export function buildVrmGlbWithImages(images: readonly Uint8Array[], change: (json: VrmJson) => void = () => {}): Uint8Array {
	return buildGlb(vrmParts(images, change));
}
