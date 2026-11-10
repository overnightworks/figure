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
	readonly licence: {
		readonly allowRedistribution: boolean;
		readonly avatarPermission: string;
		readonly creditNotation: string;
	};
}

/** The JSON of a conformant synthetic VRM: its extension, one triangle in one indexed primitive, no binary data. */
export function buildConformantVrmJson(values: ConformantVrmValues): Record<string, any> {
	return {
		asset: { version: '2.0' },
		extensionsUsed: ['VRMC_vrm'],
		extensions: {
			VRMC_vrm: {
				specVersion: values.vrmSpecVersion,
				meta: { name: 'synthetic', authors: ['synthetic'], licenseUrl: 'https://example.invalid/licence', ...values.licence },
				humanoid: { humanBones: {} },
				expressions: { preset: Object.fromEntries(values.presets.map((name) => [name, {}])) },
				lookAt: { type: 'bone' }
			}
		},
		meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
		accessors: [
			{ componentType: 5126, count: 3, type: 'VEC3' },
			{ componentType: 5123, count: 3, type: 'SCALAR' }
		]
	};
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_HEADER_CHUNK_BYTES = 13;
const PNG_CHUNK_OVERHEAD_BYTES = 12;
const PNG_BITS_PER_CHANNEL = 8;
const PNG_COLOUR_TYPE_RGBA = 6;

function pngChunk(type: string, content: Uint8Array): Uint8Array {
	const bytes = new Uint8Array(PNG_CHUNK_OVERHEAD_BYTES + content.length);
	new DataView(bytes.buffer).setUint32(0, content.length);
	bytes.set(new TextEncoder().encode(type), 4);
	bytes.set(content, 8);
	return bytes;
}

/** Writes a synthetic PNG: the signature, a header chunk stating the size, an end chunk; it holds no pixel data, whatever the size. */
export function buildPng(width: number, height: number): Uint8Array {
	const header = new Uint8Array(PNG_HEADER_CHUNK_BYTES);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header[8] = PNG_BITS_PER_CHANNEL;
	header[9] = PNG_COLOUR_TYPE_RGBA;
	const parts = [Uint8Array.from(PNG_SIGNATURE), pngChunk('IHDR', header), pngChunk('IEND', new Uint8Array())];
	const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.length;
	}
	return bytes;
}

/** Adds one buffer view and one image to `json` for each image, back to back in the binary chunk the call returns. */
export function embedImages(json: Record<string, any>, images: readonly Uint8Array[]): Uint8Array {
	const binary = new Uint8Array(images.reduce((sum, image) => sum + image.length, 0));
	json.buffers = [{ byteLength: binary.length }];
	json.bufferViews = [];
	json.images = [];
	let offset = 0;
	for (const image of images) {
		binary.set(image, offset);
		json.images.push({ bufferView: json.bufferViews.length, mimeType: 'image/png' });
		json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: image.length });
		offset += image.length;
	}
	return binary;
}

/** The conformant synthetic VRM as a GLB: its JSON and one small PNG in the binary chunk. */
export function buildConformantVrmGlb(values: ConformantVrmValues): Uint8Array {
	const json = buildConformantVrmJson(values);
	const binary = embedImages(json, [buildPng(1, 1)]);
	return buildGlb({ json, binary });
}
