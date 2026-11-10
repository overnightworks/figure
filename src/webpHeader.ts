import type { ImageSize } from './pngHeader.js';

const RIFF = 'RIFF';
const WEBP = 'WEBP';
const LOSSY_CHUNK = 'VP8 ';
const LOSSLESS_CHUNK = 'VP8L';
const EXTENDED_CHUNK = 'VP8X';
const CONTAINER_TYPE_OFFSET = 8;
const CHUNK_OFFSET = 12;
const CHUNK_SIZE_OFFSET = CHUNK_OFFSET + 4;
const PAYLOAD_OFFSET = CHUNK_OFFSET + 8;
const LOSSY_FIELDS_BYTES = 10;
const LOSSLESS_FIELDS_BYTES = 5;
const EXTENDED_FIELDS_BYTES = 10;
const LOSSY_FRAME_TAG_KEY_FRAME_MASK = 0x01;
const LOSSY_START_CODE_OFFSET = 3;
const LOSSY_START_CODE = [0x9d, 0x01, 0x2a];
const LOSSY_WIDTH_OFFSET = 6;
const LOSSY_HEIGHT_OFFSET = 8;
const LOSSY_SIDE_MASK = 0x3fff;
const LOSSLESS_SIGNATURE = 0x2f;
const LOSSLESS_SIDE_BITS = 14;
const LOSSLESS_SIDE_MASK = 0x3fff;
const EXTENDED_WIDTH_OFFSET = 4;
const EXTENDED_HEIGHT_OFFSET = 7;

function fourCharacters(bytes: Uint8Array, offset: number): string {
	return String.fromCodePoint(...bytes.subarray(offset, offset + 4));
}

function sized(width: number, height: number): ImageSize | undefined {
	return width > 0 && height > 0 ? { width, height } : undefined;
}

/**
 * Reads a WebP's stated size from the first chunk's own header (WebP container specification, RIFF file format and
 * extended file format; RFC 6386, section 9.1, for the lossy frame; WebP lossless bitstream specification, header):
 * the lossy size is the two 14-bit fields after the start code, the lossless size the two packed 14-bit fields after
 * the signature byte, each stored less one, and the extended size the 24-bit canvas fields, stored less one. Undefined
 * when the bytes are no WebP of those forms, a field does not fit the chunk or the bytes, or a lossy side is zero.
 * Nothing is decoded and the size is only returned.
 */
export function webpSize(bytes: Uint8Array): ImageSize | undefined {
	if (bytes.length < PAYLOAD_OFFSET || fourCharacters(bytes, 0) !== RIFF || fourCharacters(bytes, CONTAINER_TYPE_OFFSET) !== WEBP) {
		return undefined;
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
	const chunkType = fourCharacters(bytes, CHUNK_OFFSET);
	const fieldsBytes = fieldsBytesOf(chunkType);
	if (fieldsBytes === undefined || view.getUint32(CHUNK_SIZE_OFFSET, true) < fieldsBytes || bytes.length - PAYLOAD_OFFSET < fieldsBytes) {
		return undefined;
	}
	const payload = new DataView(bytes.buffer, bytes.byteOffset + PAYLOAD_OFFSET, fieldsBytes);
	if (chunkType === LOSSY_CHUNK) {
		return lossySize(payload);
	}
	return chunkType === LOSSLESS_CHUNK ? losslessSize(payload) : extendedSize(payload);
}

function fieldsBytesOf(chunkType: string): number | undefined {
	switch (chunkType) {
		case LOSSY_CHUNK:
			return LOSSY_FIELDS_BYTES;
		case LOSSLESS_CHUNK:
			return LOSSLESS_FIELDS_BYTES;
		case EXTENDED_CHUNK:
			return EXTENDED_FIELDS_BYTES;
		default:
			return undefined;
	}
}

function lossySize(payload: DataView): ImageSize | undefined {
	const isKeyFrame = (payload.getUint8(0) & LOSSY_FRAME_TAG_KEY_FRAME_MASK) === 0;
	const hasStartCode = LOSSY_START_CODE.every((code, index) => payload.getUint8(LOSSY_START_CODE_OFFSET + index) === code);
	if (!isKeyFrame || !hasStartCode) {
		return undefined;
	}
	return sized(payload.getUint16(LOSSY_WIDTH_OFFSET, true) & LOSSY_SIDE_MASK, payload.getUint16(LOSSY_HEIGHT_OFFSET, true) & LOSSY_SIDE_MASK);
}

function losslessSize(payload: DataView): ImageSize | undefined {
	if (payload.getUint8(0) !== LOSSLESS_SIGNATURE) {
		return undefined;
	}
	const packed = payload.getUint32(1, true);
	return { width: (packed & LOSSLESS_SIDE_MASK) + 1, height: ((packed >>> LOSSLESS_SIDE_BITS) & LOSSLESS_SIDE_MASK) + 1 };
}

function extendedSize(payload: DataView): ImageSize {
	return { width: uint24(payload, EXTENDED_WIDTH_OFFSET) + 1, height: uint24(payload, EXTENDED_HEIGHT_OFFSET) + 1 };
}

function uint24(view: DataView, offset: number): number {
	return view.getUint16(offset, true) + view.getUint8(offset + 2) * 0x10000;
}
