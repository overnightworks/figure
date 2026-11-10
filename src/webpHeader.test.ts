import { describe, expect, it } from 'vitest';
import { webpSize } from './webpHeader.js';
import { buildWebp, type WebpForm } from '../tests/glbBuilder.js';

const forms: WebpForm[] = ['lossy', 'lossless', 'extended'];

describe('the size of a WebP', () => {
	it.each(forms)('reads the %s form', (form) => {
		expect(webpSize(buildWebp(form, 640, 480))).toEqual({ width: 640, height: 480 });
	});

	it.each(forms)('reads the %s form at a side of one and at the largest the form states', (form) => {
		expect(webpSize(buildWebp(form, 1, 1))).toEqual({ width: 1, height: 1 });
		expect(webpSize(buildWebp(form, form === 'lossy' ? 16383 : 16384, 2))).toEqual({
			width: form === 'lossy' ? 16383 : 16384,
			height: 2
		});
	});

	it('reads the canvas of an extended form beyond 14 bits', () => {
		expect(webpSize(buildWebp('extended', 0x1000000, 70000))).toEqual({ width: 0x1000000, height: 70000 });
	});

	it('ignores the scale bits of a lossy size', () => {
		const bytes = buildWebp('lossy', 640, 480);
		bytes[27] |= 0xc0;
		bytes[29] |= 0x40;
		expect(webpSize(bytes)).toEqual({ width: 640, height: 480 });
	});

	it.each(forms)('gives nothing for the %s form cut short', (form) => {
		const bytes = buildWebp(form, 10, 10);
		for (const length of [0, 11, 12, 19, 20, bytes.length - 1]) {
			expect(webpSize(bytes.subarray(0, length))).toBeUndefined();
		}
	});

	it.each(forms)('gives nothing for the %s form in a container of another type', (form) => {
		expect(webpSize(buildWebp(form, 10, 10, { riffType: 'AVI ' }))).toBeUndefined();
	});

	it.each(forms)('gives nothing for the %s form in a container that is not RIFF', (form) => {
		const bytes = buildWebp(form, 10, 10);
		bytes[0] = 0x58;
		expect(webpSize(bytes)).toBeUndefined();
	});

	it('gives nothing for a first chunk of an unknown type', () => {
		expect(webpSize(buildWebp('lossy', 10, 10, { chunkType: 'ALPH' }))).toBeUndefined();
	});

	it.each(forms)('gives nothing for the %s form whose chunk is too small for its fields', (form) => {
		expect(webpSize(buildWebp(form, 10, 10, { chunkSizeField: 4 }))).toBeUndefined();
	});

	it('gives nothing for a lossy chunk without its start code', () => {
		expect(webpSize(buildWebp('lossy', 10, 10, { startCode: [0, 0, 0] }))).toBeUndefined();
	});

	it('gives nothing for a lossy chunk of an inter frame', () => {
		const bytes = buildWebp('lossy', 10, 10);
		bytes[20] |= 1;
		expect(webpSize(bytes)).toBeUndefined();
	});

	it('gives nothing for a lossless chunk without its signature byte', () => {
		expect(webpSize(buildWebp('lossless', 10, 10, { signature: 0x2e }))).toBeUndefined();
	});

	it.each([
		['width', 0, 10],
		['height', 10, 0]
	])('gives nothing for a lossy chunk with a zero %s', (_name, width, height) => {
		expect(webpSize(buildWebp('lossy', width, height))).toBeUndefined();
	});
});
