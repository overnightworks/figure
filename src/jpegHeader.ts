import type { ImageSize } from './pngHeader.js';

const MARKER_PREFIX = 0xff;
const START_OF_IMAGE = 0xd8;
const END_OF_IMAGE = 0xd9;
const START_OF_SCAN = 0xda;
const TEMPORARY = 0x01;
const FIRST_RESTART = 0xd0;
const LAST_RESTART = 0xd7;
const FIRST_FRAME = 0xc0;
const LAST_FRAME = 0xcf;
const NOT_FRAME_HEADERS = new Set([0xc4, 0xc8, 0xcc]);
const MARKER_BYTES = 2;
const LENGTH_FIELD_BYTES = 2;
const FRAME_FIELDS_BYTES = LENGTH_FIELD_BYTES + 1 + 2 + 2;
const HEIGHT_OFFSET = MARKER_BYTES + LENGTH_FIELD_BYTES + 1;
const WIDTH_OFFSET = HEIGHT_OFFSET + 2;

function carriesLength(marker: number): boolean {
	return marker !== TEMPORARY && marker !== START_OF_IMAGE && (marker < FIRST_RESTART || marker > LAST_RESTART);
}

function isFrameHeader(marker: number): boolean {
	return marker >= FIRST_FRAME && marker <= LAST_FRAME && !NOT_FRAME_HEADERS.has(marker);
}

function segmentLengthAt(view: DataView, position: number): number | undefined {
	if (position + MARKER_BYTES + LENGTH_FIELD_BYTES > view.byteLength) {
		return undefined;
	}
	const segmentLength = view.getUint16(position + MARKER_BYTES);
	return segmentLength >= LENGTH_FIELD_BYTES && position + MARKER_BYTES + segmentLength <= view.byteLength ? segmentLength : undefined;
}

/**
 * Reads a JPEG's stated size from the first frame header among its segments (ITU-T T.81, Annex B.1 and B.2.2): every
 * start-of-frame marker but the three table and extension markers is one. The walk takes at least two bytes per step
 * and stops at the end of the bytes; undefined when the scan or the end marker comes first, a segment length does not
 * fit, or a side is zero. Nothing is decoded and the size is only returned.
 */
export function jpegSize(bytes: Uint8Array): ImageSize | undefined {
	if (bytes.length < MARKER_BYTES || bytes[0] !== MARKER_PREFIX || bytes[1] !== START_OF_IMAGE) {
		return undefined;
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
	let position = MARKER_BYTES;
	while (position < bytes.length) {
		if (bytes[position] !== MARKER_PREFIX) {
			return undefined;
		}
		const marker = bytes[position + 1];
		if (marker === undefined) {
			return undefined;
		}
		if (marker === MARKER_PREFIX) {
			position += 1;
			continue;
		}
		if (marker === 0 || marker === END_OF_IMAGE || marker === START_OF_SCAN) {
			return undefined;
		}
		if (!carriesLength(marker)) {
			position += MARKER_BYTES;
			continue;
		}
		const segmentLength = segmentLengthAt(view, position);
		if (segmentLength === undefined) {
			return undefined;
		}
		if (isFrameHeader(marker)) {
			return frameSize(view, position, segmentLength);
		}
		position += MARKER_BYTES + segmentLength;
	}
	return undefined;
}

function frameSize(view: DataView, position: number, segmentLength: number): ImageSize | undefined {
	if (segmentLength < FRAME_FIELDS_BYTES) {
		return undefined;
	}
	const height = view.getUint16(position + HEIGHT_OFFSET);
	const width = view.getUint16(position + WIDTH_OFFSET);
	return width > 0 && height > 0 ? { width, height } : undefined;
}
