// The synthetic figure's arms: a box on each upper arm and each lower arm, skinned to the bone it hangs from, in one colour of its own.
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
