// The synthetic figure's arms: a box on each upper arm and each lower arm, skinned to the bone it hangs from, in one colour of its own,
// and a sleeve on each upper arm, a box in a colour of its own skinned to a spring bone that is no humanoid bone.
import { figureSkeleton, skinnedBox, worldPositions, type SkinnedMesh, type Vector3 } from './figureModel.ts';

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

/** The arm meshes, skinned by the joint `jointOf` names: one primitive per arm segment, each in the arm material. */
export function armMeshes(jointOf: (bone: string) => number): SkinnedMesh[] {
	return [
		{
			name: 'arms',
			primitives: armSegments().map(({ bone, from, to }) => {
				const start = positionOf(from);
				const end = positionOf(to);
				const centre: Vector3 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2];
				const halfSize: Vector3 = [Math.abs(end[0] - start[0]) / 2, ARM_HALF_THICKNESS, ARM_HALF_THICKNESS];
				return { data: skinnedBox(centre, halfSize, () => jointOf(bone)), material: 'arm', morphs: [] };
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
