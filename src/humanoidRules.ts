import type { Refusal } from './codes.js';
import { isJsonObject, mustNameEntry, type JsonObject } from './json.js';

/** The `humanoid_bone_missing` refusal for a required bone whose entry is no object with a `node`; undefined when it has one. */
export function missingBoneRefusal(humanBones: ReadonlyMap<string, unknown>, bone: string): Refusal | undefined {
	const entry = humanBones.get(bone);
	return isJsonObject(entry) && 'node' in entry ? undefined : { code: 'humanoid_bone_missing', detail: `the bone ${bone} is missing` };
}

/** The node index an entry of a humanoid, an expression or a look-at holds; unreadable unless it is an entry of `nodes`. */
export function nodeOfEntry(json: JsonObject, nodeIndex: unknown): number {
	return mustNameEntry(json, 'nodes', nodeIndex, 'a node index names no entry of nodes');
}
