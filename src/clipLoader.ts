import type { QuaternionKeyframeTrack } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin, type VRMAnimation } from '@pixiv/three-vrm-animation';
import { registerRefusingPlugins } from './figureLoader.js';
import type { LoadedClip } from './gestureLayer.js';

/**
 * Parses the bytes of a `.vrma` into the first animation's rotation tracks by humanoid bone name and its seconds; rejects when the loader
 * refuses the bytes or the file holds no animation. The caller has judged the bytes with `checkClip`: this reads what the check passed.
 */
export async function loadClip(bytes: Uint8Array): Promise<LoadedClip> {
	const loader = new GLTFLoader();
	registerRefusingPlugins(loader, () => {});
	loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
	const gltf = await loader.parseAsync(bytes.slice().buffer, '');
	const animation = (gltf.userData.vrmAnimations as VRMAnimation[] | undefined)?.[0];
	if (animation === undefined) throw new Error('the clip holds no animation');
	return { durationSeconds: animation.duration, rotations: animation.humanoidTracks.rotation as ReadonlyMap<string, QuaternionKeyframeTrack> };
}
