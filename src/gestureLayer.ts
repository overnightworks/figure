import { Euler, Object3D, Quaternion, QuaternionLinearInterpolant, type Interpolant, type QuaternionKeyframeTrack } from 'three';
import type { VRMHumanoid } from '@pixiv/three-vrm';
import { boneClock, clipWeight, gestureClips, isClipBone, type ClipBone, type ClipTiming, type TurnKey } from './gestureClips.js';
import type { FigureGesture } from './gestures.js';
import type { GesturePlay, Turn } from './figureMotion.js';

const turnAsEuler = new Euler();

/** The rotation `turn` names, written into `target`: the rotation a bone takes from `Object3D.rotation.set(pitch, yaw, roll)`. */
export function quaternionOfTurn(turn: Turn, target: Quaternion): Quaternion {
	return target.setFromEuler(turnAsEuler.set(turn.pitch, turn.yaw, turn.roll));
}

const quaternionSize = 4;

/** The linear sampler of quaternions that `keys` make: the sampler the layer builds for a clip authored as keys. */
export function linearSamplerOf(keys: readonly TurnKey[]): QuaternionLinearInterpolant {
	const rotation = new Quaternion();
	const times = Float32Array.from(keys, ({ seconds }) => seconds);
	const values = Float32Array.from(keys.flatMap(({ turn }) => quaternionOfTurn(turn, rotation).toArray()));
	return new QuaternionLinearInterpolant(times, values, quaternionSize, new Float32Array(quaternionSize));
}

/** A clip read from a file: its seconds and the rotation track of each humanoid bone it keys, in the normalized humanoid's frame. */
export interface LoadedClip {
	readonly durationSeconds: number;
	readonly rotations: ReadonlyMap<string, QuaternionKeyframeTrack>;
}

/**
 * The track's own sampler, which follows the interpolation the file named: three sets `createInterpolant` on a track as it makes it and
 * copies it on a clone, yet `@types/three` leaves it out.
 */
function samplerOfTrack(track: QuaternionKeyframeTrack): Interpolant {
	return (track as unknown as { createInterpolant(): Interpolant }).createInterpolant();
}

/** One bone a clip plays: its node, the sampler of its track, and the bone's name for its lag. */
interface PlayedBone {
	readonly bone: ClipBone;
	readonly node: Object3D;
	readonly sampler: Interpolant;
}

/** The layer of one figure: the gestures it plays over the pose the base wrote. */
export interface GestureLayer {
	/** The clip a gesture started now would play: figure's own until a loaded clip replaces it. */
	clipOf(name: FigureGesture): ClipTiming;
	/** Replaces the clip of `name` for the gestures that start after this call, with the owned bones of `loaded` the figure has, on the fades of figure's own clip. A second replace for the same name must keep resting the bones a running gesture's earlier clip turns; today each name is replaced at most once per mount. */
	replace(name: FigureGesture, loaded: LoadedClip): void;
	/** The nodes of every bone any clip of the layer turns now, which the frame brings to the base pose before the layer applies. */
	readonly nodes: readonly Object3D[];
	/** Turns each bone the clip of `play` has a track for from the turn it holds now toward the clip's sample, by the clip's weight for that bone and the bone's lag. */
	apply(play: GesturePlay): void;
}

/** The layer for `humanoid`: each clip's samplers are built once, here or when a loaded clip replaces one. */
export function createGestureLayer(humanoid: VRMHumanoid): GestureLayer {
	const playedBones = new WeakMap<ClipTiming, readonly PlayedBone[]>();
	const current = new Map<FigureGesture, ClipTiming>();
	const sample = new Quaternion();
	let nodes: readonly Object3D[] = [];

	const refreshNodes = () => {
		nodes = [...new Set([...current.values()].flatMap((clip) => playedBones.get(clip)!.map(({ node }) => node)))];
	};
	const use = (name: FigureGesture, clip: ClipTiming, bones: readonly PlayedBone[]) => {
		playedBones.set(clip, bones);
		current.set(name, clip);
		refreshNodes();
	};
	for (const [name, clip] of Object.entries(gestureClips) as [FigureGesture, (typeof gestureClips)[FigureGesture]][]) {
		const bones = (Object.entries(clip.keys) as [ClipBone, readonly TurnKey[]][]).map(([bone, keys]) => ({
			bone,
			node: humanoid.getNormalizedBoneNode(bone)!,
			sampler: linearSamplerOf(keys)
		}));
		use(name, clip, bones);
	}
	return {
		clipOf: (name) => current.get(name)!,
		replace(name, loaded) {
			const bones = [...loaded.rotations].flatMap(([bone, track]): PlayedBone[] => {
				if (!isClipBone(bone)) return [];
				const node = humanoid.getNormalizedBoneNode(bone);
				return node === null ? [] : [{ bone, node, sampler: samplerOfTrack(track) }];
			});
			use(name, { durationSeconds: loaded.durationSeconds, fadeSeconds: gestureClips[name].fadeSeconds, bones: bones.map(({ bone }) => bone) }, bones);
		},
		get nodes() {
			return nodes;
		},
		apply({ clip, seconds }) {
			for (const { bone, node, sampler } of playedBones.get(clip)!) {
				const clock = boneClock(bone, seconds);
				node.quaternion.slerp(sample.fromArray(sampler.evaluate(clock)), clipWeight(clip, clock));
			}
		}
	};
}
