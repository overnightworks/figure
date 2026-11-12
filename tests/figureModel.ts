/** The synthetic figure's parts: its skeleton, its two boxes and the packer that lays their data into a binary chunk. */

export type Vector3 = readonly [number, number, number];

export interface Bone {
	readonly name: string;
	/** The index in the skeleton of the parent bone; undefined for the root. */
	readonly parent: number | undefined;
	/** Metres from the parent, with +Y up and the figure facing +Z. */
	readonly translation: Vector3;
	/** Whether the bone is one of VRM's humanoid bones; a sleeve's is not. */
	readonly humanoid: boolean;
}

interface BoneSpec {
	readonly name: string;
	readonly parentName: string | undefined;
	readonly translation: Vector3;
	readonly humanoid?: boolean;
}

const SIDES = [
	{ prefix: 'left', direction: 1 },
	{ prefix: 'right', direction: -1 }
] as const;

/** The head box of the figure's skin: its centre and its half sizes. */
export const HEAD_CENTRE: Vector3 = [0, 1.65, 0];
export const HEAD_HALF_SIZE: Vector3 = [0.12, 0.12, 0.12];

/** Where an eye bone sits from the head bone, for the left eye; the right eye mirrors its X. */
export const EYE_TRANSLATION: Vector3 = [0.05, 0.1, 0.12];

const TRUNK: readonly BoneSpec[] = [
	{ name: 'hips', parentName: undefined, translation: [0, 1, 0] },
	{ name: 'spine', parentName: 'hips', translation: [0, 0.1, 0] },
	{ name: 'chest', parentName: 'spine', translation: [0, 0.15, 0] },
	{ name: 'neck', parentName: 'chest', translation: [0, 0.2, 0] },
	{ name: 'head', parentName: 'neck', translation: [0, 0.08, 0] }
];

/** Where a shoulder sits from the chest, for the left side; the right side mirrors its X. */
const SHOULDER_TRANSLATION: Vector3 = [0.15, 0.15, 0];

/** One side's arm and leg chains: a name, the bone it hangs from and its offset for the left side (the right side mirrors X). */
const LIMB_CHAINS: readonly { readonly name: string; readonly parentName: string; readonly translation: Vector3 }[] = [
	{ name: 'UpperArm', parentName: 'Shoulder', translation: [0.05, 0, 0] },
	{ name: 'LowerArm', parentName: 'UpperArm', translation: [0.25, 0, 0] },
	{ name: 'Hand', parentName: 'LowerArm', translation: [0.25, 0, 0] },
	{ name: 'UpperLeg', parentName: 'hips', translation: [0.1, -0.05, 0] },
	{ name: 'LowerLeg', parentName: 'UpperLeg', translation: [0, -0.45, 0] },
	{ name: 'Foot', parentName: 'LowerLeg', translation: [0, -0.45, 0] }
];

function shoulderSpecs(): BoneSpec[] {
	return SIDES.map(({ prefix, direction }) => ({
		name: prefix + 'Shoulder',
		parentName: 'chest',
		translation: [SHOULDER_TRANSLATION[0] * direction, SHOULDER_TRANSLATION[1], SHOULDER_TRANSLATION[2]] as Vector3
	}));
}

function limbSpecs(): BoneSpec[] {
	const isSideBone = (name: string) => name === 'Shoulder' || LIMB_CHAINS.some((limb) => limb.name === name);
	return SIDES.flatMap(({ prefix, direction }) =>
		LIMB_CHAINS.map(({ name, parentName, translation }) => ({
			name: prefix + name,
			parentName: isSideBone(parentName) ? prefix + parentName : parentName,
			translation: [translation[0] * direction, translation[1], translation[2]] as Vector3
		}))
	);
}

/** Where a sleeve bone sits from its upper arm, and the bone that ends its spring chain from the sleeve bone, for the left side; the right side mirrors X. */
const SLEEVE_TRANSLATION: Vector3 = [0.08, 0, 0];
const SLEEVE_TIP_TRANSLATION: Vector3 = [0.1, 0, 0];

/** A sleeve's spring chain: the sleeve bone, which swings, and the tip bone beyond it, which only gives the chain its length. */
function sleeveSpecs(): BoneSpec[] {
	return SIDES.flatMap(({ prefix, direction }) => [
		{ name: prefix + 'Sleeve', parentName: prefix + 'UpperArm', translation: [SLEEVE_TRANSLATION[0] * direction, 0, 0] as Vector3, humanoid: false },
		{ name: prefix + 'SleeveTip', parentName: prefix + 'Sleeve', translation: [SLEEVE_TIP_TRANSLATION[0] * direction, 0, 0] as Vector3, humanoid: false }
	]);
}

function eyeSpecs(): BoneSpec[] {
	return SIDES.map(({ prefix, direction }) => ({
		name: prefix + 'Eye',
		parentName: 'head',
		translation: [EYE_TRANSLATION[0] * direction, EYE_TRANSLATION[1], EYE_TRANSLATION[2]] as Vector3
	}));
}

/** The bones from the hips down, each after its parent: the trunk with chest and neck, then both shoulders, both arms, both legs, both eyes and both sleeves with their tips. */
export function figureSkeleton(): Bone[] {
	const specs = [...TRUNK, ...shoulderSpecs(), ...limbSpecs(), ...eyeSpecs(), ...sleeveSpecs()];
	const indexOfName = new Map(specs.map((spec, index) => [spec.name, index]));
	return specs.map(({ name, parentName, translation, humanoid = true }) => ({
		name,
		parent: parentName === undefined ? undefined : indexOfName.get(parentName),
		translation,
		humanoid
	}));
}

/** The position of each bone in the figure's space: its translation added to its parent's. */
export function worldPositions(skeleton: readonly Bone[]): Vector3[] {
	const positions: Vector3[] = [];
	for (const { parent, translation } of skeleton) {
		const base: Vector3 = parent === undefined ? [0, 0, 0] : positions[parent]!;
		positions.push([base[0] + translation[0], base[1] + translation[1], base[2] + translation[2]]);
	}
	return positions;
}

/** The vertex data of a mesh, one entry per vertex in each attribute; `indices` lists triangles. */
export interface MeshData {
	readonly positions: readonly number[];
	readonly normals: readonly number[];
	readonly textureCoordinates: readonly number[];
	readonly joints: readonly number[];
	readonly weights: readonly number[];
	readonly indices: readonly number[];
}

/** The figure's materials: the skin's textured one, then the untextured ones of the face, the arms and the sleeves, each a colour of its own. */
export const FIGURE_MATERIALS = ['skin', 'eye', 'nose', 'feature', 'arm', 'sleeve'] as const;
export type FigureMaterial = (typeof FIGURE_MATERIALS)[number];

/** One primitive of a skinned mesh; `morphs` holds, per morph target, the offset of every vertex as flat X, Y, Z values. */
export interface SkinnedPrimitive {
	readonly data: MeshData;
	readonly material: FigureMaterial;
	readonly morphs: readonly (readonly number[])[];
}

/** A mesh skinned to the figure's skin; all its primitives carry the same number of morph targets. */
export interface SkinnedMesh {
	readonly name: string;
	readonly primitives: readonly SkinnedPrimitive[];
}

const FACES = [0, 1, 2].flatMap((axis) => [1, -1].map((sign) => ({ axis, sign })));
const FACE_CORNERS = [
	[-1, -1],
	[1, -1],
	[1, 1],
	[-1, 1]
] as const;
const QUAD_TRIANGLES = [0, 1, 2, 0, 2, 3];

function faceVertices(centre: Vector3, halfSize: Vector3, { axis, sign }: { axis: number; sign: number }) {
	const across = (axis + 1) % 3;
	const up = (axis + 2) % 3;
	// Reversing the corners keeps the triangles counter-clockwise seen from outside the minus faces.
	const corners = sign > 0 ? FACE_CORNERS : [...FACE_CORNERS].reverse();
	return corners.map(([acrossSign, upSign]) => {
		const position = [0, 0, 0];
		const normal = [0, 0, 0];
		position[axis] = centre[axis]! + sign * halfSize[axis]!;
		position[across] = centre[across]! + acrossSign * halfSize[across]!;
		position[up] = centre[up]! + upSign * halfSize[up]!;
		normal[axis] = sign;
		return { position, normal, textureCoordinate: [(acrossSign + 1) / 2, (upSign + 1) / 2] };
	});
}

/** A box of 24 vertices (four per face, so each face has its normal) and 12 triangles, every vertex bound to the joint `jointOf` names. */
export function skinnedBox(centre: Vector3, halfSize: Vector3, jointOf: (position: readonly number[]) => number): MeshData {
	const vertices = FACES.flatMap((face) => faceVertices(centre, halfSize, face));
	return {
		positions: vertices.flatMap(({ position }) => position),
		normals: vertices.flatMap(({ normal }) => normal),
		textureCoordinates: vertices.flatMap(({ textureCoordinate }) => textureCoordinate),
		joints: vertices.flatMap(({ position }) => [jointOf(position), 0, 0, 0]),
		weights: vertices.flatMap(() => [1, 0, 0, 0]),
		indices: FACES.flatMap((_face, face) => QUAD_TRIANGLES.map((corner) => 4 * face + corner))
	};
}

/** How far each vertex moves when a morph target is fully applied, as flat X, Y, Z values; vertices `moves` names move by `offset`. */
export function morphDeltas(vertexCount: number, moves: (vertex: number) => boolean, offset: Vector3): number[] {
	return Array.from({ length: vertexCount }, (_, vertex) => (moves(vertex) ? offset : [0, 0, 0])).flat();
}

/** The inverse bind matrix (glTF 2.0, section 3.7.3.2) of a joint that is only translated to `position`, column-major. */
export function inverseBindMatrix(position: Vector3): number[] {
	return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -position[0], -position[1], -position[2], 1];
}

export const COMPONENT_TYPE = { unsignedByte: 5121, unsignedShort: 5123, float: 5126 } as const;
export const BUFFER_TARGET = { vertexAttributes: 34962, indices: 34963 } as const;

const BYTES_PER_COMPONENT = { [COMPONENT_TYPE.unsignedByte]: 1, [COMPONENT_TYPE.unsignedShort]: 2, [COMPONENT_TYPE.float]: 4 } as const;
const COMPONENTS_PER_TYPE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as const;
const ALIGNMENT_BYTES = 4;

export type ComponentType = keyof typeof BYTES_PER_COMPONENT;

function encode(values: readonly number[], componentType: ComponentType): Uint8Array {
	const bytes = new Uint8Array(values.length * BYTES_PER_COMPONENT[componentType]);
	const view = new DataView(bytes.buffer);
	const write = {
		[COMPONENT_TYPE.unsignedByte]: (offset: number, value: number) => view.setUint8(offset, value),
		[COMPONENT_TYPE.unsignedShort]: (offset: number, value: number) => view.setUint16(offset, value, true),
		[COMPONENT_TYPE.float]: (offset: number, value: number) => view.setFloat32(offset, value, true)
	}[componentType];
	values.forEach((value, index) => write(index * BYTES_PER_COMPONENT[componentType], value));
	return bytes;
}

/** The smallest and largest value of each component as stored in 32 bits, which glTF 2.0 requires of a POSITION accessor (section 3.7.2.1). */
function componentBounds(values: readonly number[], componentCount: number) {
	const component = (index: number) => values.filter((_, position) => position % componentCount === index).map(Math.fround);
	const indices = Array.from({ length: componentCount }, (_, index) => index);
	return { min: indices.map((index) => Math.min(...component(index))), max: indices.map((index) => Math.max(...component(index))) };
}

export interface AccessorSpec {
	readonly values: readonly number[];
	readonly componentType: ComponentType;
	readonly type: keyof typeof COMPONENTS_PER_TYPE;
	readonly target?: number;
	/** Whether the accessor states its bounds, as a POSITION accessor must. */
	readonly bounded?: boolean;
}

/** Lays buffer views and their accessors back to back in one binary chunk, each view starting on a four-byte boundary. */
export class BinaryPacker {
	readonly bufferViews: Record<string, unknown>[] = [];
	readonly accessors: Record<string, unknown>[] = [];
	private readonly parts: Uint8Array[] = [];
	private length = 0;

	/** Adds bytes as a buffer view and returns the view's index. */
	addView(bytes: Uint8Array, target?: number): number {
		const padded = new Uint8Array(Math.ceil(bytes.length / ALIGNMENT_BYTES) * ALIGNMENT_BYTES);
		padded.set(bytes);
		this.bufferViews.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.length, ...(target === undefined ? {} : { target }) });
		this.parts.push(padded);
		this.length += padded.length;
		return this.bufferViews.length - 1;
	}

	/** Adds the values as a buffer view with an accessor over it and returns the accessor's index. */
	addAccessor({ values, componentType, type, target, bounded }: AccessorSpec): number {
		const componentCount = COMPONENTS_PER_TYPE[type];
		this.accessors.push({
			bufferView: this.addView(encode(values, componentType), target),
			componentType,
			count: values.length / componentCount,
			type,
			...(bounded ? componentBounds(values, componentCount) : {})
		});
		return this.accessors.length - 1;
	}

	get byteLength(): number {
		return this.length;
	}

	toBytes(): Uint8Array {
		const bytes = new Uint8Array(this.length);
		let offset = 0;
		for (const part of this.parts) {
			bytes.set(part, offset);
			offset += part.length;
		}
		return bytes;
	}
}
