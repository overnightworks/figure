const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;

/** Writes a synthetic GLB: the 12-byte header and one JSON chunk, padded with spaces to four bytes. */
export function buildGlb(json: object = { asset: { version: '2.0' } }): Uint8Array {
	const padded = new TextEncoder().encode(JSON.stringify(json));
	const chunkBytes = Math.ceil(padded.length / 4) * 4;
	const bytes = new Uint8Array(12 + 8 + chunkBytes).fill(0x20);
	const view = new DataView(bytes.buffer);
	bytes.set(new TextEncoder().encode('glTF'), 0);
	view.setUint32(4, GLB_VERSION, true);
	view.setUint32(8, bytes.length, true);
	view.setUint32(12, chunkBytes, true);
	view.setUint32(16, JSON_CHUNK_TYPE, true);
	bytes.set(padded, 20);
	return bytes;
}
