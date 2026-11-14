import { describe, expect, it } from 'vitest';
import { checkClip } from './check.js';
import { clipProfile } from './profile.js';
import { conformantTrack, identity, type ClipTrack } from '../tests/clipBuilder.js';
import { buildClipGlb } from '../tests/clipFixtures.js';

type Json = Record<string, any>;

function refusalsOf(change: (json: Json) => void, animations?: readonly (readonly ClipTrack[])[]) {
	return checkClip(buildClipGlb({ change, animations }));
}

function codesOf(change: (json: Json) => void, animations?: readonly (readonly ClipTrack[])[]): string[] {
	return refusalsOf(change, animations).map(({ code }) => code);
}

/** Node indices of the conformant clip's bones, so a test can name a channel's target. */
const nodeOf = (bone: string) => clipProfile.requiredHumanBones.indexOf(bone as (typeof clipProfile.requiredHumanBones)[number]);
const hips = nodeOf('hips');
const spine = nodeOf('spine');

/** Adds a node outside the humanoid and returns its index. */
function addNode(json: Json): number {
	json.nodes.push({ name: 'extra' });
	return json.nodes.length - 1;
}

/** Points the first channel of an animation at `node` with `path`, over a sampler of the matching shape (a translation or scale reads VEC3). */
function retarget(json: Json, node: number | undefined, path: string, animation = 0): void {
	const channel = json.animations[animation].channels[0];
	channel.target = node === undefined ? { path } : { node, path };
	if (path !== 'rotation') {
		const output = json.accessors[json.animations[animation].samplers[0].output];
		output.type = 'VEC3';
		output.count = 3;
		json.bufferViews[output.bufferView].byteLength = 3 * 3 * 4;
	}
}

describe('the clip rules', () => {
	it('pass the conformant clip with no refusal', () => {
		expect(codesOf(() => {})).toEqual([]);
	});

	it.each(['LINEAR', 'STEP'] as const)('pass a %s track', (interpolation) => {
		expect(codesOf(() => {}, [[{ ...conformantTrack(), interpolation }]])).toEqual([]);
	});

	it('pass a cubic spline track, whose output holds an in tangent, a value and an out tangent a key', () => {
		const zero = [0, 0, 0, 0] as const;
		const { rotations } = conformantTrack();
		const cubic = rotations.flatMap((value) => [zero, value, zero]);
		expect(codesOf(() => {}, [[{ ...conformantTrack(), rotations: cubic, interpolation: 'CUBICSPLINE' }]])).toEqual([]);
	});

	it('pass a sampler that names no interpolation, which glTF reads as linear', () => {
		expect(codesOf((json) => delete json.animations[0].samplers[0].interpolation)).toEqual([]);
	});

	it('pass a clip of several animations', () => {
		expect(codesOf(() => {}, [[conformantTrack()], [conformantTrack()]])).toEqual([]);
	});

	it.each([
		['no extensions', (json: Json) => delete json.extensions],
		['extensions that are not an object', (json: Json) => (json.extensions = 'VRMC_vrm_animation')],
		['no VRMC_vrm_animation', (json: Json) => delete json.extensions.VRMC_vrm_animation],
		['a VRMC_vrm_animation that is a list', (json: Json) => (json.extensions.VRMC_vrm_animation = [])],
		['no specVersion', (json: Json) => delete json.extensions.VRMC_vrm_animation.specVersion],
		['specVersion 0.5', (json: Json) => (json.extensions.VRMC_vrm_animation.specVersion = '0.5')],
		['a numeric specVersion', (json: Json) => (json.extensions.VRMC_vrm_animation.specVersion = 1)]
	])('refuse %s as not_vrm_animation alone', (_name, change) => {
		expect(codesOf(change)).toEqual(['not_vrm_animation']);
	});

	it.each(['meshes', 'skins', 'materials', 'textures', 'images', 'samplers', 'cameras'])(
		'refuse a clip that holds %s as clip_content_not_allowed naming it',
		(property) => {
			const refusals = refusalsOf((json) => (json[property] = []));
			expect(refusals).toEqual([{ code: 'clip_content_not_allowed', detail: expect.stringContaining(property) }]);
		}
	);

	it.each([
		['no scenes', (json: Json) => delete json.scenes],
		['an empty scenes list', (json: Json) => (json.scenes = [])]
	])('refuse %s as clip_scene_missing alone', (_name, change) => {
		expect(codesOf(change)).toEqual(['clip_scene_missing']);
	});

	it.each([
		['scenes that is not a list', (json: Json) => (json.scenes = {})],
		['a scene index that names no scene', (json: Json) => (json.scene = json.scenes.length)]
	])('refuse %s as gltf_invalid', (_name, change) => {
		expect(codesOf(change)).toEqual(['gltf_invalid']);
	});

	it('pass a clip that names no default scene', () => {
		expect(codesOf((json) => delete json.scene)).toEqual([]);
	});

	it.each([
		['no animations', (json: Json) => delete json.animations],
		['an empty animations list', (json: Json) => (json.animations = [])]
	])('refuse %s as clip_animation_missing alone', (_name, change) => {
		expect(codesOf(change)).toEqual(['clip_animation_missing']);
	});

	it('refuse animations that is not a list as gltf_invalid', () => {
		expect(codesOf((json) => (json.animations = {}))).toEqual(['gltf_invalid']);
	});

	it.each([
		['the humanoid is missing', (json: Json) => delete json.extensions.VRMC_vrm_animation.humanoid],
		['the humanBones are missing', (json: Json) => delete json.extensions.VRMC_vrm_animation.humanoid.humanBones],
		['a required bone is missing', (json: Json) => delete json.extensions.VRMC_vrm_animation.humanoid.humanBones.hips],
		['a required bone has no node', (json: Json) => (json.extensions.VRMC_vrm_animation.humanoid.humanBones.hips = {})]
	])('refuse a clip where %s as humanoid_bone_missing', (_name, change) => {
		expect(codesOf(change)).toContain('humanoid_bone_missing');
	});

	it.each([
		['a required bone names no node', (json: Json) => (json.extensions.VRMC_vrm_animation.humanoid.humanBones.hips.node = 99)],
		['an optional bone names no node', (json: Json) => (json.extensions.VRMC_vrm_animation.humanoid.humanBones.chest = { node: 99 })],
		['an optional bone is not an object', (json: Json) => (json.extensions.VRMC_vrm_animation.humanoid.humanBones.chest = 3)],
		['an expression names no node', (json: Json) => (json.extensions.VRMC_vrm_animation.expressions = { preset: { happy: { node: 99 } } })],
		['an expression is not an object', (json: Json) => (json.extensions.VRMC_vrm_animation.expressions = { custom: { wink: 3 } })],
		['the look-at names no node', (json: Json) => (json.extensions.VRMC_vrm_animation.lookAt = { node: 99 })]
	])('refuse a clip where %s as gltf_invalid alone', (_name, change) => {
		expect(codesOf(change)).toEqual(['gltf_invalid']);
	});

	describe('the tracks', () => {
		it.each([
			['a channel without a target node', (json: Json) => retarget(json, undefined, 'rotation')],
			['a weights channel', (json: Json) => retarget(json, spine, 'weights')],
			['a scale on a humanoid bone', (json: Json) => retarget(json, spine, 'scale')],
			['a scale on the hips', (json: Json) => retarget(json, hips, 'scale')],
			['a translation on a bone other than the hips', (json: Json) => retarget(json, spine, 'translation')],
			['a translation on the look-at node', (json: Json) => {
				json.extensions.VRMC_vrm_animation.lookAt = { node: addNode(json) };
				retarget(json, json.extensions.VRMC_vrm_animation.lookAt.node, 'translation');
			}],
			['a rotation on an expression node', (json: Json) => {
				const node = addNode(json);
				json.extensions.VRMC_vrm_animation.expressions = { preset: { happy: { node } } };
				retarget(json, node, 'rotation');
			}],
			['a scale on an expression node', (json: Json) => {
				const node = addNode(json);
				json.extensions.VRMC_vrm_animation.expressions = { custom: { wink: { node } } };
				retarget(json, node, 'scale');
			}]
		])('refuse %s as clip_track_not_allowed', (_name, change) => {
			expect(codesOf(change)).toEqual(['clip_track_not_allowed']);
		});

		it.each([
			['a translation on the hips', (json: Json) => retarget(json, hips, 'translation')],
			['a rotation on the hips', (json: Json) => retarget(json, hips, 'rotation')],
			['a translation on an expression node', (json: Json) => {
				const node = addNode(json);
				json.extensions.VRMC_vrm_animation.expressions = { preset: { happy: { node } } };
				retarget(json, node, 'translation');
			}],
			['a rotation on the look-at node', (json: Json) => {
				json.extensions.VRMC_vrm_animation.lookAt = { node: addNode(json) };
				retarget(json, json.extensions.VRMC_vrm_animation.lookAt.node, 'rotation');
			}],
			['a scale on a node that is no humanoid bone, expression or look-at', (json: Json) => retarget(json, addNode(json), 'scale')]
		])('pass %s', (_name, change) => {
			expect(codesOf(change)).toEqual([]);
		});

		it.each([
			['a channel that is not an object', (json: Json) => (json.animations[0].channels[0] = 3)],
			['a channel whose sampler names none', (json: Json) => (json.animations[0].channels[0].sampler = 9)],
			['a channel with no target', (json: Json) => delete json.animations[0].channels[0].target],
			['a target whose node names no node', (json: Json) => (json.animations[0].channels[0].target.node = 99)],
			['a target path that is not a glTF path', (json: Json) => (json.animations[0].channels[0].target.path = 'position')],
			['a sampler whose interpolation is unknown', (json: Json) => (json.animations[0].samplers[0].interpolation = 'SMOOTH')],
			['an animation without channels', (json: Json) => delete json.animations[0].channels],
			['an animation without samplers', (json: Json) => delete json.animations[0].samplers]
		])('refuse %s as gltf_invalid alone', (_name, change) => {
			expect(codesOf(change)).toEqual(['gltf_invalid']);
		});

		it('judge the channels of every animation, not only the first', () => {
			const codes = codesOf((json) => retarget(json, spine, 'scale', 1), [[conformantTrack()], [conformantTrack()]]);
			expect(codes).toEqual(['clip_track_not_allowed']);
		});
	});

	describe('the length', () => {
		const track = (lastSeconds: number): ClipTrack => ({ ...conformantTrack(), times: [0, 1, lastSeconds] });

		it('passes a first animation whose last key is at the budget', () => {
			expect(codesOf(() => {}, [[track(clipProfile.maxSeconds)]])).toEqual([]);
		});

		it('refuses a first animation whose last key is past the budget as clip_too_long alone', () => {
			expect(codesOf(() => {}, [[track(clipProfile.maxSeconds + 1)]])).toEqual(['clip_too_long']);
		});

		it('judges the longest track of the first animation', () => {
			const longer = { ...track(clipProfile.maxSeconds + 1), bone: 'rightLowerArm' };
			expect(codesOf(() => {}, [[conformantTrack(), longer]])).toEqual(['clip_too_long']);
		});

		it('passes a second animation that runs past the budget', () => {
			expect(codesOf(() => {}, [[conformantTrack()], [track(clipProfile.maxSeconds + 1)]])).toEqual([]);
		});

		it('passes a track of one key', () => {
			expect(codesOf(() => {}, [[{ ...conformantTrack(), times: [0], rotations: [identity] }]])).toEqual([]);
		});
	});
});
