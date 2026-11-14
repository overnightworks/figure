import { validateBytes } from 'gltf-validator';
import { describe, expect, it } from 'vitest';
import { buildVrmGlb } from '../tests/figureFixtures.js';
import { buildRoomGlb, type RoomLook } from '../tests/roomBuilder.js';
import { figureTexture } from '../tests/glbBuilder.js';

const errorSeverity = 0;

describe('the Khronos glTF validator on the conformant synthetic VRM', () => {
	it('finds no error and decodes the embedded texture at the size the builder gave it', async () => {
		const report = await validateBytes(buildVrmGlb());
		expect(report.issues.messages.filter(({ severity }) => severity === errorSeverity)).toEqual([]);
		expect(report.info.resources.find(({ image }) => image !== undefined)?.image).toMatchObject({
			width: figureTexture.width,
			height: figureTexture.height
		});
	});
});

describe('the Khronos glTF validator on the conformant synthetic room', () => {
	it.each<RoomLook>(['both', 'textured', 'vertexColoured'])('finds no error in the room painted %s', async (look) => {
		const report = await validateBytes(buildRoomGlb({ look }));
		expect(report.issues.messages.filter(({ severity }) => severity === errorSeverity)).toEqual([]);
	});
});
