import { describe, expect, it } from 'vitest';
import { buildGlb } from '../tests/glbBuilder.js';
import { vrmParts } from '../tests/figureFixtures.js';
import { loadFigure } from './figureLoader.js';

describe('loadFigure in a browser', () => {
	it('refuses a file whose geometry sits in a second buffer and makes no request', async () => {
		const parts = vrmParts(undefined, (json) => {
			json.buffers.push({ byteLength: json.buffers[0].byteLength });
			json.bufferViews.at(-1).buffer = 1;
		});
		performance.clearResourceTimings();

		await expect(loadFigure(buildGlb(parts))).rejects.toThrow();

		expect(performance.getEntriesByType('resource')).toHaveLength(0);
	});
});
