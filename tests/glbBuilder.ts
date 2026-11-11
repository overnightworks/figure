// The `.ts` extension lets Node run this file without a build, as scripts/write_conformant_figure.mjs does.
import {
	BUFFER_TARGET,
	BinaryPacker,
	COMPONENT_TYPE,
	figureSkeleton,
	inverseBindMatrix,
	morphDeltas,
	skinnedBox,
	worldPositions,
	type AccessorSpec,
	type Bone,
	type MeshData,
	type Vector3
} from './figureModel.ts';

const JSON_CHUNK_TYPE = 0x4e4f534a;
const BINARY_CHUNK_TYPE = 0x004e4942;
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

/** What a counter-example changes; every field left out is what a conformant file has. */
export interface GlbOptions {
	/** The JSON chunk's content, serialised; any value, so a test can write an array or a number. */
	readonly json?: unknown;
	/** The JSON chunk's content as raw bytes, for text that is not valid JSON or not valid UTF-8. */
	readonly jsonBytes?: Uint8Array;
	readonly version?: number;
	/** The header's length field instead of the file's real length. */
	readonly declaredLength?: number;
	/** The first chunk's type field instead of the JSON type. */
	readonly firstChunkType?: number;
	/** The JSON chunk's length field instead of its real length. */
	readonly jsonChunkLengthField?: number;
	/** The content of a binary chunk after the JSON chunk. */
	readonly binary?: Uint8Array;
	/** The binary chunk's length field instead of its real length. */
	readonly binaryChunkLengthField?: number;
	/** Bytes appended after the last chunk, counted in the header's length. */
	readonly trailing?: Uint8Array;
}

function chunk(type: number, content: Uint8Array, lengthField: number | undefined): Uint8Array {
	const bytes = new Uint8Array(CHUNK_HEADER_BYTES + content.length);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, lengthField ?? bytes.length - CHUNK_HEADER_BYTES, true);
	view.setUint32(4, type, true);
	bytes.set(content, CHUNK_HEADER_BYTES);
	return bytes;
}

/** Writes a synthetic GLB: the 12-byte header, a JSON chunk padded with spaces, then an optional binary chunk (unpadded, so a size can be exact). */
export function buildGlb(options: GlbOptions = {}): Uint8Array {
	const jsonBytes =
		options.jsonBytes ?? new TextEncoder().encode(JSON.stringify(options.json === undefined ? { asset: { version: '2.0' } } : options.json));
	const paddedJsonBytes = new Uint8Array(Math.ceil(jsonBytes.length / 4) * 4).fill(0x20);
	paddedJsonBytes.set(jsonBytes);
	const parts = [
		chunk(options.firstChunkType ?? JSON_CHUNK_TYPE, paddedJsonBytes, options.jsonChunkLengthField),
		...(options.binary === undefined
			? []
			: [chunk(BINARY_CHUNK_TYPE, options.binary, options.binaryChunkLengthField)]),
		options.trailing ?? new Uint8Array()
	];
	const bytes = new Uint8Array(HEADER_BYTES + parts.reduce((sum, part) => sum + part.length, 0));
	const view = new DataView(bytes.buffer);
	bytes.set(new TextEncoder().encode('glTF'), 0);
	view.setUint32(4, options.version ?? 2, true);
	view.setUint32(8, options.declaredLength ?? bytes.length, true);
	let offset = HEADER_BYTES;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.length;
	}
	return bytes;
}

/** A GLB that is only its header, with the length field naming exactly those 12 bytes. */
export function buildHeaderOnlyGlb(): Uint8Array {
	return buildGlb().subarray(0, HEADER_BYTES).map((byte, index) => (index === 8 ? HEADER_BYTES : byte));
}

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
const HEAD_HALF_SIZE: Vector3 = [0.12, 0.12, 0.12];
const HEAD_CENTRE: Vector3 = [0, 1.65, 0];
const BLINK_OFFSET: Vector3 = [0, -0.03, 0];
const FRONT_FACE_NORMAL_Z = 1;

interface SkinnedMesh {
	readonly name: string;
	readonly data: MeshData;
	/** What each morph target moves: per target, the offset of every vertex, as flat X, Y, Z values. */
	readonly morphs: readonly (readonly number[])[];
}

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

/** The joints of the skin, in the order of its `joints`; the torso is skinned to the first two, the head to the third. */
const SKIN_JOINT_NAMES = ['spine', 'chest', 'head'] as const;

function skinnedMeshes(chestHeight: number, heavy?: HeavyFigure): SkinnedMesh[] {
	const torso = skinnedBox(TORSO_CENTRE, TORSO_HALF_SIZE, (position) => (position[1]! < chestHeight ? 0 : 1));
	const head = skinnedBox(HEAD_CENTRE, HEAD_HALF_SIZE, () => 2);
	const upperFront = (vertex: number) =>
		head.normals[3 * vertex + 2] === FRONT_FACE_NORMAL_Z && head.positions[3 * vertex + 1]! > HEAD_CENTRE[1];
	const meshes: SkinnedMesh[] = [
		{ name: 'torso', data: torso, morphs: [] },
		{ name: 'head', data: head, morphs: [morphDeltas(head.positions.length / 3, upperFront, BLINK_OFFSET)] }
	];
	if (heavy === undefined) return meshes;
	const lightTriangles = meshes.reduce((sum, { data }) => sum + data.indices.length / 3, 0);
	const data = heavyMesh(heavy.triangles - lightTriangles);
	const vertexCount = data.positions.length / 3;
	const morphs = Array.from({ length: heavy.morphTargets }, (_, target) =>
		morphDeltas(vertexCount, () => true, [0, HEAVY_MORPH_STEP * (target + 1), 0])
	);
	return [...meshes, { name: 'heavy', data, morphs }];
}

function addPrimitive(packer: BinaryPacker, { data, morphs }: SkinnedMesh): Record<string, unknown> {
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
		material: 0,
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

function skeletonNodes(skeleton: readonly Bone[]) {
	return skeleton.map(({ name, translation }, index) => {
		const children = skeleton.flatMap((child, childIndex) => (child.parent === index ? [childIndex] : []));
		return { name, translation, ...(children.length === 0 ? {} : { children }) };
	});
}

/**
 * The conformant synthetic VRM's JSON and binary chunk: a skeleton with chest and neck, two skinned boxes, a blink morph target
 * bound by the `blink` preset, a core material with a base colour texture, and `images` (by default the figure's PNG) as the texture sources.
 * With `heavy`, a third mesh of grid triangles carries the morph targets and the meshes together hold the triangles it names.
 */
export function buildConformantVrmParts(
	values: ConformantVrmValues,
	images: readonly Uint8Array[] = [buildFigureTexturePng()],
	heavy?: HeavyFigure
): { json: Record<string, any>; binary: Uint8Array } {
	const skeleton = figureSkeleton();
	requireBones(skeleton, values.requiredHumanBones);
	const boneIndex = (name: string) => skeleton.findIndex((bone) => bone.name === name);
	const positions = worldPositions(skeleton);
	const packer = new BinaryPacker();
	const imageEntries = addImages(packer, images);
	const meshes = skinnedMeshes(positions[boneIndex('chest')]![1], heavy);
	const meshEntries = meshes.map((mesh) => ({ name: mesh.name, primitives: [addPrimitive(packer, mesh)] }));
	const jointNodes = SKIN_JOINT_NAMES.map(boneIndex);
	const inverseBindMatrices = packer.addAccessor({
		values: jointNodes.flatMap((node) => inverseBindMatrix(positions[node]!)),
		componentType: COMPONENT_TYPE.float,
		type: 'MAT4'
	});
	const meshNodes = meshes.map((mesh, meshIndex) => ({ name: `${mesh.name}Mesh`, mesh: meshIndex, skin: 0 }));
	const nodes = [...skeletonNodes(skeleton), ...meshNodes];
	const headMeshNode = skeleton.length + meshes.findIndex(({ name }) => name === 'head');
	return {
		json: {
			asset: { version: '2.0' },
			extensionsUsed: ['VRMC_vrm'],
			extensions: {
				VRMC_vrm: {
					specVersion: values.vrmSpecVersion,
					meta: { name: 'synthetic', authors: ['synthetic'], licenseUrl: 'https://example.invalid/licence', ...values.licence },
					humanoid: { humanBones: Object.fromEntries(skeleton.map(({ name }, node) => [name, { node }])) },
					expressions: {
						preset: Object.fromEntries(
							values.presets.map((name) => [name, name === 'blink' ? { morphTargetBinds: [{ node: headMeshNode, index: 0, weight: 1 }] } : {}])
						)
					},
					lookAt: { type: 'bone' }
				}
			},
			scene: 0,
			scenes: [{ nodes: [0, ...meshNodes.map((_, index) => skeleton.length + index)] }],
			nodes,
			skins: [{ inverseBindMatrices, skeleton: 0, joints: jointNodes }],
			meshes: meshEntries,
			materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
			textures: [{ source: 0 }],
			images: imageEntries,
			buffers: [{ byteLength: packer.byteLength }],
			bufferViews: packer.bufferViews,
			accessors: packer.accessors
		},
		binary: packer.toBytes()
	};
}

/** The JSON of the conformant synthetic VRM; see `buildConformantVrmParts`. */
export function buildConformantVrmJson(values: ConformantVrmValues): Record<string, any> {
	return buildConformantVrmParts(values).json;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_HEADER_CHUNK_BYTES = 13;
const PNG_CHUNK_OVERHEAD_BYTES = 12;
const PNG_BITS_PER_CHANNEL = 8;
const PNG_COLOUR_TYPE_RGBA = 6;

const CRC_POLYNOMIAL = 0xedb88320;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
	let remainder = value;
	for (let bit = 0; bit < 8; bit++) {
		remainder = remainder & 1 ? CRC_POLYNOMIAL ^ (remainder >>> 1) : remainder >>> 1;
	}
	return remainder >>> 0;
});

/** The CRC-32 of PNG specification section 5.5, over a chunk's type and content. */
function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

const ADLER_MODULUS = 65521;

/** The Adler-32 that ends a zlib stream (RFC 1950, section 8.2). */
function adler32(bytes: Uint8Array): number {
	let low = 1;
	let high = 0;
	for (const byte of bytes) {
		low = (low + byte) % ADLER_MODULUS;
		high = (high + low) % ADLER_MODULUS;
	}
	return ((high << 16) | low) >>> 0;
}

function pngChunk(type: string, content: Uint8Array): Uint8Array {
	const bytes = new Uint8Array(PNG_CHUNK_OVERHEAD_BYTES + content.length);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, content.length);
	bytes.set(new TextEncoder().encode(type), 4);
	bytes.set(content, 8);
	view.setUint32(8 + content.length, crc32(bytes.subarray(4, 8 + content.length)));
	return bytes;
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
	const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.length;
	}
	return bytes;
}

const STORED_BLOCK_MAX_BYTES = 0xffff;
const ZLIB_HEADER = [0x78, 0x01];
const FINAL_STORED_BLOCK = 0x01;

/** A zlib stream (RFC 1950) holding `data` in one stored deflate block (RFC 1951, section 3.2.4), so no compressor is needed. */
function storedZlibStream(data: Uint8Array): Uint8Array {
	if (data.length > STORED_BLOCK_MAX_BYTES) {
		throw new RangeError(`a stored block holds at most ${STORED_BLOCK_MAX_BYTES} bytes, not ${data.length}`);
	}
	const bytes = new Uint8Array(ZLIB_HEADER.length + 5 + data.length + 4);
	const view = new DataView(bytes.buffer);
	bytes.set(ZLIB_HEADER, 0);
	bytes[2] = FINAL_STORED_BLOCK;
	view.setUint16(3, data.length, true);
	view.setUint16(5, ~data.length & 0xffff, true);
	bytes.set(data, 7);
	view.setUint32(7 + data.length, adler32(data));
	return bytes;
}

function pngHeaderContent(width: number, height: number): Uint8Array {
	const header = new Uint8Array(PNG_HEADER_CHUNK_BYTES);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header[8] = PNG_BITS_PER_CHANNEL;
	header[9] = PNG_COLOUR_TYPE_RGBA;
	return header;
}

/** One colour, red, green, blue and alpha, each 0 to 255. */
export type Rgba = readonly [number, number, number, number];

/** The pixels of the figure's texture: its size and its one colour, which the browser layer and the decoding tests read back. */
export const figureTexture: { readonly width: number; readonly height: number; readonly colour: Rgba } = {
	width: 4,
	height: 2,
	colour: [200, 120, 80, 255]
};

/** The scanlines of an image of one colour: each row is a filter type byte of 0, then the row's pixels. */
export function plainScanlines(width: number, height: number, colour: Rgba): Uint8Array {
	const row = Uint8Array.from([0, ...Array.from({ length: width }, () => colour).flat()]);
	return concatenate(Array.from({ length: height }, () => row));
}

/** Writes a PNG that a decoder reads: every pixel is `colour`, the image data is one stored deflate block, every chunk has its CRC. */
export function buildImagePng(width: number, height: number, colour: Rgba): Uint8Array {
	return concatenate([
		Uint8Array.from(PNG_SIGNATURE),
		pngChunk('IHDR', pngHeaderContent(width, height)),
		pngChunk('IDAT', storedZlibStream(plainScanlines(width, height, colour))),
		pngChunk('IEND', new Uint8Array())
	]);
}

const LENGTH_CODE_BASES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_CODE_EXTRA_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_CODE_BASES = [
	1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577
];
const DISTANCE_CODE_EXTRA_BITS = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const FIRST_LENGTH_SYMBOL = 257;
const END_OF_BLOCK_SYMBOL = 256;
const LONGEST_MATCH = 258;
const SHORTEST_MATCH = 3;
const FIXED_BLOCK_TYPE = 1;

/** The last code whose base does not exceed `value`. */
function codeOf(bases: readonly number[], value: number): number {
	return bases.filter((base) => base <= value).length - 1;
}

/** Packs bits into bytes from the least significant bit, as deflate does; Huffman codes go in from their most significant bit. */
class BitWriter {
	private readonly bytes: number[] = [];
	private pending = 0;
	private pendingBits = 0;

	writeValue(value: number, bitCount: number): void {
		for (let bit = 0; bit < bitCount; bit++) {
			this.pending |= ((value >> bit) & 1) << this.pendingBits;
			if (++this.pendingBits === 8) {
				this.bytes.push(this.pending);
				this.pending = 0;
				this.pendingBits = 0;
			}
		}
	}

	writeCode(code: number, bitCount: number): void {
		for (let bit = bitCount - 1; bit >= 0; bit--) {
			this.writeValue((code >> bit) & 1, 1);
		}
	}

	/** The bytes written, the last one filled up with zero bits. */
	finish(): Uint8Array {
		return Uint8Array.from(this.pendingBits === 0 ? this.bytes : [...this.bytes, this.pending]);
	}
}

/** The fixed Huffman code of a literal or length symbol (RFC 1951, section 3.2.6). */
function writeFixedSymbol(writer: BitWriter, symbol: number): void {
	if (symbol < 144) writer.writeCode(0x30 + symbol, 8);
	else if (symbol < 256) writer.writeCode(0x190 + symbol - 144, 9);
	else if (symbol < 280) writer.writeCode(symbol - 256, 7);
	else writer.writeCode(0xc0 + symbol - 280, 8);
}

/**
 * A zlib stream (RFC 1950) of `data`, which must repeat its first `period` bytes throughout: one fixed-Huffman block (RFC 1951, section
 * 3.2.6) holding the first period as literals and the rest as matches at that distance, so no compressor is needed and an image of one
 * colour takes a few bytes a row.
 */
function repeatingZlibStream(data: Uint8Array, period: number): Uint8Array {
	const writer = new BitWriter();
	writer.writeValue(1, 1);
	writer.writeValue(FIXED_BLOCK_TYPE, 2);
	let position = 0;
	for (; position < Math.min(period, data.length); position++) writeFixedSymbol(writer, data[position]!);
	while (data.length - position >= SHORTEST_MATCH) {
		const length = Math.min(LONGEST_MATCH, data.length - position);
		const lengthCode = codeOf(LENGTH_CODE_BASES, length);
		writeFixedSymbol(writer, FIRST_LENGTH_SYMBOL + lengthCode);
		writer.writeValue(length - LENGTH_CODE_BASES[lengthCode]!, LENGTH_CODE_EXTRA_BITS[lengthCode]!);
		const distanceCode = codeOf(DISTANCE_CODE_BASES, period);
		writer.writeCode(distanceCode, 5);
		writer.writeValue(period - DISTANCE_CODE_BASES[distanceCode]!, DISTANCE_CODE_EXTRA_BITS[distanceCode]!);
		position += length;
	}
	for (; position < data.length; position++) writeFixedSymbol(writer, data[position]!);
	writeFixedSymbol(writer, END_OF_BLOCK_SYMBOL);
	const deflated = writer.finish();
	const bytes = new Uint8Array(ZLIB_HEADER.length + deflated.length + 4);
	bytes.set(ZLIB_HEADER, 0);
	bytes.set(deflated, ZLIB_HEADER.length);
	new DataView(bytes.buffer).setUint32(bytes.length - 4, adler32(data));
	return bytes;
}

/** Writes a PNG of `width` by `height` pixels of one colour whose image data is compressed to runs, so its bytes stay few at any size. */
export function buildCompressedImagePng(width: number, height: number, colour: Rgba): Uint8Array {
	const scanlines = plainScanlines(width, height, colour);
	return concatenate([
		Uint8Array.from(PNG_SIGNATURE),
		pngChunk('IHDR', pngHeaderContent(width, height)),
		pngChunk('IDAT', repeatingZlibStream(scanlines, 1 + 4 * width)),
		pngChunk('IEND', new Uint8Array())
	]);
}

/** The figure's texture as a PNG. */
export function buildFigureTexturePng(): Uint8Array {
	return buildImagePng(figureTexture.width, figureTexture.height, figureTexture.colour);
}

/** Writes a synthetic PNG: the signature, a header chunk stating the size, an end chunk; it holds no pixel data, whatever the size. */
export function buildPng(width: number, height: number): Uint8Array {
	return concatenate([Uint8Array.from(PNG_SIGNATURE), pngChunk('IHDR', pngHeaderContent(width, height)), pngChunk('IEND', new Uint8Array())]);
}

const JPEG_MARKER_PREFIX = 0xff;
const JPEG_START_OF_IMAGE = 0xd8;
const JPEG_END_OF_IMAGE = 0xd9;
const JPEG_APPLICATION_0 = 0xe0;
const JPEG_BASELINE_FRAME = 0xc0;
const JPEG_PROGRESSIVE_FRAME = 0xc2;
const JPEG_SAMPLE_PRECISION_BITS = 8;
const JPEG_LENGTH_FIELD_BYTES = 2;

/** One JPEG segment: the marker, then the length field (which counts itself) and the content; `lengthField` replaces the true length. */
export function jpegSegment(marker: number, content: Uint8Array, lengthField?: number): Uint8Array {
	const bytes = new Uint8Array(2 + JPEG_LENGTH_FIELD_BYTES + content.length);
	bytes[0] = JPEG_MARKER_PREFIX;
	bytes[1] = marker;
	new DataView(bytes.buffer).setUint16(2, lengthField ?? JPEG_LENGTH_FIELD_BYTES + content.length);
	bytes.set(content, 4);
	return bytes;
}

/** The content of a frame header: precision, height, width and one component; `kind` picks baseline or progressive. */
export function jpegFrameSegment(width: number, height: number, kind: 'baseline' | 'progressive' = 'baseline'): Uint8Array {
	const content = new Uint8Array(6 + 3);
	const view = new DataView(content.buffer);
	content[0] = JPEG_SAMPLE_PRECISION_BITS;
	view.setUint16(1, height);
	view.setUint16(3, width);
	content[5] = 1;
	return jpegSegment(kind === 'baseline' ? JPEG_BASELINE_FRAME : JPEG_PROGRESSIVE_FRAME, content);
}

/** Joins the parts: a start marker, the segments, an end marker; it holds no scan data. */
export function buildJpegFromSegments(segments: readonly Uint8Array[]): Uint8Array {
	const parts = [Uint8Array.of(JPEG_MARKER_PREFIX, JPEG_START_OF_IMAGE), ...segments, Uint8Array.of(JPEG_MARKER_PREFIX, JPEG_END_OF_IMAGE)];
	const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.length;
	}
	return bytes;
}

/** Writes a synthetic JPEG: start marker, an application segment, a frame header stating the size, an end marker; it holds no pixel data. */
export function buildJpeg(width: number, height: number, kind: 'baseline' | 'progressive' = 'baseline'): Uint8Array {
	return buildJpegFromSegments([jpegSegment(JPEG_APPLICATION_0, new Uint8Array(5)), jpegFrameSegment(width, height, kind)]);
}

export type WebpForm = 'lossy' | 'lossless' | 'extended';

/** What a WebP counter-example changes; every field left out is what a conformant header has. */
export interface WebpOptions {
	readonly riffType?: string;
	readonly chunkType?: string;
	/** The three start-code bytes of a lossy chunk. */
	readonly startCode?: readonly number[];
	/** The signature byte of a lossless chunk. */
	readonly signature?: number;
	/** The first chunk's size field instead of the header fields' real length. */
	readonly chunkSizeField?: number;
}

const WEBP_CHUNK_TYPES: Record<WebpForm, string> = { lossy: 'VP8 ', lossless: 'VP8L', extended: 'VP8X' };
const WEBP_LOSSY_START_CODE = [0x9d, 0x01, 0x2a];
const WEBP_LOSSLESS_SIGNATURE = 0x2f;

function webpPayload(form: WebpForm, width: number, height: number, options: WebpOptions): Uint8Array {
	if (form === 'lossy') {
		const payload = new Uint8Array(10);
		payload.set(options.startCode ?? WEBP_LOSSY_START_CODE, 3);
		new DataView(payload.buffer).setUint16(6, width, true);
		new DataView(payload.buffer).setUint16(8, height, true);
		return payload;
	}
	if (form === 'lossless') {
		const payload = new Uint8Array(5);
		payload[0] = options.signature ?? WEBP_LOSSLESS_SIGNATURE;
		new DataView(payload.buffer).setUint32(1, ((width - 1) | ((height - 1) << 14)) >>> 0, true);
		return payload;
	}
	const payload = new Uint8Array(10);
	for (const [index, value] of [width - 1, height - 1].entries()) {
		for (let byte = 0; byte < 3; byte++) {
			payload[4 + 3 * index + byte] = (value >> (8 * byte)) & 0xff;
		}
	}
	return payload;
}

/** Writes a synthetic WebP header of one of the three forms: the container and the first chunk's header fields, without pixel data. */
export function buildWebp(form: WebpForm, width: number, height: number, options: WebpOptions = {}): Uint8Array {
	const payload = webpPayload(form, width, height, options);
	const bytes = new Uint8Array(20 + payload.length);
	const view = new DataView(bytes.buffer);
	const text = new TextEncoder();
	bytes.set(text.encode('RIFF'), 0);
	view.setUint32(4, bytes.length - 8, true);
	bytes.set(text.encode(options.riffType ?? 'WEBP'), 8);
	bytes.set(text.encode(options.chunkType ?? WEBP_CHUNK_TYPES[form]), 12);
	view.setUint32(16, options.chunkSizeField ?? payload.length, true);
	bytes.set(payload, 20);
	return bytes;
}

/** The conformant synthetic VRM as a GLB: its JSON and binary chunk. */
export function buildConformantVrmGlb(values: ConformantVrmValues): Uint8Array {
	return buildGlb(buildConformantVrmParts(values));
}

/** The limits a figure at the budgets fills; the caller reads them from the profile. */
export interface FigureBudgets {
	readonly fileBudgetBytes: number;
	readonly maxTriangles: number;
	readonly maxMorphTargetsPerPrimitive: number;
	readonly maxTextureSidePixels: number;
	readonly maxTexels: number;
}

/** The sides of the images that together hold exactly `texels`, none longer than `maxSide`: full squares of that side while they fit, then what is left. */
function imageSizesFilling(texels: number, maxSide: number): [number, number][] {
	const sizes: [number, number][] = [];
	for (let left = texels; left > 0; ) {
		const width = Math.min(maxSide, left);
		const height = Math.min(maxSide, Math.floor(left / width));
		sizes.push([width, height]);
		left -= width * height;
	}
	return sizes;
}

/**
 * A conformant VRM at the budgets: textures filling the texel budget, the triangle budget in its meshes, and as many morph targets on one
 * mesh as the file budget leaves, at most the budget a primitive. It reports what it holds, so a caller need not read it back.
 */
export function buildBudgetVrm(values: ConformantVrmValues, budgets: FigureBudgets): { glb: Uint8Array; morphTargets: number } {
	const colour = figureTexture.colour;
	const images = imageSizesFilling(budgets.maxTexels, budgets.maxTextureSidePixels).map(([width, height]) => buildCompressedImagePng(width, height, colour));
	const buildWith = (morphTargets: number) =>
		buildGlb(buildConformantVrmParts(values, images, { triangles: budgets.maxTriangles, morphTargets }));
	const withoutMorphs = buildWith(0).length;
	const perTarget = buildWith(1).length - withoutMorphs;
	let morphTargets = Math.min(budgets.maxMorphTargetsPerPrimitive, Math.floor((budgets.fileBudgetBytes - withoutMorphs) / perTarget));
	let glb = buildWith(morphTargets);
	while (glb.length > budgets.fileBudgetBytes && morphTargets > 0) glb = buildWith(--morphTargets);
	return { glb, morphTargets };
}
