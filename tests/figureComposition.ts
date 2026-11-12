// The conformant synthetic VRM's composition: which meshes, bones, materials and expressions the figure has.
// glbBuilder.ts writes the bytes of what this module composes.
import {
	BUFFER_TARGET,
	BinaryPacker,
	COMPONENT_TYPE,
	FIGURE_MATERIALS,
	HEAD_CENTRE,
	HEAD_HALF_SIZE,
	figureSkeleton,
	inverseBindMatrix,
	morphDeltas,
	skinnedBox,
	worldPositions,
	type AccessorSpec,
	type Bone,
	type MeshData,
	type SkinnedMesh,
	type SkinnedPrimitive,
	type Vector3
} from './figureModel.ts';
import { SLEEVE_BONES, SLEEVE_SPRING_JOINT, SLEEVE_TIP_BONES, armMeshes, sleeveMeshes } from './figureArms.ts';
import { faceLookAt, faceMeshes, FACE_MORPH_TARGETS, untexturedColours } from './figureFace.ts';

/** The values a conformant VRM carries; the caller reads them from the profile so the builder restates none. */
export interface ConformantVrmValues {
	readonly vrmSpecVersion: string;
	readonly presets: readonly string[];
	readonly requiredHumanBones: readonly string[];
	readonly licence: {
		readonly allowRedistribution: boolean;
		readonly avatarPermission: string;
		readonly creditNotation: string;
	};
}

const TORSO_HALF_SIZE: Vector3 = [0.18, 0.2, 0.1];
const TORSO_CENTRE: Vector3 = [0, 1.2, 0];
const BLINK_OFFSET: Vector3 = [0, -0.03, 0];
const FRONT_FACE_NORMAL_Z = 1;

/** A figure made heavy: its meshes together hold `triangles`, and one more mesh of them carries `morphTargets` morph targets. */
export interface HeavyFigure {
	readonly triangles: number;
	readonly morphTargets: number;
}

const HEAVY_MESH_CENTRE: Vector3 = [0, 1.4, 0.15];
const HEAVY_MESH_SIZE = 0.6;
const HEAVY_MORPH_STEP = 0.001;
const MAX_INDEXED_VERTICES = 0x10000;

/** A flat grid of `triangles` triangles in front of the torso, a pair to each cell, every vertex bound to the first joint; the last row may stop short. */
function heavyMesh(triangles: number): MeshData {
	const cells = Math.ceil(triangles / 2);
	const columns = Math.ceil(Math.sqrt(cells));
	const rows = Math.ceil(cells / columns);
	if ((columns + 1) * (rows + 1) > MAX_INDEXED_VERTICES) {
		throw new RangeError(`${triangles} triangles need more vertices than a 16-bit index reaches`);
	}
	const vertices = Array.from({ length: (columns + 1) * (rows + 1) }, (_, vertex) => [vertex % (columns + 1), Math.floor(vertex / (columns + 1))] as const);
	const indices = Array.from({ length: cells }, (_, cell) => {
		const first = Math.floor(cell / columns) * (columns + 1) + (cell % columns);
		return [first, first + 1, first + columns + 2, first, first + columns + 2, first + columns + 1];
	}).flat();
	return {
		positions: vertices.flatMap(([column, row]) => [
			HEAVY_MESH_CENTRE[0] + (column / columns - 0.5) * HEAVY_MESH_SIZE,
			HEAVY_MESH_CENTRE[1] + (row / rows - 0.5) * HEAVY_MESH_SIZE,
			HEAVY_MESH_CENTRE[2]
		]),
		normals: vertices.flatMap(() => [0, 0, FRONT_FACE_NORMAL_Z]),
		textureCoordinates: vertices.flatMap(([column, row]) => [column / columns, row / rows]),
		joints: vertices.flatMap(() => [0, 0, 0, 0]),
		weights: vertices.flatMap(() => [1, 0, 0, 0]),
		indices: indices.slice(0, 3 * triangles)
	};
}

/** The joints of the skin, in the order of its `joints`: the torso is skinned to the first two, the head, the eyes, the arms and the sleeves to the rest. */
const SKIN_JOINT_NAMES: readonly string[] = [
	'spine',
	'chest',
	'head',
	'leftEye',
	'rightEye',
	'leftUpperArm',
	'leftLowerArm',
	'rightUpperArm',
	'rightLowerArm',
	...SLEEVE_BONES
];

function jointIndexOf(bone: string): number {
	const index = SKIN_JOINT_NAMES.indexOf(bone);
	if (index < 0) throw new RangeError(`the skin has no joint for ${bone}`);
	return index;
}

function skinnedMeshes(chestHeight: number, heavy?: HeavyFigure): SkinnedMesh[] {
	const torso = skinnedBox(TORSO_CENTRE, TORSO_HALF_SIZE, (position) => jointIndexOf(position[1]! < chestHeight ? 'spine' : 'chest'));
	const head = skinnedBox(HEAD_CENTRE, HEAD_HALF_SIZE, () => jointIndexOf('head'));
	const upperFront = (vertex: number) =>
		head.normals[3 * vertex + 2] === FRONT_FACE_NORMAL_Z && head.positions[3 * vertex + 1]! > HEAD_CENTRE[1];
	const meshes: SkinnedMesh[] = [
		{ name: 'torso', primitives: [{ data: torso, material: 'skin', morphs: [] }] },
		{ name: 'head', primitives: [{ data: head, material: 'skin', morphs: [morphDeltas(head.positions.length / 3, upperFront, BLINK_OFFSET)] }] },
		...faceMeshes(jointIndexOf),
		...armMeshes(jointIndexOf),
		...sleeveMeshes(jointIndexOf)
	];
	if (heavy === undefined) return meshes;
	const lightTriangles = meshes.reduce((sum, mesh) => sum + mesh.primitives.reduce((primitiveSum, { data }) => primitiveSum + data.indices.length / 3, 0), 0);
	const data = heavyMesh(heavy.triangles - lightTriangles);
	const vertexCount = data.positions.length / 3;
	const morphs = Array.from({ length: heavy.morphTargets }, (_, target) =>
		morphDeltas(vertexCount, () => true, [0, HEAVY_MORPH_STEP * (target + 1), 0])
	);
	return [...meshes, { name: 'heavy', primitives: [{ data, material: 'skin', morphs }] }];
}

function addPrimitive(packer: BinaryPacker, { data, material, morphs }: SkinnedPrimitive): Record<string, unknown> {
	const { float, unsignedByte, unsignedShort } = COMPONENT_TYPE;
	const attributes: Record<string, AccessorSpec> = {
		POSITION: { values: data.positions, componentType: float, type: 'VEC3', bounded: true },
		NORMAL: { values: data.normals, componentType: float, type: 'VEC3' },
		TEXCOORD_0: { values: data.textureCoordinates, componentType: float, type: 'VEC2' },
		JOINTS_0: { values: data.joints, componentType: unsignedByte, type: 'VEC4' },
		WEIGHTS_0: { values: data.weights, componentType: float, type: 'VEC4' }
	};
	const addAttributes = (specs: Record<string, AccessorSpec>) =>
		Object.fromEntries(Object.entries(specs).map(([name, spec]) => [name, packer.addAccessor({ ...spec, target: BUFFER_TARGET.vertexAttributes })]));
	const morphTarget = (values: readonly number[]): Record<string, AccessorSpec> => ({ POSITION: { values, componentType: float, type: 'VEC3', bounded: true } });
	return {
		attributes: addAttributes(attributes),
		indices: packer.addAccessor({ values: data.indices, componentType: unsignedShort, type: 'SCALAR', target: BUFFER_TARGET.indices }),
		material: FIGURE_MATERIALS.indexOf(material),
		...(morphs.length === 0 ? {} : { targets: morphs.map((values) => addAttributes(morphTarget(values))) })
	};
}

function requireBones(skeleton: readonly Bone[], required: readonly string[]): void {
	const names = new Set(skeleton.map(({ name }) => name));
	const missing = required.filter((name) => !names.has(name));
	if (missing.length > 0) {
		throw new Error(`the test skeleton lacks the required bones ${missing.join(', ')}`);
	}
}

/** The images come first in the binary chunk and in the buffer views, so `images[i]` reads `bufferViews[i]`; the geometry follows. */
function addImages(packer: BinaryPacker, images: readonly Uint8Array[]) {
	return images.map((image) => ({ bufferView: packer.addView(image), mimeType: 'image/png' }));
}

/** The slots of the skin's material, in the order they take the textures after the base colour; a texture no material names is never loaded. */
const EXTRA_TEXTURE_SLOTS = ['emissiveTexture', 'occlusionTexture', 'normalTexture'] as const;

function skinMaterial(textureCount: number): Record<string, unknown> {
	if (textureCount > 1 + EXTRA_TEXTURE_SLOTS.length) {
		throw new RangeError(`the material names at most ${1 + EXTRA_TEXTURE_SLOTS.length} textures, not ${textureCount}`);
	}
	const extra = EXTRA_TEXTURE_SLOTS.slice(0, Math.max(0, textureCount - 1)).map((slot, index) => [slot, { index: index + 1 }]);
	return { pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, ...Object.fromEntries(extra) };
}

/** A material of one colour and no texture, not metallic, so the colour shows under the light. */
function untexturedMaterial(colour: readonly number[]): Record<string, unknown> {
	return { pbrMetallicRoughness: { baseColorFactor: colour, metallicFactor: 0 } };
}

function skeletonNodes(skeleton: readonly Bone[]) {
	return skeleton.map(({ name, translation }, index) => {
		const children = skeleton.flatMap((child, childIndex) => (child.parent === index ? [childIndex] : []));
		return { name, translation, ...(children.length === 0 ? {} : { children }) };
	});
}

/** The expression of one preset: the blink binds the head's morph target, the mouth and mood presets the face's; a preset with none stays empty. */
function expressionOf(name: string, headNode: number, faceNode: number): Record<string, unknown> {
	if (name === 'blink') return { morphTargetBinds: [{ node: headNode, index: 0, weight: 1 }] };
	const index = FACE_MORPH_TARGETS.indexOf(name);
	return index < 0 ? {} : { morphTargetBinds: [{ node: faceNode, index, weight: 1 }] };
}

/**
 * The conformant synthetic VRM's JSON and binary chunk: a skeleton with chest, neck and eyes, the skinned torso and head, the face (eyes,
 * nose, mouth with its corners and brows) with the morph targets its presets bind, a blink, the arms, a sleeve on each upper arm that is a
 * spring bone, and one material per figure material: the skin's with a base colour texture and `images` as the texture sources, the
 * others untextured, each a colour of its own.
 * With `heavy`, a further mesh of grid triangles carries the morph targets, and the meshes together hold the triangles it names.
 */
export function buildConformantVrmParts(
	values: ConformantVrmValues,
	images: readonly Uint8Array[],
	heavy?: HeavyFigure
): { json: Record<string, any>; binary: Uint8Array } {
	const skeleton = figureSkeleton();
	requireBones(skeleton, values.requiredHumanBones);
	const boneIndex = (name: string) => skeleton.findIndex((bone) => bone.name === name);
	const positions = worldPositions(skeleton);
	const packer = new BinaryPacker();
	const imageEntries = addImages(packer, images);
	const meshes = skinnedMeshes(positions[boneIndex('chest')]![1], heavy);
	const meshEntries = meshes.map((mesh) => ({ name: mesh.name, primitives: mesh.primitives.map((primitive) => addPrimitive(packer, primitive)) }));
	const jointNodes = SKIN_JOINT_NAMES.map(boneIndex);
	const inverseBindMatrices = packer.addAccessor({
		values: jointNodes.flatMap((node) => inverseBindMatrix(positions[node]!)),
		componentType: COMPONENT_TYPE.float,
		type: 'MAT4'
	});
	const meshNodes = meshes.map((mesh, meshIndex) => ({ name: `${mesh.name}Mesh`, mesh: meshIndex, skin: 0 }));
	const nodes = [...skeletonNodes(skeleton), ...meshNodes];
	const meshNode = (name: string) => skeleton.length + meshes.findIndex((mesh) => mesh.name === name);
	return {
		json: {
			asset: { version: '2.0' },
			extensionsUsed: ['VRMC_vrm', 'VRMC_springBone'],
			extensions: {
				VRMC_vrm: {
					specVersion: values.vrmSpecVersion,
					meta: { name: 'synthetic', authors: ['synthetic'], licenseUrl: 'https://example.invalid/licence', ...values.licence },
					humanoid: { humanBones: Object.fromEntries(skeleton.flatMap(({ name, humanoid }, node) => (humanoid ? [[name, { node }]] : []))) },
					expressions: {
						preset: Object.fromEntries(values.presets.map((name) => [name, expressionOf(name, meshNode('head'), meshNode('face'))]))
					},
					lookAt: faceLookAt
				},
				VRMC_springBone: {
					specVersion: '1.0',
					springs: SLEEVE_BONES.map((name, side) => ({ name, joints: [{ node: boneIndex(name), ...SLEEVE_SPRING_JOINT }, { node: boneIndex(SLEEVE_TIP_BONES[side]!) }] }))
				}
			},
			scene: 0,
			scenes: [{ nodes: [0, ...meshNodes.map((_, index) => skeleton.length + index)] }],
			nodes,
			skins: [{ inverseBindMatrices, skeleton: 0, joints: jointNodes }],
			meshes: meshEntries,
			materials: FIGURE_MATERIALS.map((material) => (material === 'skin' ? skinMaterial(images.length) : untexturedMaterial(untexturedColours[material]))),
			textures: images.map((_, source) => ({ source })),
			images: imageEntries,
			buffers: [{ byteLength: packer.byteLength }],
			bufferViews: packer.bufferViews,
			accessors: packer.accessors
		},
		binary: packer.toBytes()
	};
}
