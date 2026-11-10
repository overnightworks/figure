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
	not_vrm: 'the file has no VRMC_vrm extension object of specification version 1.0',
	preset_missing: 'a preset expression the profile requires is missing',
	humanoid_bone_missing: 'a bone VRM 1.0 requires is missing from the humanoid, or its entry is not an object with a node',
	look_at_missing: 'the VRM has no look-at',
	licence_redistribution: 'the licence does not allow redistribution',
	licence_avatar_permission: 'the licence does not let everyone use the model as an avatar',
	licence_credit: 'the licence requires a credit notation',
	too_many_triangles: 'the meshes hold more triangles together than the profile’s budget',
	too_many_morph_targets: 'a primitive has more morph targets than the profile’s budget',
	texture_too_large: 'an embedded image is wider or taller than the profile’s side budget',
	too_many_texels: 'the embedded images hold more texels together than the profile’s budget',
	image_invalid: 'an image’s bytes reach past the binary chunk, or are not an image whose header the check can size',
	gltf_invalid: 'a part of the JSON that a rule must read does not have the shape glTF gives it'
} as const;

export type RefusalCode = keyof typeof refusalDescriptions;

export interface Refusal {
	readonly code: RefusalCode;
	/** What the check found, so a person can fix the file; the code is the contract, this text is not. */
	readonly detail?: string;
}
