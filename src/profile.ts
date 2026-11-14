import { figureMood, mouthShape } from './expressions.js';

/** The bones VRM 1.0 requires in `humanoid.humanBones`; each entry names a node. */
const requiredHumanBones = [
	'hips',
	'spine',
	'head',
	'leftUpperLeg',
	'leftLowerLeg',
	'leftFoot',
	'rightUpperLeg',
	'rightLowerLeg',
	'rightFoot',
	'leftUpperArm',
	'leftLowerArm',
	'leftHand',
	'rightUpperArm',
	'rightLowerArm',
	'rightHand'
] as const;

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
	presets: [...Object.values(mouthShape), 'blink', ...Object.values(figureMood)],
	requiredHumanBones,
	licence: {
		allowRedistribution: true,
		avatarPermission: 'everyone',
		creditNotation: 'unnecessary'
	},
	maxTriangles: 60_000,
	maxMorphTargetsPerPrimitive: 64,
	maxTextureSidePixels: 2048,
	maxTexels: 8_000_000
} as const;

/** The values the clip rules read: a `.vrma` file as `VRMC_vrm_animation` 1.0 specifies it, narrowed to what a gesture turns. */
export const clipProfile = {
	allowedExtensions: ['VRMC_vrm_animation'],
	specVersion: '1.0',
	requiredHumanBones,
	fileBudgetBytes: 512 * 1024,
	maxSeconds: 10,
	/** How far a rotation key's length may lie from 1. */
	rotationLengthTolerance: 0.01
} as const;
