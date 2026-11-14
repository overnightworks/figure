/** The room shapes three's loader throws on that the room rules refuse. A test file drives them through the check, or through the command. */

type Json = Record<string, any>;
type Change = (json: Json) => void;

/** Each is refused as `gltf_invalid` and no other code. */
export const invalidReferenceCases: readonly (readonly [name: string, change: Change])[] = [
	['a node whose mesh names no mesh', (json) => (json.nodes[1].mesh = json.meshes.length)],
	['a node whose mesh is not an index', (json) => (json.nodes[1].mesh = '0')],
	['a node that draws a mesh while meshes is absent', (json) => delete json.meshes],
	['a primitive whose material names no material', (json) => (json.meshes[0].primitives[0].material = json.materials.length)],
	['a primitive whose material is not an index', (json) => (json.meshes[0].primitives[0].material = '0')],
	['a primitive that names a material while materials is absent', (json) => delete json.materials],
	['a primitive whose indices names no accessor', (json) => (json.meshes[0].primitives[0].indices = json.accessors.length)],
	['a primitive whose POSITION names no accessor', (json) => (json.meshes[0].primitives[0].attributes.POSITION = json.accessors.length)],
	['a primitive whose TEXCOORD_0 names no accessor', (json) => (json.meshes[0].primitives[0].attributes.TEXCOORD_0 = json.accessors.length)],
	['a primitive whose COLOR_0 names no accessor', (json) => (json.meshes[1].primitives[0].attributes.COLOR_0 = json.accessors.length)],
	['a primitive whose attribute is not an index', (json) => (json.meshes[0].primitives[0].attributes.TEXCOORD_0 = '1')],
	['a primitive that names accessors while accessors is absent', (json) => delete json.accessors],
	['a base colour texture whose index names no texture', (json) => (json.materials[0].pbrMetallicRoughness.baseColorTexture.index = json.textures.length)],
	['a base colour texture while textures is absent', (json) => delete json.textures],
	['a base colour texture without an index', (json) => delete json.materials[0].pbrMetallicRoughness.baseColorTexture.index],
	['a texture whose source names no image', (json) => (json.textures[0].source = json.images.length)],
	['a texture whose WebP source names no image', (json) => (json.textures[0].extensions = { EXT_texture_webp: { source: json.images.length } })],
	['a texture with neither source', (json) => (json.textures[0] = {})],
	['a texture with a source while images is absent', (json) => delete json.images],
	['an unlit material beside an extensionsUsed that does not name it', (json) => (json.extensionsUsed = [])],
	['an unlit material beside no extensionsUsed', (json) => delete json.extensionsUsed],
	['an unlit material beside an extensionsUsed that is not a list', (json) => (json.extensionsUsed = 'KHR_materials_unlit')],
	['an unlisted Draco object on a primitive', (json) => (json.meshes[0].primitives[0].extensions = { KHR_draco_mesh_compression: { bufferView: 0, attributes: {} } })]
];
