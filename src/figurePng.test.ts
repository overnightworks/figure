import { crc32, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildFigureTexturePng, buildImagePng, figureTexture } from '../tests/glbBuilder.js';

const signatureBytes = 8;
const chunkOverheadBytes = 12;

interface PngChunk {
	readonly type: string;
	readonly content: Buffer;
	readonly storedCrc: number;
	readonly checkedBytes: Buffer;
}

/** Splits a PNG into chunks by the layout of the PNG specification, section 5.3, so a test does not call the builder's own writer. */
function chunksOf(png: Uint8Array): PngChunk[] {
	const bytes = Buffer.from(png);
	const chunks: PngChunk[] = [];
	for (let offset = signatureBytes; offset < bytes.length; ) {
		const length = bytes.readUInt32BE(offset);
		chunks.push({
			type: bytes.toString('latin1', offset + 4, offset + 8),
			content: bytes.subarray(offset + 8, offset + 8 + length),
			storedCrc: bytes.readUInt32BE(offset + 8 + length),
			checkedBytes: bytes.subarray(offset + 4, offset + 8 + length)
		});
		offset += chunkOverheadBytes + length;
	}
	return chunks;
}

describe('the figure texture PNG', () => {
	const png = buildFigureTexturePng();
	const chunks = chunksOf(png);

	it('starts with the PNG signature and holds the header, the image data and the end, in that order', () => {
		expect(Buffer.from(png.subarray(0, signatureBytes))).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
		expect(chunks.map(({ type }) => type)).toEqual(['IHDR', 'IDAT', 'IEND']);
	});

	it('carries a correct checksum on every chunk', () => {
		for (const { checkedBytes, storedCrc } of chunks) {
			expect(storedCrc).toBe(crc32(checkedBytes));
		}
	});

	it('states the texture size as 8-bit RGBA without interlacing', () => {
		const header = chunks[0]!.content;
		expect([header.readUInt32BE(0), header.readUInt32BE(4)]).toEqual([figureTexture.width, figureTexture.height]);
		expect([...header.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
	});

	it('inflates to unfiltered rows of the texture colour only', () => {
		const row = [0, ...Array.from({ length: figureTexture.width }, () => figureTexture.colour).flat()];
		const expected = Array.from({ length: figureTexture.height }, () => row).flat();
		expect([...inflateSync(chunks[1]!.content)]).toEqual(expected);
	});
});

describe('a PNG written by the builder', () => {
	it('refuses image data that does not fit one stored block', () => {
		expect(() => buildImagePng(128, 128, [0, 0, 0, 255])).toThrow(RangeError);
	});
});
