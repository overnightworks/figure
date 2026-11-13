import { Euler, Object3D, Quaternion, QuaternionLinearInterpolant } from 'three';
import type { VRMHumanoid } from '@pixiv/three-vrm';
import { boneClock, clipWeight, gestureClips, type BoneTrack, type ClipBone, type GestureClip } from './gestureClips.js';
import type { FigureGesture } from './gestures.js';
import type { GesturePlay, Turn } from './figureMotion.js';

const turnAsEuler = new Euler();

/** The rotation `turn` names, written into `target`: the rotation a bone takes from `Object3D.rotation.set(pitch, yaw, roll)`. */
export function quaternionOfTurn(turn: Turn, target: Quaternion): Quaternion {
	return target.setFromEuler(turnAsEuler.set(turn.pitch, turn.yaw, turn.roll));
}

/** The clip's bone: the node it turns, its track as a linear sampler of quaternions, and the clip's weight and lag for it. */
interface SampledBone {
	readonly node: Object3D;
	readonly track: BoneTrack;
	readonly sampler: QuaternionLinearInterpolant;
}

const quaternionSize = 4;

function samplerOf(track: BoneTrack): QuaternionLinearInterpolant {
	const rotation = new Quaternion();
	const times = Float32Array.from(track.keys, ({ seconds }) => seconds);
	const values = Float32Array.from(track.keys.flatMap(({ turn }) => quaternionOfTurn(turn, rotation).toArray()));
	return new QuaternionLinearInterpolant(times, values, quaternionSize, new Float32Array(quaternionSize));
}

function sampledBones(humanoid: VRMHumanoid, clip: GestureClip): SampledBone[] {
	return (Object.entries(clip.bones) as [ClipBone, BoneTrack][]).map(([bone, track]) => ({
		node: humanoid.getNormalizedBoneNode(bone)!,
		track,
		sampler: samplerOf(track)
	}));
}

/** A gesture's clip laid over the pose the base wrote. */
export interface GestureLayer {
	/** Turns each bone the clip has a track for from the turn it holds now toward the clip's sample, by the clip's weight for that bone. */
	apply(play: GesturePlay): void;
}

/** The layer for `humanoid`: each clip's samplers are built once, here. */
export function createGestureLayer(humanoid: VRMHumanoid): GestureLayer {
	const clips = new Map(Object.entries(gestureClips).map(([name, clip]) => [name as FigureGesture, { clip, bones: sampledBones(humanoid, clip) }]));
	const sample = new Quaternion();
	return {
		apply({ name, seconds }) {
			const { clip, bones } = clips.get(name)!;
			for (const { node, track, sampler } of bones) {
				const clock = boneClock(track, seconds);
				node.quaternion.slerp(sample.fromArray(sampler.evaluate(clock)), clipWeight(clip, clock));
			}
		}
	};
}
