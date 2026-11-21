import type { Object3D } from 'three';
import { VRMUtils } from '@pixiv/three-vrm';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { registerRefusingPlugins } from './figureLoader.js';

/**
 * Parses the bytes of a room into its scene; rejects when the loader refuses the bytes or any texture fails, which three itself
 * swallows. The caller has judged the bytes with `checkRoom`: this reads what the check passed, and a room that fails to load is freed.
 */
export async function loadRoom(bytes: Uint8Array): Promise<Object3D> {
	let textureFailed = false;
	const loader = new GLTFLoader();
	registerRefusingPlugins(loader, () => (textureFailed = true));
	const gltf = await loader.parseAsync(bytes.slice().buffer, '');
	if (textureFailed) {
		VRMUtils.deepDispose(gltf.scene);
		throw new Error('a texture failed to load');
	}
	return gltf.scene;
}
