import { describe, expect, it } from 'vitest';
import { checkFigure } from './check.js';
import { buildGlb } from '../tests/glbBuilder.js';

describe('checkFigure', () => {
	it('passes a synthetic GLB', () => {
		expect(checkFigure(buildGlb())).toEqual([]);
	});

	it('passes a GLB that is exactly its 12-byte header', () => {
		expect(checkFigure(buildGlb().subarray(0, 12))).toEqual([]);
	});

	it.each([
		['an empty file', new Uint8Array()],
		['a file one byte short of the header', buildGlb().subarray(0, 11)],
		['a text file', new TextEncoder().encode('this is not a model at all')],
		['a header with the wrong magic', Uint8Array.from(buildGlb(), (byte, index) => (index === 3 ? 0x00 : byte))],
		['a short file with the right magic', buildGlb().subarray(0, 4)]
	])('refuses %s as not_glb', (_name, bytes) => {
		expect(checkFigure(bytes)).toEqual([{ code: 'not_glb' }]);
	});
});
