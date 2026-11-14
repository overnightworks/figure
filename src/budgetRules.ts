import type { Refusal } from './codes.js';
import { attemptRead, indexOf, isJsonObject, listOf, objectOf, requiredListOf, unreadable, type JsonObject } from './json.js';
import { figureProfile, roomProfile } from './profile.js';

const MODE_TRIANGLES = 4;
const LAST_MODE = 6;
const VERTICES_PER_TRIANGLE = 3;
const VERTICES_BEFORE_FIRST_STRIP_OR_FAN_TRIANGLE = 2;

/** What one mesh draws once: its triangles and its primitives, each of which is a draw call. */
interface MeshTally {
	triangles: number;
	primitives: number;
}

/**
 * Reads every mesh once and tallies it; a part it cannot read is `gltf_invalid` in `invalid`, once for the mesh however many nodes draw it.
 * `alsoRead` runs on each primitive that is an object, for a rule of the caller's.
 */
function tallyMeshes(json: JsonObject, invalid: Refusal[], alsoRead: (primitive: JsonObject, place: string) => void = () => {}): MeshTally[] {
	const tallies: MeshTally[] = [];
	const attempt = (place: string, read: () => void) => attemptRead(invalid, place, read);
	attempt('meshes', () => {
		for (const [meshIndex, mesh] of listOf(json['meshes']).entries()) {
			const tally: MeshTally = { triangles: 0, primitives: 0 };
			tallies.push(tally);
			const meshPlace = `meshes[${meshIndex}]`;
			attempt(meshPlace, () => {
				for (const [primitiveIndex, primitive] of requiredListOf(objectOf(mesh)['primitives']).entries()) {
					const place = `${meshPlace}.primitives[${primitiveIndex}]`;
					attempt(place, () => {
						const primitiveObject = objectOf(primitive);
						tally.primitives++;
						attempt(place, () => (tally.triangles += triangleCount(json, primitiveObject)));
						alsoRead(primitiveObject, place);
					});
				}
			});
		}
	});
	return tallies;
}

/** Judges the triangle and morph-target budgets from the glTF JSON alone, counting each mesh once; a part it cannot read is `gltf_invalid`. */
export function budgetRefusals(json: JsonObject): Refusal[] {
	const invalid: Refusal[] = [];
	const morph: Refusal[] = [];
	const tallies = tallyMeshes(json, invalid, (primitive, place) =>
		attemptRead(invalid, place, () => {
			if (morphTargetCount(primitive) > figureProfile.maxMorphTargetsPerPrimitive) {
				morph.push({ code: 'too_many_morph_targets', detail: `${place} has too many morph targets` });
			}
		})
	);
	const triangles = tallies.reduce((sum, tally) => sum + tally.triangles, 0);
	const overTriangles: Refusal[] =
		triangles > figureProfile.maxTriangles ? [{ code: 'too_many_triangles', detail: `${triangles} triangles` }] : [];
	return [...overTriangles, ...morph, ...invalid];
}

/**
 * Judges the draw budgets of a room from the glTF JSON alone: every node that draws a mesh adds that mesh's triangles and primitives,
 * reached from the scene or not, so a mesh drawn by many nodes counts for each. A node or a mesh index it cannot read is left to the room rules.
 */
export function roomBudgetRefusals(json: JsonObject): Refusal[] {
	const invalid: Refusal[] = [];
	const tallies = tallyMeshes(json, invalid);
	let triangles = 0;
	let primitives = 0;
	for (const node of Array.isArray(json['nodes']) ? (json['nodes'] as unknown[]) : []) {
		const tally = isJsonObject(node) && typeof node['mesh'] === 'number' ? tallies[node['mesh']] : undefined;
		triangles += tally?.triangles ?? 0;
		primitives += tally?.primitives ?? 0;
	}
	const overTriangles: Refusal[] =
		triangles > roomProfile.maxTriangles ? [{ code: 'too_many_triangles', detail: `${triangles} triangles` }] : [];
	const overPrimitives: Refusal[] =
		primitives > roomProfile.maxPrimitives ? [{ code: 'too_many_primitives', detail: `${primitives} primitives` }] : [];
	return [...overTriangles, ...overPrimitives, ...invalid];
}

function morphTargetCount(primitive: JsonObject): number {
	return listOf(primitive['targets']).length;
}

function accessorCount(json: JsonObject, accessorIndex: unknown): number {
	const accessors = requiredListOf(json['accessors']);
	const index = indexOf(accessorIndex);
	if (index >= accessors.length) {
		return unreadable(`accessor ${index} does not exist`);
	}
	const count = objectOf(accessors[index])['count'];
	if (!Number.isInteger(count) || (count as number) < 0) {
		return unreadable(`accessor ${index} has a count that is not a non-negative integer`);
	}
	return count as number;
}

function triangleCount(json: JsonObject, primitive: JsonObject): number {
	const mode = primitive['mode'] === undefined ? MODE_TRIANGLES : primitive['mode'];
	if (!Number.isInteger(mode) || (mode as number) < 0 || (mode as number) > LAST_MODE) {
		return unreadable('has a mode that is not an integer from 0 to 6');
	}
	if ((mode as number) < MODE_TRIANGLES) {
		return 0;
	}
	const vertices = accessorCount(
		json,
		primitive['indices'] === undefined ? objectOf(primitive['attributes'])['POSITION'] : primitive['indices']
	);
	return mode === MODE_TRIANGLES
		? Math.floor(vertices / VERTICES_PER_TRIANGLE)
		: Math.max(0, vertices - VERTICES_BEFORE_FIRST_STRIP_OR_FAN_TRIANGLE);
}
