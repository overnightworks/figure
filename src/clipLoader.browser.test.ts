import { describe, expect, it } from 'vitest';
import { Quaternion } from 'three';
import { conformantTrack, identity, tracksOfKeys, type ClipTrack } from '../tests/clipBuilder.js';
import { buildClipGlb, filesTheLibraryThrowsOn } from '../tests/clipFixtures.js';
import { loadClip } from './clipLoader.js';
import { gestureClips, type ClipBone } from './gestureClips.js';
import { linearSamplerOf, quaternionOfTurn } from './gestureLayer.js';
import { figureGesture } from './gestures.js';

describe('loadClip in a browser', () => {
	it('gives the seconds of the first animation and the rotation track of each bone it keys', async () => {
		const track: ClipTrack = { bone: 'rightLowerArm', times: [0, 0.5, 3], rotations: [identity, identity, identity] };
		const clip = await loadClip(buildClipGlb({ animations: [[conformantTrack(), track]] }));

		expect(clip.durationSeconds).toBe(3);
		expect([...clip.rotations.keys()].sort()).toEqual(['rightLowerArm', 'rightUpperArm']);
	});

	it('plays the first of several animations', async () => {
		const first: ClipTrack = { bone: 'leftHand', times: [0, 1], rotations: [identity, identity] };
		const second: ClipTrack = { bone: 'rightHand', times: [0, 5], rotations: [identity, identity] };
		const clip = await loadClip(buildClipGlb({ animations: [[first], [second]] }));

		expect(clip.durationSeconds).toBe(1);
		expect([...clip.rotations.keys()]).toEqual(['leftHand']);
	});

	it('rejects a clip without an animation', async () => {
		await expect(loadClip(buildClipGlb({ animations: [] }))).rejects.toThrow();
	});

	it.each(filesTheLibraryThrowsOn)('rejects %s', async (_, change) => {
		await expect(loadClip(buildClipGlb({ change }))).rejects.toThrow();
	});

	it('rejects bytes that are no glTF', async () => {
		await expect(loadClip(new Uint8Array(4))).rejects.toThrow();
	});

	it('makes no request', async () => {
		performance.clearResourceTimings();
		await loadClip(buildClipGlb());

		expect(performance.getEntriesByType('resource')).toHaveLength(0);
	});

	it('rejects a clip whose buffer lies outside its bytes, whatever the check said', async () => {
		await expect(loadClip(buildClipGlb({ change: (json) => (json.buffers[0].uri = 'elsewhere.bin') }))).rejects.toThrow();
	});

	describe('given the bytes the writer makes of the base set', () => {
		it.each(Object.values(figureGesture))('gives per bone of %s the times and values the layer builds from the keys', async (name) => {
			const clip = await loadClip(buildClipGlb({ animations: [tracksOfKeys(gestureClips[name].keys, (turn) => quaternionOfTurn(turn, new Quaternion()).toArray())] }));
			const bones = Object.entries(gestureClips[name].keys) as [ClipBone, NonNullable<(typeof gestureClips)[typeof name]['keys'][ClipBone]>][];

			expect(clip.durationSeconds).toBeCloseTo(gestureClips[name].durationSeconds, 6);
			expect([...clip.rotations.keys()].sort()).toEqual(bones.map(([bone]) => bone).sort());
			for (const [bone, keys] of bones) {
				const built = linearSamplerOf(keys);
				const loaded = clip.rotations.get(bone)!;

				expect(Array.from(loaded.times)).toEqual(Array.from(built.parameterPositions));
				Array.from(loaded.values).forEach((value, index) => expect(value).toBeCloseTo(built.sampleValues[index]!, 6));
			}
		});
	});
});
