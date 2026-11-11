import { figureProfile } from '../src/profile.js';
import { buildConformantVrmParts } from './figureComposition.js';
import { buildConformantVrmGlb, buildFigureTexturePng, buildGlb, type GlbOptions } from './glbBuilder.js';

type VrmJson = ReturnType<typeof buildConformantVrmParts>['json'];

/** The conformant synthetic VRM's JSON, changed by `change` into a counter-example. */
export function vrmJson(change: (json: VrmJson) => void = () => {}): VrmJson {
	return vrmParts(undefined, change).json;
}

/** The conformant synthetic VRM's JSON and binary chunk with `images` as its texture sources (by default the figure's PNG), the JSON changed by `change`. */
export function vrmParts(images: readonly Uint8Array[] = [buildFigureTexturePng()], change: (json: VrmJson) => void = () => {}) {
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

/** The JSON and binary chunks of a GLB, read from its bytes as glTF 2.0 lays them out (section 4.4). */
export function readGlb(glb: Uint8Array): { json: Record<string, any>; binary: Uint8Array } {
	const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
	const jsonEnd = 20 + view.getUint32(12, true);
	return { json: JSON.parse(new TextDecoder().decode(glb.subarray(20, jsonEnd))), binary: glb.subarray(jsonEnd + 8) };
}
