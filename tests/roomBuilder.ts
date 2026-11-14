// The conformant synthetic room: a textured floor and a back wall, unlit, the wall drawn by two nodes. The bytes are written here and the check never runs.
// Node reads this file with its types stripped (scripts/write_conformant_figure.mjs, scripts/measure_budget_figure.mjs), so it imports with the `.ts` extension.
import { BUFFER_TARGET, BinaryPacker, COMPONENT_TYPE } from './figureModel.ts';
import { buildCompressedImagePng, buildFigureTexturePng, buildGlb, figureTexture, imageSizesFilling, type GlbOptions } from './glbBuilder.ts';

/** What gives the room its colour: a texture, vertex colours, or the floor textured and the wall painted in vertex colours. */
export type RoomLook = 'both' | 'textured' | 'vertexColoured';

/** One mesh of one primitive. A texture coordinate list makes it textured, a colour list makes it painted in vertex colours. */
interface RoomMesh {
	readonly positions: readonly number[];
	readonly indices: readonly number[];
	readonly textureCoordinates?: readonly number[];
	readonly colours?: readonly number[];
	/** The index in `materials`. */
	readonly material: number;
}

interface RoomSpec {
	readonly meshes: readonly RoomMesh[];
	readonly images: readonly Uint8Array[];
	/** Each material by the index of the image it draws as its base colour texture; undefined for a material without one. */
	readonly materials: readonly (number | undefined)[];
	/** The mesh each node under the root draws, in order. */
	readonly drawn: readonly number[];
}

/** The limits a room at the budgets fills; the caller reads them from the profile. */
export interface RoomBudgets {
	readonly maxTriangles: number;
	readonly maxPrimitives: number;
	readonly maxTextureSidePixels: number;
	readonly maxTexels: number;
}

const HALF_SIDE_METRES = 2;
const WALL_HEIGHT_METRES = 3;
const PAINT = [0.8, 0.7, 0.5, 1];
const STRIP_STEP_METRES = 0.01;

/** A square whose triangles face the way the corners run counter-clockwise, textured or painted in vertex colours. */
function square(corners: readonly (readonly [number, number, number])[], material: number, textured: boolean): RoomMesh {
	return {
		positions: corners.flat(),
		indices: [0, 1, 2, 0, 2, 3],
		...(textured ? { textureCoordinates: [0, 0, 1, 0, 1, 1, 0, 1] } : { colours: corners.flatMap(() => PAINT) }),
		material
	};
}

/** The floor at y = 0, its triangles facing up. */
const floorCorners = [
	[-HALF_SIDE_METRES, 0, HALF_SIDE_METRES],
	[HALF_SIDE_METRES, 0, HALF_SIDE_METRES],
	[HALF_SIDE_METRES, 0, -HALF_SIDE_METRES],
	[-HALF_SIDE_METRES, 0, -HALF_SIDE_METRES]
] as const;

/** The wall at the back of the room, its triangles facing the camera at +Z. */
const wallCorners = [
	[-HALF_SIDE_METRES, 0, -HALF_SIDE_METRES],
	[HALF_SIDE_METRES, 0, -HALF_SIDE_METRES],
	[HALF_SIDE_METRES, WALL_HEIGHT_METRES, -HALF_SIDE_METRES],
	[-HALF_SIDE_METRES, WALL_HEIGHT_METRES, -HALF_SIDE_METRES]
] as const;

/** A strip of `triangles` triangles over `triangles + 2` vertices on a zigzag, textured. */
function strip(triangles: number, material: number): RoomMesh {
	const vertices = triangles + 2;
	return {
		positions: Array.from({ length: vertices }, (_, vertex) => [vertex * STRIP_STEP_METRES, (vertex % 2) * STRIP_STEP_METRES, 0]).flat(),
		textureCoordinates: Array.from({ length: vertices }, (_, vertex) => [vertex % 2, vertex / vertices]).flat(),
		indices: Array.from({ length: triangles }, (_, triangle) => (triangle % 2 === 0 ? [triangle, triangle + 1, triangle + 2] : [triangle + 1, triangle, triangle + 2])).flat(),
		material
	};
}

function attributesAndIndices(packer: BinaryPacker, mesh: RoomMesh) {
	const float = COMPONENT_TYPE.float;
	const attributes: Record<string, number> = {
		POSITION: packer.addAccessor({ values: mesh.positions, componentType: float, type: 'VEC3', target: BUFFER_TARGET.vertexAttributes, bounded: true })
	};
	if (mesh.textureCoordinates !== undefined) {
		attributes['TEXCOORD_0'] = packer.addAccessor({ values: mesh.textureCoordinates, componentType: float, type: 'VEC2', target: BUFFER_TARGET.vertexAttributes });
	}
	if (mesh.colours !== undefined) {
		attributes['COLOR_0'] = packer.addAccessor({ values: mesh.colours, componentType: float, type: 'VEC4', target: BUFFER_TARGET.vertexAttributes });
	}
	const indices = packer.addAccessor({ values: mesh.indices, componentType: COMPONENT_TYPE.unsignedShort, type: 'SCALAR', target: BUFFER_TARGET.indices });
	return { attributes, indices };
}

function composeRoom({ meshes, images, materials, drawn }: RoomSpec): { json: Record<string, any>; binary: Uint8Array } {
	const packer = new BinaryPacker();
	const imageViews = images.map((bytes) => packer.addView(bytes));
	const meshEntries = meshes.map((mesh) => ({ primitives: [{ ...attributesAndIndices(packer, mesh), material: mesh.material }] }));
	const binary = packer.toBytes();
	const json = {
		asset: { version: '2.0' },
		extensionsUsed: ['KHR_materials_unlit'],
		scene: 0,
		scenes: [{ nodes: [0] }],
		nodes: [{ name: 'room', children: drawn.map((_, index) => index + 1) }, ...drawn.map((mesh, index) => ({ name: `part ${index}`, mesh }))],
		meshes: meshEntries,
		materials: materials.map((image) => ({
			...(image === undefined ? {} : { pbrMetallicRoughness: { baseColorTexture: { index: image } } }),
			extensions: { KHR_materials_unlit: {} }
		})),
		...(images.length === 0 ? {} : { textures: images.map((_, source) => ({ source })), images: imageViews.map((bufferView) => ({ bufferView, mimeType: 'image/png' })) }),
		accessors: packer.accessors,
		bufferViews: packer.bufferViews,
		buffers: [{ byteLength: binary.length }]
	};
	return { json, binary };
}

/** The materials of each look and the one the wall draws; the floor draws the first. */
const looks: Record<RoomLook, { materials: readonly (number | undefined)[]; wallMaterial: number }> = {
	both: { materials: [0, undefined], wallMaterial: 1 },
	textured: { materials: [0], wallMaterial: 0 },
	vertexColoured: { materials: [undefined], wallMaterial: 0 }
};

/** The JSON and binary chunk of the conformant room, with `images` as its texture sources instead of the figure's PNG: a floor and a wall, the wall drawn by two nodes under a root, every material unlit. */
export function roomParts(look: RoomLook = 'both', images?: readonly Uint8Array[]): { json: Record<string, any>; binary: Uint8Array } {
	const { materials, wallMaterial } = looks[look];
	const isTextured = (material: number) => materials[material] !== undefined;
	return composeRoom({
		meshes: [square(floorCorners, 0, isTextured(0)), square(wallCorners, wallMaterial, isTextured(wallMaterial))],
		images: images ?? (materials.includes(0) ? [buildFigureTexturePng()] : []),
		materials,
		drawn: [0, 1, 1]
	});
}

/** The images that together fill the texel budget, none wider or taller than the side budget, as the PNGs of the figure's one colour. */
function budgetImages(budgets: RoomBudgets): Uint8Array[] {
	return imageSizesFilling(budgets.maxTexels, budgets.maxTextureSidePixels).map(([width, height]) => buildCompressedImagePng(width, height, figureTexture.colour));
}

/**
 * A conformant room at the budgets: textures filling the texel budget, the triangle budget spread over as many meshes as the primitive budget
 * allows, one primitive and one node each. Its file size is whatever those give; the file budget has its own cases.
 */
export function buildBudgetRoom(budgets: RoomBudgets): { glb: Uint8Array; images: number; meshes: number } {
	const images = budgetImages(budgets);
	const share = Math.floor(budgets.maxTriangles / budgets.maxPrimitives);
	const remainder = budgets.maxTriangles % budgets.maxPrimitives;
	const meshes = Array.from({ length: budgets.maxPrimitives }, (_, index) => strip(share + (index < remainder ? 1 : 0), index % images.length));
	const parts = composeRoom({
		meshes,
		images,
		materials: images.map((_, image) => image),
		drawn: meshes.map((_, index) => index)
	});
	return { glb: buildGlb(parts), images: images.length, meshes: meshes.length };
}

/** How a room differs from the conformant one; every field left out is what the conformant room has. */
export interface RoomVariant {
	readonly look?: RoomLook;
	/** The texture sources, instead of the one PNG a textured room has. */
	readonly images?: readonly Uint8Array[];
	/** Turns the room's JSON into a counter-example. */
	readonly change?: (json: Record<string, any>) => void;
	/** Replaces the chunks or the header, as `buildGlb`'s options do. */
	readonly glb?: GlbOptions;
}

/** A GLB of the conformant room's JSON and binary chunk, varied as the variant says. */
export function buildRoomGlb({ look, images, change, glb }: RoomVariant = {}): Uint8Array {
	const parts = roomParts(look, images);
	change?.(parts.json);
	return buildGlb({ ...parts, ...glb });
}

/** A GLB of the conformant room padded in its binary chunk to exactly `size` bytes. */
export function buildRoomGlbOfSize(size: number): Uint8Array {
	const { json, binary } = roomParts();
	const padded = new Uint8Array(size - buildGlb({ json, binary }).length + binary.length);
	padded.set(binary);
	return buildGlb({ json, binary: padded });
}

/** Turns the room's meshes into: the first draws `triangles` triangles in `primitives` primitives, all sharing its one index accessor, and `drawnBy` nodes under a root draw it; the second mesh is drawn by no node. */
export function drawing({ triangles, primitives = 1, drawnBy = 1 }: { triangles: number; primitives?: number; drawnBy?: number }) {
	return (json: Record<string, any>): void => {
		const primitive = json.meshes[0].primitives[0];
		json.accessors[primitive.indices].count = 3 * triangles;
		json.meshes[0].primitives = new Array<object>(primitives).fill(primitive);
		json.nodes = [{ children: Array.from({ length: drawnBy }, (_, index) => index + 1) }, ...Array.from({ length: drawnBy }, () => ({ mesh: 0 }))];
	};
}
