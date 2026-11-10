const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const HEADER_CHUNK_TYPE = [0x49, 0x48, 0x44, 0x52];
const HEADER_CHUNK_LENGTH = 13;
const LENGTH_FIELD_OFFSET = SIGNATURE.length;
const TYPE_FIELD_OFFSET = LENGTH_FIELD_OFFSET + 4;
const WIDTH_OFFSET = TYPE_FIELD_OFFSET + 4;
const HEIGHT_OFFSET = WIDTH_OFFSET + 4;
const SIZED_BYTES = HEIGHT_OFFSET + 4;

export interface ImageSize {
	readonly width: number;
	readonly height: number;
}

/**
 * Reads a PNG's stated size from its signature and its header chunk (PNG specification, sections 5.2 and 11.2.2);
 * undefined when the bytes are not that or a side is zero. Nothing is decoded and the size is only returned.
 */
export function pngSize(bytes: Uint8Array): ImageSize | undefined {
	if (bytes.length < SIZED_BYTES) {
		return undefined;
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
	const isHeaderChunk =
		SIGNATURE.every((signatureByte, index) => bytes[index] === signatureByte) &&
		view.getUint32(LENGTH_FIELD_OFFSET) === HEADER_CHUNK_LENGTH &&
		HEADER_CHUNK_TYPE.every((typeByte, index) => bytes[TYPE_FIELD_OFFSET + index] === typeByte);
	const width = view.getUint32(WIDTH_OFFSET);
	const height = view.getUint32(HEIGHT_OFFSET);
	return isHeaderChunk && width > 0 && height > 0 ? { width, height } : undefined;
}
