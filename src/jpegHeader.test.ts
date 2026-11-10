import { describe, expect, it } from 'vitest';
import { jpegSize } from './jpegHeader.js';
import { buildJpeg, buildJpegFromSegments, jpegFrameSegment, jpegSegment } from '../tests/glbBuilder.js';

const COMMENT = 0xfe;
const START_OF_SCAN = 0xda;
const HUFFMAN_TABLE = 0xc4;
const RESTART_0 = 0xd0;
const STANDALONE_TEMPORARY = 0x01;
const NO_CONTENT = new Uint8Array();

describe('the size of a JPEG', () => {
	it.each([
		['baseline', buildJpeg(640, 480), { width: 640, height: 480 }],
		['progressive', buildJpeg(300, 200, 'progressive'), { width: 300, height: 200 }],
		['the largest sides', buildJpeg(0xffff, 0xffff), { width: 0xffff, height: 0xffff }],
		[
			'a frame header after several other segments',
			buildJpegFromSegments([
				jpegSegment(COMMENT, new Uint8Array(7)),
				jpegSegment(HUFFMAN_TABLE, new Uint8Array(20)),
				jpegSegment(COMMENT, NO_CONTENT),
				jpegFrameSegment(33, 44)
			]),
			{ width: 33, height: 44 }
		],
		[
			'fill bytes before a marker',
			buildJpegFromSegments([Uint8Array.of(0xff, 0xff, 0xff), jpegFrameSegment(5, 6)]),
			{ width: 5, height: 6 }
		],
		[
			'markers that carry no length',
			buildJpegFromSegments([Uint8Array.of(0xff, STANDALONE_TEMPORARY, 0xff, RESTART_0), jpegFrameSegment(7, 8)]),
			{ width: 7, height: 8 }
		]
	])('reads %s', (_name, bytes, size) => {
		expect(jpegSize(bytes)).toEqual(size);
	});

	it.each([
		['bytes that do not start with the start marker', () => buildJpeg(1, 1).subarray(1)],
		['an empty image', () => new Uint8Array()],
		['only the start marker', () => buildJpeg(1, 1).subarray(0, 2)],
		['a single byte after the start marker', () => buildJpeg(1, 1).subarray(0, 3)],
		['no frame header before the scan', () => buildJpegFromSegments([jpegSegment(START_OF_SCAN, new Uint8Array(6)), jpegFrameSegment(1, 1)])],
		['no frame header before the end marker', () => buildJpegFromSegments([jpegSegment(COMMENT, new Uint8Array(3))])],
		['no frame header before the end of the bytes', () => buildJpegFromSegments([jpegSegment(COMMENT, new Uint8Array(3))]).subarray(0, 9)],
		['a table marker that is not a frame header', () => buildJpegFromSegments([jpegSegment(HUFFMAN_TABLE, new Uint8Array(20))])],
		['a segment length past the end', () => buildJpegFromSegments([jpegSegment(COMMENT, new Uint8Array(3), 500), jpegFrameSegment(1, 1)])],
		['a segment length of one', () => buildJpegFromSegments([jpegSegment(COMMENT, new Uint8Array(3), 1), jpegFrameSegment(1, 1)])],
		['a segment length of zero', () => buildJpegFromSegments([jpegSegment(COMMENT, new Uint8Array(3), 0), jpegFrameSegment(1, 1)])],
		['a segment length field cut off', () => Uint8Array.of(0xff, 0xd8, 0xff, 0xfe, 0x00)],
		['a byte where a marker should be', () => buildJpegFromSegments([Uint8Array.of(0x12, 0x34), jpegFrameSegment(1, 1)])],
		['a marker prefix followed by zero', () => buildJpegFromSegments([Uint8Array.of(0xff, 0x00), jpegFrameSegment(1, 1)])],
		['fill bytes up to the end of the bytes', () => Uint8Array.of(0xff, 0xd8, 0xff, 0xff, 0xff)],
		['bytes cut inside the frame header', () => buildJpeg(1, 1).subarray(0, buildJpeg(1, 1).length - 5)],
		['a frame header too short to hold its fields', () => buildJpegFromSegments([jpegSegment(0xc0, new Uint8Array(3))])],
		['a width of zero', () => buildJpeg(0, 1)],
		['a height of zero', () => buildJpeg(1, 0)]
	])('gives nothing for %s', (_name, build) => {
		expect(jpegSize(build())).toBeUndefined();
	});
});
