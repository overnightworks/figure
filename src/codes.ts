/** Every refusal of the check is one key of this record; later rules add theirs here. */
export const refusalDescriptions = {
	not_glb: 'the file is not a GLB container',
	too_large: 'the file is over the profile’s file budget',
	glb_version: 'the GLB header’s version is not 2',
	glb_length: 'the GLB header’s length differs from the file’s length',
	glb_chunk: 'a chunk reaches past the end of the file, or the first chunk is not the JSON chunk',
	glb_json: 'the JSON chunk is not a JSON object',
	extension_not_allowed: 'the file names an extension the profile does not allow',
	uri_not_allowed: 'a buffer or an image names a URI; every byte must sit in the GLB itself',
	buffer_outside_glb: 'the file has a buffer besides the GLB’s own, or a buffer view in one; every byte must sit in the GLB’s binary chunk',
	not_vrm: 'the file has no VRMC_vrm extension object of specification version 1.0',
	preset_missing: 'a preset expression the profile requires is missing',
	humanoid_bone_missing: 'a bone VRM 1.0 requires is missing from the humanoid, or its entry is not an object with a node',
	look_at_missing: 'the VRM has no look-at',
	licence_redistribution: 'the licence does not allow redistribution',
	licence_avatar_permission: 'the licence does not let everyone use the model as an avatar',
	licence_credit: 'the licence requires a credit notation',
	too_many_triangles: 'the drawn meshes hold more triangles together than the profile’s budget',
	too_many_morph_targets: 'a primitive has more morph targets than the profile’s budget',
	texture_too_large: 'an embedded image is wider or taller than the profile’s side budget',
	too_many_texels: 'the embedded images hold more texels together than the profile’s budget',
	image_invalid: 'an image’s bytes reach past the binary chunk, or are not an image whose header the check can size',
	not_vrm_animation: 'the file has no VRMC_vrm_animation extension object of specification version 1.0',
	clip_content_not_allowed: 'a clip holds meshes, skins, materials, textures, images, samplers or cameras; it holds animation alone',
	clip_scene_missing: 'the clip has no scene; the loader reads the default scene',
	clip_animation_missing: 'the clip has no animation',
	clip_track_not_allowed: 'a track the profile does not allow: a channel without a target node, a weights channel, a path the target bone does not take, or key data that is sparse, has no buffer view or holds rotations that are not float',
	clip_keys_invalid: 'the bytes of a track’s keys reach past their buffer view or the binary chunk, its times are not finite, 0 or later and strictly ascending, or a rotation is not finite or not of unit length',
	clip_too_long: 'the clip’s first animation runs longer than the profile’s budget in seconds',
	room_content_not_allowed: 'a room holds skins, animations or cameras, a node with a skin or a camera, morph targets or mesh weights; it is static',
	room_scene_missing: 'the room has no scene; the loader reads the default scene',
	room_material_not_unlit: 'a material of the room has no KHR_materials_unlit object, or a primitive names no material; the room carries its own light',
	too_many_primitives: 'the nodes draw more primitives together than the profile’s budget; each primitive is one draw call',
	gltf_invalid: 'a part of the JSON that a rule must read does not have the shape glTF gives it'
} as const;

export type RefusalCode = keyof typeof refusalDescriptions;

export interface Refusal {
	readonly code: RefusalCode;
	/** What the check found, so a person can fix the file; the code is the contract, this text is not. */
	readonly detail?: string;
}
