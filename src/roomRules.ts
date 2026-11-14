import type { Refusal } from './codes.js';
import { attemptRead, indexOf, isJsonObject, listOf, objectOf, unreadable, type JsonObject } from './json.js';
import { sceneRefusals, type SceneKind } from './sceneRules.js';

/** The glTF properties that make a room move or look through a camera; a room holds none. */
const FORBIDDEN_PROPERTIES = ['skins', 'animations', 'cameras'];
/** What the scene rules need of a room: a node of a room draws meshes, but is skinned to nothing and holds no camera. */
const SCENE_KIND: SceneKind = {
	missingSceneCode: 'room_scene_missing',
	contentCode: 'room_content_not_allowed',
	forbiddenNodeProperties: ['skin', 'camera']
};
const UNLIT = 'KHR_materials_unlit';
const DRACO = 'KHR_draco_mesh_compression';

/**
 * Judges the room rules from the glTF JSON alone: what a room may not hold, its scene, its unlit materials and the references the loader follows
 * from the nodes down to the images. A mesh or primitive that is not an object is left to the budget rules, which refuse it.
 */
export function roomRefusals(json: JsonObject): Refusal[] {
	return [...contentRefusals(json), ...sceneRefusals(json, SCENE_KIND), ...materialRefusals(json), ...referenceRefusals(json)];
}

interface Primitive {
	readonly place: string;
	readonly value: JsonObject;
}

function meshesOf(json: JsonObject): { place: string; value: JsonObject }[] {
	const meshes = Array.isArray(json['meshes']) ? (json['meshes'] as unknown[]) : [];
	return meshes.flatMap((mesh, index) => (isJsonObject(mesh) ? [{ place: `meshes[${index}]`, value: mesh }] : []));
}

function primitivesOf(json: JsonObject): Primitive[] {
	return meshesOf(json).flatMap(({ place, value }) => {
		const primitives = Array.isArray(value['primitives']) ? (value['primitives'] as unknown[]) : [];
		return primitives.flatMap((primitive, index) => (isJsonObject(primitive) ? [{ place: `${place}.primitives[${index}]`, value: primitive }] : []));
	});
}

function contentRefusals(json: JsonObject): Refusal[] {
	const refusals: Refusal[] = [];
	const refuse = (detail: string) => refusals.push({ code: 'room_content_not_allowed', detail });
	for (const property of FORBIDDEN_PROPERTIES) {
		if (json[property] !== undefined) {
			refuse(`the room holds ${property}`);
		}
	}
	for (const { place, value } of meshesOf(json)) {
		if (value['weights'] !== undefined) {
			refuse(`${place} holds weights`);
		}
	}
	for (const { place, value } of primitivesOf(json)) {
		if (value['targets'] !== undefined) {
			refuse(`${place} holds targets`);
		}
	}
	return refusals;
}

function namedInExtensionsUsed(json: JsonObject, extension: string): boolean {
	return Array.isArray(json['extensionsUsed']) && json['extensionsUsed'].includes(extension);
}

function holdsUnlit(material: JsonObject): boolean {
	return isJsonObject(material['extensions']) && isJsonObject(material['extensions'][UNLIT]);
}

/** The room carries its own light: every material is unlit and every primitive names one, since the default material is lit. */
function materialRefusals(json: JsonObject): Refusal[] {
	const refusals: Refusal[] = [];
	attemptRead(refusals, 'materials', () => {
		for (const [index, material] of listOf(json['materials']).entries()) {
			const place = `materials[${index}]`;
			attemptRead(refusals, place, () => {
				if (!holdsUnlit(objectOf(material))) {
					refusals.push({ code: 'room_material_not_unlit', detail: `${place} holds no ${UNLIT} object` });
				} else if (!namedInExtensionsUsed(json, UNLIT)) {
					unreadable(`holds ${UNLIT} while extensionsUsed does not name it`);
				}
			});
		}
	});
	for (const { place, value } of primitivesOf(json)) {
		if (value['material'] === undefined) {
			refusals.push({ code: 'room_material_not_unlit', detail: `${place} names no material` });
		}
	}
	return refusals;
}

/** Unreadable unless `index` names an entry of the list `json[listName]`, as the loader reads it. */
function mustNameEntry(json: JsonObject, listName: string, index: unknown): void {
	if (!isJsonObject(listOf(json[listName])[indexOf(index)])) {
		unreadable(`names no entry of ${listName}`);
	}
}

/** The loader indexes the lists these name; an index that names no entry throws there, so each is `gltf_invalid` here. */
function referenceRefusals(json: JsonObject): Refusal[] {
	const refusals: Refusal[] = [];
	const attempt = (place: string, read: () => void) => attemptRead(refusals, place, read);
	attempt('nodes', () => {
		for (const [index, node] of listOf(json['nodes']).entries()) {
			if (isJsonObject(node) && node['mesh'] !== undefined) {
				attempt(`nodes[${index}]`, () => mustNameEntry(json, 'meshes', node['mesh']));
			}
		}
	});
	for (const { place, value } of primitivesOf(json)) {
		attempt(place, () => primitiveReferences(json, value));
	}
	attempt('materials', () => {
		for (const [index, material] of listOf(json['materials']).entries()) {
			attempt(`materials[${index}]`, () => baseColourTextureReference(json, objectOf(material)));
		}
	});
	attempt('textures', () => {
		for (const [index, texture] of listOf(json['textures']).entries()) {
			attempt(`textures[${index}]`, () => textureSources(json, objectOf(texture)));
		}
	});
	return refusals;
}

function primitiveReferences(json: JsonObject, primitive: JsonObject): void {
	if (primitive['material'] !== undefined) {
		mustNameEntry(json, 'materials', primitive['material']);
	}
	if (primitive['indices'] !== undefined) {
		mustNameEntry(json, 'accessors', primitive['indices']);
	}
	for (const accessor of Object.values(objectOf(primitive['attributes']))) {
		mustNameEntry(json, 'accessors', accessor);
	}
	const extensions = primitive['extensions'];
	if (isJsonObject(extensions) && extensions[DRACO] !== undefined && !namedInExtensionsUsed(json, DRACO)) {
		unreadable(`holds ${DRACO} while extensionsUsed does not name it`);
	}
}

/** An unlit material draws its base colour texture alone, so the other textures of a material are not followed. */
function baseColourTextureReference(json: JsonObject, material: JsonObject): void {
	const metallicRoughness = material['pbrMetallicRoughness'];
	const baseColourTexture = metallicRoughness === undefined ? undefined : objectOf(metallicRoughness)['baseColorTexture'];
	if (baseColourTexture !== undefined) {
		mustNameEntry(json, 'textures', objectOf(baseColourTexture)['index']);
	}
}

/** The loader takes the WebP source when the texture holds the extension, and `source` otherwise; a texture with neither has no image. */
function textureSources(json: JsonObject, texture: JsonObject): void {
	const extensions = texture['extensions'];
	const webp = isJsonObject(extensions) ? extensions['EXT_texture_webp'] : undefined;
	if (texture['source'] === undefined && webp === undefined) {
		unreadable('names no image');
	}
	if (texture['source'] !== undefined) {
		mustNameEntry(json, 'images', texture['source']);
	}
	if (webp !== undefined) {
		mustNameEntry(json, 'images', objectOf(webp)['source']);
	}
}
