// The synthetic figure's face: two eyes, a nose, a mouth with its corners and brows, the morph targets that shape the mouth and brows, and the look-at.
import {
	EYE_TRANSLATION,
	HEAD_CENTRE,
	HEAD_HALF_SIZE,
	figureSkeleton,
	skinnedBox,
	worldPositions,
	type FigureMaterial,
	type MeshData,
	type SkinnedMesh,
	type SkinnedPrimitive,
	type Vector3
} from './figureModel.ts';

/** Where the head's front face lies, and the features stand a little in front of it. */
const FRONT_Z = HEAD_CENTRE[2] + HEAD_HALF_SIZE[2] + 0.005;

/** The untextured colours of the face, as glTF base colour factors (red, green, blue and alpha, 0 to 1). */
export const faceColours: Record<Exclude<FigureMaterial, 'skin'>, readonly [number, number, number, number]> = {
	eye: [0.1, 0.35, 0.95, 1],
	nose: [1, 0.85, 0.1, 1],
	feature: [0.04, 0.02, 0.02, 1]
};

type FeatureKind = 'eye' | 'nose' | 'mouth' | 'corner' | 'brow';

/** A box of the face: what it is, where it sits, the bone it follows and the material it wears. */
interface Feature {
	readonly kind: FeatureKind;
	readonly centre: Vector3;
	readonly halfSize: Vector3;
	readonly bone: 'head' | 'leftEye' | 'rightEye';
	readonly material: Exclude<FigureMaterial, 'skin'>;
}

/** The face's sides: the left side of the figure is at +X, as its bones are. */
const SIDE_DIRECTIONS = [1, -1] as const;

/** A feature at `x` on the left side, or on the right side mirrored, with the given bone for each side. */
function pairOf(kind: FeatureKind, x: number, y: number, halfSize: Vector3, bones: readonly [Feature['bone'], Feature['bone']], material: Feature['material']): Feature[] {
	return SIDE_DIRECTIONS.map((direction, side) => ({ kind, centre: [x * direction, y, FRONT_Z], halfSize, bone: bones[side]!, material }));
}

const skeleton = figureSkeleton();
const headBoneHeight = worldPositions(skeleton)[skeleton.findIndex(({ name }) => name === 'head')]![1]!;
const EYE_HEIGHT = headBoneHeight + EYE_TRANSLATION[1];
const EYE_HALF_SIZE: Vector3 = [0.02, 0.02, 0.01];

const EYES = pairOf('eye', EYE_TRANSLATION[0], EYE_HEIGHT, EYE_HALF_SIZE, ['leftEye', 'rightEye'], 'eye');
// Below the eyes and inside the head's box: the eyes sit low enough that the framing's sample point stays on the skin.
const NOSE: Feature = { kind: 'nose', centre: [0, EYE_HEIGHT - 0.04, FRONT_Z], halfSize: [0.025, 0.03, 0.03], bone: 'head', material: 'nose' };
const MOUTH: Feature = { kind: 'mouth', centre: [0, EYE_HEIGHT - 0.085, FRONT_Z], halfSize: [0.04, 0.012, 0.01], bone: 'head', material: 'feature' };
const CORNERS = pairOf('corner', 0.05, EYE_HEIGHT - 0.08, [0.01, 0.01, 0.01], ['head', 'head'], 'feature');
const BROWS = pairOf('brow', 0.05, EYE_HEIGHT + 0.045, [0.035, 0.008, 0.01], ['head', 'head'], 'feature');

/** How a morph target moves the features of one kind: each vertex scales about its feature's centre, then the feature shifts; a shift in X mirrors with the side. */
interface Sculpt {
	readonly scale?: readonly [number, number];
	readonly shift?: readonly [number, number];
}

/** The morph targets, in the order the face's mesh carries them: the mouth shapes the mouth, the moods move the corners and the brows. */
const MORPH_TARGETS: readonly { readonly name: string; readonly sculpts: Partial<Record<FeatureKind, Sculpt>> }[] = [
	{ name: 'aa', sculpts: { mouth: { scale: [1, 3] } } },
	{ name: 'ih', sculpts: { mouth: { scale: [1.6, 0.4] } } },
	{ name: 'ou', sculpts: { mouth: { scale: [0.5, 0.6] } } },
	{ name: 'ee', sculpts: { mouth: { scale: [1.8, 1] } } },
	{ name: 'oh', sculpts: { mouth: { scale: [0.7, 2.2] } } },
	{ name: 'happy', sculpts: { corner: { shift: [0, 0.02] } } },
	{ name: 'angry', sculpts: { brow: { shift: [-0.01, -0.02] } } },
	{ name: 'sad', sculpts: { corner: { shift: [0, -0.02] } } },
	{ name: 'relaxed', sculpts: { corner: { shift: [-0.008, -0.004] } } },
	{ name: 'surprised', sculpts: { brow: { shift: [0, 0.03] } } }
];

/** The names of the face's morph targets, in the order the face's mesh carries them. */
export const FACE_MORPH_TARGETS: readonly string[] = MORPH_TARGETS.map(({ name }) => name);

/** The look-at of VRM 1.0: the eyes' midpoint in head space, and a range map per direction, each with its input and output scale. */
export const faceLookAt = {
	type: 'bone',
	offsetFromHeadBone: [0, EYE_TRANSLATION[1], EYE_TRANSLATION[2]],
	rangeMapHorizontalInner: { inputMaxValue: 90, outputScale: 10 },
	rangeMapHorizontalOuter: { inputMaxValue: 90, outputScale: 10 },
	rangeMapVerticalDown: { inputMaxValue: 90, outputScale: 10 },
	rangeMapVerticalUp: { inputMaxValue: 90, outputScale: 10 }
};

/** The offsets of every vertex of `data` when `sculpt` applies to `feature`, as flat X, Y, Z values. */
function sculptedOffsets(feature: Feature, data: MeshData, sculpt: Sculpt | undefined): number[] {
	const [scaleX, scaleY] = sculpt?.scale ?? [1, 1];
	const [shiftX, shiftY] = sculpt?.shift ?? [0, 0];
	const side = Math.sign(feature.centre[0]);
	return Array.from({ length: data.positions.length / 3 }, (_, vertex) => {
		const offset = (axis: number) => data.positions[3 * vertex + axis]! - feature.centre[axis]!;
		return [offset(0) * (scaleX - 1) + shiftX * side, offset(1) * (scaleY - 1) + shiftY, 0];
	}).flat();
}

/** A primitive of one feature: its box, skinned to the feature's bone, with the morph targets `targets` gives it. */
function primitiveOf(feature: Feature, targets: readonly { readonly sculpts: Partial<Record<FeatureKind, Sculpt>> }[], jointOf: (bone: string) => number): SkinnedPrimitive {
	const data = skinnedBox(feature.centre, feature.halfSize, () => jointOf(feature.bone));
	return { data, material: feature.material, morphs: targets.map(({ sculpts }) => sculptedOffsets(feature, data, sculpts[feature.kind])) };
}

/** The face's meshes, skinned by the joint `jointOf` names: the eyes, the nose, and the mouth with its corners and brows, which carries the morph targets. */
export function faceMeshes(jointOf: (bone: string) => number): SkinnedMesh[] {
	return [
		{ name: 'eyes', primitives: EYES.map((eye) => primitiveOf(eye, [], jointOf)) },
		{ name: 'nose', primitives: [primitiveOf(NOSE, [], jointOf)] },
		{ name: 'face', primitives: [MOUTH, ...CORNERS, ...BROWS].map((feature) => primitiveOf(feature, MORPH_TARGETS, jointOf)) }
	];
}
