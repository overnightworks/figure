import type { GestureClip } from '../src/gestureClips.js';
import type { Turn } from '../src/figureMotion.js';

const FLOAT = 5126;
const BYTES_PER_FLOAT = 4;

export type Quaternion = readonly [x: number, y: number, z: number, w: number];

/** The humanoid bones a clip file names; the caller reads the required ones from the profile. */
export interface ClipValues {
	readonly requiredHumanBones: readonly string[];
}

/** One bone's rotation keys as the file stores them: `rotations` is the sampler's output, so a cubic spline holds three quaternions a key. */
export interface ClipTrack {
	readonly bone: string;
	readonly times: readonly number[];
	readonly rotations: readonly Quaternion[];
	readonly interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
}

export const identity: Quaternion = [0, 0, 0, 1];

/** The tracks that write a clip authored as keys: per bone its keys at their own seconds, each turn as the rotation `rotationOf` gives. Node reads this file with its types stripped, so the type imports above are all it imports. */
export function tracksOfKeys(keys: GestureClip['keys'], rotationOf: (turn: Turn) => Quaternion): ClipTrack[] {
	return Object.entries(keys).map(([bone, boneKeys]) => ({
		bone,
		times: boneKeys.map(({ seconds }) => seconds),
		rotations: boneKeys.map(({ turn }) => rotationOf(turn))
	}));
}

/** The conformant clip's one track: the right upper arm turning about X from rest to a quarter turn and back, three keys. */
export function conformantTrack(): ClipTrack {
	const quarterTurn = Math.SQRT1_2;
	return {
		bone: 'rightUpperArm',
		times: [0, 1, 2],
		rotations: [identity, [quarterTurn, 0, 0, quarterTurn], identity]
	};
}

function floatBytes(values: readonly number[]): Uint8Array {
	const bytes = new Uint8Array(values.length * BYTES_PER_FLOAT);
	const view = new DataView(bytes.buffer);
	values.forEach((value, index) => view.setFloat32(index * BYTES_PER_FLOAT, value, true));
	return bytes;
}

/**
 * The JSON and binary chunk of a conformant clip: a flat humanoid of the required bones and the tracks' bones (a node each, all in the scene), and one
 * animation for each list of tracks in `animations` (by default one animation of one rotation track), with a buffer view and an
 * accessor each for every track's times and rotations. A caller changes the JSON into a counter-example afterwards.
 */
export function clipParts(
	values: ClipValues,
	animations: readonly (readonly ClipTrack[])[] = [[conformantTrack()]]
): { json: Record<string, any>; binary: Uint8Array } {
	const bones = new Set([...values.requiredHumanBones, ...animations.flat().map(({ bone }) => bone)]);
	const nodes = [...bones].map((bone) => ({ name: bone }));
	const humanBones = Object.fromEntries(nodes.map(({ name }, node) => [name, { node }]));
	const accessors: object[] = [];
	const bufferViews: object[] = [];
	const chunks: Uint8Array[] = [];
	let binaryLength = 0;
	function addData(data: readonly number[], count: number, type: string): number {
		const bytes = floatBytes(data);
		bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: bytes.length });
		accessors.push({ bufferView: bufferViews.length - 1, componentType: FLOAT, count, type });
		chunks.push(bytes);
		binaryLength += bytes.length;
		return accessors.length - 1;
	}
	const animationEntries = animations.map((tracks) => {
		const samplers: object[] = [];
		const channels: object[] = [];
		for (const track of tracks) {
			const interpolation = track.interpolation ?? 'LINEAR';
			const input = addData(track.times, track.times.length, 'SCALAR');
			const output = addData(track.rotations.flat(), track.rotations.length, 'VEC4');
			samplers.push({ input, output, interpolation });
			const node = nodes.findIndex(({ name }) => name === track.bone);
			channels.push({ sampler: samplers.length - 1, target: { node, path: 'rotation' } });
		}
		return { samplers, channels };
	});
	const binary = new Uint8Array(binaryLength);
	let offset = 0;
	for (const chunk of chunks) {
		binary.set(chunk, offset);
		offset += chunk.length;
	}
	const json = {
		asset: { version: '2.0' },
		extensionsUsed: ['VRMC_vrm_animation'],
		extensions: { VRMC_vrm_animation: { specVersion: '1.0', humanoid: { humanBones } } },
		scene: 0,
		scenes: [{ nodes: nodes.map((_node, index) => index) }],
		nodes,
		buffers: [{ byteLength: binary.length }],
		bufferViews,
		accessors,
		animations: animationEntries
	};
	return { json, binary };
}
