/** The values the rules read; the profile rules of later slices add theirs here. */
export const figureProfile = {
	allowedExtensions: [
		'VRMC_vrm',
		'VRMC_springBone',
		'VRMC_node_constraint',
		'VRMC_materials_mtoon',
		'KHR_materials_unlit',
		'KHR_texture_transform',
		'KHR_materials_emissive_strength',
		'EXT_texture_webp'
	],
	fileBudgetBytes: 12 * 1024 * 1024
} as const;
