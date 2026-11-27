import type { Refusal } from './codes.js';
import { isJsonObject, mustNameEntry, objectOf, type JsonObject } from './json.js';

/** The `humanoid_bone_missing` refusal for a required bone whose entry is no object with a `node`; undefined when it has one. */
export function missingBoneRefusal(humanBones: ReadonlyMap<string, unknown>, bone: string): Refusal | undefined {
	const entry = humanBones.get(bone);
	return isJsonObject(entry) && 'node' in entry ? undefined : { code: 'humanoid_bone_missing', detail: `the bone ${bone} is missing` };
}

/** The node an entry of a humanoid, an expression or a look-at names; unreadable unless it is an entry of `nodes`. */
export function nodeOfEntry(json: JsonObject, entry: unknown): number {
	return mustNameEntry(json, 'nodes', objectOf(entry)['node'], 'a node index names no entry of nodes');
}
