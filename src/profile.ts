/** The values the rules read; the rules of later slices add theirs here. */
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
	fileBudgetBytes: 12 * 1024 * 1024,
	vrmSpecVersion: '1.0',
	presets: ['aa', 'ih', 'ou', 'ee', 'oh', 'blink', 'happy', 'angry', 'sad', 'relaxed', 'surprised'],
	licence: {
		allowRedistribution: true,
		avatarPermission: 'everyone',
		creditNotation: 'unnecessary'
	},
	maxTriangles: 60_000,
	maxMorphTargetsPerPrimitive: 64
} as const;
