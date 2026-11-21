import { describe, expect, it } from 'vitest';
import { Mesh, type Object3D } from 'three';
import { buildPng } from '../tests/glbBuilder.js';
import { buildRoomGlb, type RoomLook } from '../tests/roomBuilder.js';
import { loadRoom } from './roomLoader.js';

const meshesOf = (room: Object3D): Mesh[] => {
	const meshes: Mesh[] = [];
	room.traverse((node) => {
		if (node instanceof Mesh) meshes.push(node);
	});
	return meshes;
};

describe('loadRoom in a browser', () => {
	it.each<RoomLook>(['both', 'textured', 'vertexColoured'])('gives the floor and the wall of a %s room as meshes', async (look) => {
		const room = await loadRoom(buildRoomGlb({ look }));

		expect(meshesOf(room)).toHaveLength(3);
	});

	it('rejects bytes that are no glTF', async () => {
		await expect(loadRoom(new Uint8Array(4))).rejects.toThrow();
	});

	it('rejects a room whose image does not decode', async () => {
		await expect(loadRoom(buildRoomGlb({ look: 'textured', images: [buildPng(4, 2)] }))).rejects.toThrow();
	});

	it.each([
		['a buffer outside its bytes', (json: Record<string, any>) => (json.buffers[0].uri = 'elsewhere.bin')],
		[
			'an image outside its bytes',
			(json: Record<string, any>) => {
				delete json.images[0].bufferView;
				json.images[0].uri = 'elsewhere.png';
			}
		]
	])('rejects a room with %s, whatever the check said, and makes no request', async (_, change) => {
		performance.clearResourceTimings();

		await expect(loadRoom(buildRoomGlb({ change }))).rejects.toThrow();

		expect(performance.getEntriesByType('resource')).toHaveLength(0);
	});

	it('makes no request for a conformant room', async () => {
		performance.clearResourceTimings();
		await loadRoom(buildRoomGlb());

		expect(performance.getEntriesByType('resource')).toHaveLength(0);
	});
});
