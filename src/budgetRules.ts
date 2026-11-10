import type { Refusal } from './codes.js';
import { isJsonObject, type JsonObject } from './json.js';
import { figureProfile } from './profile.js';

const MODE_TRIANGLES = 4;
const LAST_MODE = 6;
const VERTICES_PER_TRIANGLE = 3;
const VERTICES_BEFORE_FIRST_STRIP_OR_FAN_TRIANGLE = 2;

/** A part of the JSON a budget must read that does not have glTF's shape. */
class Unreadable extends Error {}

/** Judges the triangle and morph-target budgets from the glTF JSON alone; a part it cannot read is `gltf_invalid`. */
export function budgetRefusals(json: JsonObject): Refusal[] {
	const invalid: Refusal[] = [];
	const morph: Refusal[] = [];
	let triangles = 0;
	const attempt = (place: string, read: () => void) => {
		try {
			read();
		} catch (error_) {
			// The readers below throw nothing but Unreadable.
			invalid.push({ code: 'gltf_invalid', detail: `${place}: ${(error_ as Unreadable).message}` });
		}
	};
	attempt('meshes', () => {
		for (const [meshIndex, mesh] of listOf(json['meshes']).entries()) {
			const meshPlace = `meshes[${meshIndex}]`;
			attempt(meshPlace, () => {
				for (const [primitiveIndex, primitive] of requiredListOf(objectOf(mesh)['primitives']).entries()) {
					const place = `${meshPlace}.primitives[${primitiveIndex}]`;
					attempt(place, () => {
						const primitiveObject = objectOf(primitive);
						attempt(place, () => (triangles += triangleCount(json, primitiveObject)));
						attempt(place, () => {
							if (morphTargetCount(primitiveObject) > figureProfile.maxMorphTargetsPerPrimitive) {
								morph.push({ code: 'too_many_morph_targets', detail: `${place} has too many morph targets` });
							}
						});
					});
				}
			});
		}
	});
	const overTriangles: Refusal[] =
		triangles > figureProfile.maxTriangles ? [{ code: 'too_many_triangles', detail: `${triangles} triangles` }] : [];
	return [...overTriangles, ...morph, ...invalid];
}

function objectOf(value: unknown): JsonObject {
	if (!isJsonObject(value)) {
		throw new Unreadable('a value that must be an object is not');
	}
	return value;
}

function requiredListOf(value: unknown): unknown[] {
	if (!Array.isArray(value)) {
		throw new Unreadable('a value that must be a list is not');
	}
	return value;
}

/** A list the file may leave out. */
function listOf(value: unknown): unknown[] {
	return value === undefined ? [] : requiredListOf(value);
}

function indexOf(value: unknown): number {
	if (!Number.isInteger(value) || (value as number) < 0) {
		throw new Unreadable('an index is not a non-negative integer');
	}
	return value as number;
}

function morphTargetCount(primitive: JsonObject): number {
	return listOf(primitive['targets']).length;
}

function accessorCount(json: JsonObject, accessorIndex: unknown): number {
	const accessors = requiredListOf(json['accessors']);
	const index = indexOf(accessorIndex);
	if (index >= accessors.length) {
		throw new Unreadable(`accessor ${index} does not exist`);
	}
	const count = objectOf(accessors[index])['count'];
	if (!Number.isInteger(count) || (count as number) < 0) {
		throw new Unreadable(`accessor ${index} has a count that is not a non-negative integer`);
	}
	return count as number;
}

function triangleCount(json: JsonObject, primitive: JsonObject): number {
	const mode = primitive['mode'] ?? MODE_TRIANGLES;
	if (!Number.isInteger(mode) || (mode as number) < 0 || (mode as number) > LAST_MODE) {
		throw new Unreadable('has a mode that is not an integer from 0 to 6');
	}
	if ((mode as number) < MODE_TRIANGLES) {
		return 0;
	}
	const vertices = accessorCount(json, primitive['indices'] ?? objectOf(primitive['attributes'])['POSITION']);
	return mode === MODE_TRIANGLES
		? Math.floor(vertices / VERTICES_PER_TRIANGLE)
		: Math.max(0, vertices - VERTICES_BEFORE_FIRST_STRIP_OR_FAN_TRIANGLE);
}
