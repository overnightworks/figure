/** Every refusal of the check is one key of this record; later rules add theirs here. */
export const refusalDescriptions = {
	not_glb: 'the file is not a GLB container',
	too_large: 'the file is over the profile’s file budget',
	glb_version: 'the GLB header’s version is not 2',
	glb_length: 'the GLB header’s length differs from the file’s length',
	glb_chunk: 'a chunk reaches past the end of the file, or the first chunk is not the JSON chunk',
	glb_json: 'the JSON chunk is not a JSON object',
	extension_not_allowed: 'the file names an extension the profile does not allow',
	uri_not_allowed: 'a buffer or an image names a URI; every byte must sit in the GLB itself'
} as const;

export type RefusalCode = keyof typeof refusalDescriptions;

export interface Refusal {
	readonly code: RefusalCode;
	/** What the check found, so a person can fix the file; the code is the contract, this text is not. */
	readonly detail?: string;
}
