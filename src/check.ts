import type { Refusal } from './codes.js';

const GLB_HEADER_BYTES = 12;
const GLB_MAGIC = [0x67, 0x6c, 0x54, 0x46];

/** Judges a figure file from its raw bytes; the file is untrusted input and nothing in it runs. */
export function checkFigure(bytes: Uint8Array): Refusal[] {
	const hasGlbHeader =
		bytes.length >= GLB_HEADER_BYTES && GLB_MAGIC.every((magicByte, index) => bytes[index] === magicByte);
	return hasGlbHeader ? [] : [{ code: 'not_glb' }];
}
