import { describe, expect, it } from 'vitest';
import { buildGlb, buildPng } from '../tests/glbBuilder.js';
import { vrmParts } from '../tests/figureFixtures.js';
import { loadFigure } from './figureLoader.js';

describe('loadFigure in a browser', () => {
	it.each([
		{
			name: 'geometry sits in a second buffer',
			images: undefined,
			mutate: (json: any) => {
				json.buffers.push({ byteLength: json.buffers[0].byteLength });
				json.bufferViews.at(-1).buffer = 1;
			}
		},
		{
			name: 'image names a URL outside its bytes',
			images: [buildPng(4, 2)],
			mutate: (json: any) => {
				delete json.images[0].bufferView;
				json.images[0].uri = 'elsewhere.png';
			}
		}
	])('refuses a file whose $name and makes no request', async ({ images, mutate }) => {
		performance.clearResourceTimings();

		await expect(loadFigure(buildGlb(vrmParts(images, mutate)))).rejects.toThrow();

		expect(performance.getEntriesByType('resource')).toHaveLength(0);
	});
});
