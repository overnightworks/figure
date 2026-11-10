import { figureProfile } from '../src/profile.js';
import { buildConformantVrmJson, buildGlb, type GlbOptions } from './glbBuilder.js';

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
