import { figureProfile } from '../src/profile.js';
import { buildConformantVrmGlb, buildConformantVrmJson, buildGlb, embedImages, type GlbOptions } from './glbBuilder.js';

type VrmJson = ReturnType<typeof buildConformantVrmJson>;

/** The conformant synthetic VRM's JSON, changed by `change` into a counter-example. */
export function vrmJson(change: (json: VrmJson) => void = () => {}): VrmJson {
	const json = buildConformantVrmJson(figureProfile);
	change(json);
	return json;
}

/** A GLB holding the conformant VRM's JSON, unless the options bring their own JSON or bytes. */
export function buildVrmGlb(options: GlbOptions = {}): Uint8Array {
	return buildGlb({ json: vrmJson(), ...options });
}

/** The conformant synthetic VRM with its embedded PNG, as the command's tarball step writes it. */
export function buildConformantVrm(): Uint8Array {
	return buildConformantVrmGlb(figureProfile);
}

/** A GLB of the conformant VRM's JSON whose binary chunk holds `images`, with `change` applied to the JSON after they are embedded. */
export function buildVrmGlbWithImages(images: readonly Uint8Array[], change: (json: VrmJson) => void = () => {}): Uint8Array {
	const json = vrmJson();
	const binary = embedImages(json, images);
	change(json);
	return buildGlb({ json, binary });
}
