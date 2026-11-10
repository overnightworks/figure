import type { Refusal } from './codes.js';
import { isJsonObject, type JsonObject } from './json.js';
import { figureProfile } from './profile.js';

const licenceCodes = {
	allowRedistribution: 'licence_redistribution',
	avatarPermission: 'licence_avatar_permission',
	creditNotation: 'licence_credit'
} as const;

/** Judges the VRM 1.0 extension; a file without it reports `not_vrm` alone. */
export function vrmRefusals(json: JsonObject): Refusal[] {
	const extensions = json['extensions'];
	const vrm = isJsonObject(extensions) ? extensions['VRMC_vrm'] : undefined;
	if (!isJsonObject(vrm) || vrm['specVersion'] !== figureProfile.vrmSpecVersion) {
		return [{ code: 'not_vrm' }];
	}
	return [...presetRefusals(vrm), ...lookAtRefusals(vrm), ...licenceRefusals(vrm)];
}

function presetRefusals(vrm: JsonObject): Refusal[] {
	const expressions = vrm['expressions'];
	const presets = isJsonObject(expressions) ? expressions['preset'] : undefined;
	return figureProfile.presets
		.filter((name) => !isJsonObject(presets) || !isJsonObject(presets[name]))
		.map((name) => ({ code: 'preset_missing', detail: `the preset ${name} is missing` }));
}

function lookAtRefusals(vrm: JsonObject): Refusal[] {
	return isJsonObject(vrm['lookAt']) ? [] : [{ code: 'look_at_missing' }];
}

function licenceRefusals(vrm: JsonObject): Refusal[] {
	const meta = isJsonObject(vrm['meta']) ? vrm['meta'] : {};
	return (Object.keys(licenceCodes) as (keyof typeof licenceCodes)[])
		.filter((field) => meta[field] !== figureProfile.licence[field])
		.map((field) => ({ code: licenceCodes[field], detail: `${field} is not ${String(figureProfile.licence[field])}` }));
}
