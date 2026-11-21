import type { Object3D } from 'three';
import { parseGlbRefusingTextureFailures } from './figureLoader.js';

/**
 * Parses the bytes of a room into its scene; rejects when the loader refuses the bytes or any texture fails, which three itself
 * swallows. The caller has judged the bytes with `checkRoom`: this reads what the check passed, and a room that fails to load is freed.
 */
export async function loadRoom(bytes: Uint8Array): Promise<Object3D> {
	return (await parseGlbRefusingTextureFailures(bytes)).scene;
}
