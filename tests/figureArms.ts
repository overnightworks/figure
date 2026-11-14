// The synthetic figure's arms: a box on each upper arm, each lower arm and each hand, skinned to the bone it hangs from, in one colour of its own,
// and a sleeve on each upper arm, a box in a colour of its own skinned to a spring bone that is no humanoid bone.
import { figureSkeleton, skinnedBox, worldPositions, type MeshData, type SkinnedMesh, type Vector3 } from './figureModel.ts';

/** Half the width and the depth of an arm, in metres. */
const ARM_HALF_THICKNESS = 0.05;

const SIDE_PREFIXES = ['left', 'right'] as const;

const skeleton = figureSkeleton();
const jointPositions = worldPositions(skeleton);

function positionOf(bone: string): Vector3 {
	const index = skeleton.findIndex(({ name }) => name === bone);
	if (index < 0) throw new RangeError(`the skeleton has no bone ${bone}`);
	return jointPositions[index]!;
}

/** The segments of the arms: each bone's box runs from its joint to the next one; the arms lie along X at rest. */
function armSegments(): { bone: string; from: string; to: string }[] {
	return SIDE_PREFIXES.flatMap((prefix) => [
		{ bone: prefix + 'UpperArm', from: prefix + 'UpperArm', to: prefix + 'LowerArm' },
		{ bone: prefix + 'LowerArm', from: prefix + 'LowerArm', to: prefix + 'Hand' }
	]);
}

/** Half the length of a hand, in metres: the box runs from the wrist outward along X, as far as the width of the arm is thick. */
const HAND_HALF_LENGTH = 0.05;

/** The box a hand's turn shows in: from the wrist outward, skinned to the hand. */
function handBox(side: string, jointOf: (bone: string) => number): MeshData {
	const wrist = positionOf(side + 'Hand');
	const centre: Vector3 = [wrist[0] + Math.sign(wrist[0]) * HAND_HALF_LENGTH, wrist[1], wrist[2]];
	return skinnedBox(centre, [HAND_HALF_LENGTH, ARM_HALF_THICKNESS, ARM_HALF_THICKNESS], () => jointOf(side + 'Hand'));
}

/** `first` and `second` as one mesh: a hand's box joins its lower arm's, so a hand adds no primitive of its own. */
function joined(first: MeshData, second: MeshData): MeshData {
	const firstVertices = first.positions.length / 3;
	return {
		positions: [...first.positions, ...second.positions],
		normals: [...first.normals, ...second.normals],
		textureCoordinates: [...first.textureCoordinates, ...second.textureCoordinates],
		joints: [...first.joints, ...second.joints],
		weights: [...first.weights, ...second.weights],
		indices: [...first.indices, ...second.indices.map((index) => index + firstVertices)]
	};
}

/** The arm meshes, skinned by the joint `jointOf` names: one primitive per arm segment, each in the arm material, the lower arm's with its hand's box. */
export function armMeshes(jointOf: (bone: string) => number): SkinnedMesh[] {
	return [
		{
			name: 'arms',
			primitives: armSegments().map(({ bone, from, to }) => {
				const start = positionOf(from);
				const end = positionOf(to);
				const centre: Vector3 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2];
				const halfSize: Vector3 = [Math.abs(end[0] - start[0]) / 2, ARM_HALF_THICKNESS, ARM_HALF_THICKNESS];
				const box = skinnedBox(centre, halfSize, () => jointOf(bone));
				const side = SIDE_PREFIXES.find((prefix) => bone.startsWith(prefix))!;
				return { data: bone.endsWith('LowerArm') ? joined(box, handBox(side, jointOf)) : box, material: 'arm', morphs: [] };
			})
		}
	];
}

/** The settings of a sleeve's spring joint, slack enough to show a stale start for a few frames and stiff enough to settle after, with no gravity, so a sleeve's rest shape is its bone's own. */
export const SLEEVE_SPRING_JOINT = { hitRadius: 0.02, stiffness: 1, gravityPower: 0, dragForce: 0.4 } as const;

/** Half the size of a sleeve, in metres: it wraps its upper arm and reaches a little past the bone it hangs from, along X. */
const SLEEVE_HALF_SIZE: Vector3 = [0.06, 0.07, 0.07];

/** The names of the sleeves' bones, one per side, and of the tip bone that ends each one's spring chain. */
export const SLEEVE_BONES = SIDE_PREFIXES.map((prefix) => prefix + 'Sleeve');
export const SLEEVE_TIP_BONES = SIDE_PREFIXES.map((prefix) => prefix + 'SleeveTip');

/** The sleeve meshes, skinned by the joint `jointOf` names: one box on each sleeve bone, in the sleeve material. */
export function sleeveMeshes(jointOf: (bone: string) => number): SkinnedMesh[] {
	return [
		{
			name: 'sleeves',
			primitives: SLEEVE_BONES.map((bone) => {
				const start = positionOf(bone);
				const direction = Math.sign(start[0]);
				const centre: Vector3 = [start[0] + direction * SLEEVE_HALF_SIZE[0], start[1], start[2]];
				return { data: skinnedBox(centre, SLEEVE_HALF_SIZE, () => jointOf(bone)), material: 'sleeve', morphs: [] };
			})
		}
	];
}
