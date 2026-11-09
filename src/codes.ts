/** Every refusal of the check is one key of this record; later rules add theirs here. */
export const refusalDescriptions = {
	not_glb: 'the file is not a GLB container'
} as const;

export type RefusalCode = keyof typeof refusalDescriptions;

export interface Refusal {
	readonly code: RefusalCode;
}
