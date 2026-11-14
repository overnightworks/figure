import type { Refusal } from './codes.js';
import { keyRefusals, type KeyChannel } from './clipKeyRules.js';
import { attemptRead, indexOf, isJsonObject, listOf, objectOf, requiredListOf, unreadable, type JsonObject } from './json.js';
import { clipProfile } from './profile.js';

/** The glTF properties that hold anything but animation; a clip holds none. */
const FORBIDDEN_PROPERTIES = ['meshes', 'skins', 'materials', 'textures', 'images', 'samplers', 'cameras'];
const CHANNEL_PATHS = ['translation', 'rotation', 'scale', 'weights'];

/** What a node is to the clip, which decides the one kind of channel it takes. */
type NodeRole = 'bone' | 'hips' | 'expression' | 'lookAt';

const pathsOfRole: Readonly<Record<NodeRole, readonly string[]>> = {
	bone: ['rotation'],
	hips: ['rotation', 'translation'],
	expression: ['translation'],
	lookAt: ['rotation']
};

/** Judges the clip rules from the glTF JSON and the binary chunk alone; a part a rule cannot read is `gltf_invalid`. */
export function clipRefusals(json: JsonObject, binaryChunk: Uint8Array | undefined): Refusal[] {
	const refusals: Refusal[] = [];
	const roles = extensionRefusals(json, refusals);
	contentRefusals(json, refusals);
	sceneRefusals(json, refusals);
	animationRefusals(json, binaryChunk, roles, refusals);
	return refusals;
}

/** Judges the `VRMC_vrm_animation` object and returns the role of each node it names. */
function extensionRefusals(json: JsonObject, refusals: Refusal[]): ReadonlyMap<number, readonly NodeRole[]> {
	const roles = new Map<number, NodeRole[]>();
	const extensions = json['extensions'];
	const extension = isJsonObject(extensions) ? extensions['VRMC_vrm_animation'] : undefined;
	if (!isJsonObject(extension) || extension['specVersion'] !== clipProfile.specVersion) {
		refusals.push({ code: 'not_vrm_animation' });
		return roles;
	}
	const assign = (place: string, entry: unknown, role: NodeRole) =>
		attemptRead(refusals, place, () => {
			const node = indexOf(objectOf(entry)['node']);
			if (!isJsonObject(listOf(json['nodes'])[node])) {
				unreadable('a node index names no entry of nodes');
			}
			roles.set(node, [...(roles.get(node) ?? []), role]);
		});
	const humanoid = extension['humanoid'];
	const humanBones = entriesOf(isJsonObject(humanoid) ? humanoid['humanBones'] : undefined);
	const namesNode = (entry: unknown) => isJsonObject(entry) && 'node' in entry;
	for (const bone of clipProfile.requiredHumanBones) {
		if (!namesNode(humanBones.get(bone))) {
			refusals.push({ code: 'humanoid_bone_missing', detail: `the bone ${bone} is missing` });
		}
	}
	for (const [bone, entry] of humanBones) {
		const isMissingRequiredBone = (clipProfile.requiredHumanBones as readonly string[]).includes(bone) && !namesNode(entry);
		if (!isMissingRequiredBone) {
			assign(`humanoid bone ${bone}`, entry, bone === 'hips' ? 'hips' : 'bone');
		}
	}
	const expressions = extension['expressions'];
	for (const group of ['preset', 'custom']) {
		for (const [name, entry] of entriesOf(isJsonObject(expressions) ? expressions[group] : undefined)) {
			assign(`expression ${name}`, entry, 'expression');
		}
	}
	if (extension['lookAt'] !== undefined) {
		assign('lookAt', extension['lookAt'], 'lookAt');
	}
	return roles;
}

function entriesOf(value: unknown): ReadonlyMap<string, unknown> {
	return new Map(isJsonObject(value) ? Object.entries(value) : []);
}

function contentRefusals(json: JsonObject, refusals: Refusal[]): void {
	for (const property of FORBIDDEN_PROPERTIES) {
		if (json[property] !== undefined) {
			refusals.push({ code: 'clip_content_not_allowed', detail: `the clip holds ${property}` });
		}
	}
}

/** The loader reads the default scene, so a clip needs one, a `scene` index must name one, and every scene must be an object naming nodes that exist. */
function sceneRefusals(json: JsonObject, refusals: Refusal[]): void {
	attemptRead(refusals, 'scenes', () => {
		const scenes = listOf(json['scenes']);
		if (scenes.length === 0) {
			refusals.push({ code: 'clip_scene_missing' });
		} else if (json['scene'] !== undefined && indexOf(json['scene']) >= scenes.length) {
			unreadable('scene names no entry of scenes');
		}
		const nodes = listOf(json['nodes']);
		for (const scene of scenes) {
			for (const node of listOf(objectOf(scene)['nodes'])) {
				if (!isJsonObject(nodes[indexOf(node)])) {
					unreadable('a scene names a node that is no entry of nodes');
				}
			}
		}
	});
}

/** Judges every animation, since the loader parses each; only the first one's length counts against the profile. */
function animationRefusals(
	json: JsonObject,
	binaryChunk: Uint8Array | undefined,
	roles: ReadonlyMap<number, readonly NodeRole[]>,
	refusals: Refusal[]
): void {
	attemptRead(refusals, 'animations', () => {
		const animations = listOf(json['animations']);
		if (animations.length === 0) {
			refusals.push({ code: 'clip_animation_missing' });
		}
		animations.forEach((animation, animationIndex) => {
			const place = `animations[${animationIndex}]`;
			let lastSeconds = 0;
			attemptRead(refusals, place, () => {
				const { samplers, channels } = objectOf(animation);
				const samplerList = requiredListOf(samplers);
				for (const [channelIndex, channel] of requiredListOf(channels).entries()) {
					const seconds = channelRefusals(json, binaryChunk, roles, samplerList, channel, `${place}.channels[${channelIndex}]`, refusals);
					lastSeconds = Math.max(lastSeconds, seconds ?? 0);
				}
			});
			if (animationIndex === 0 && lastSeconds > clipProfile.maxSeconds) {
				refusals.push({ code: 'clip_too_long', detail: `${place} runs ${lastSeconds} seconds` });
			}
		});
	});
}

/** Judges one channel's target and key data; returns the time of its last key, if it could be read. */
function channelRefusals(
	json: JsonObject,
	binaryChunk: Uint8Array | undefined,
	roles: ReadonlyMap<number, readonly NodeRole[]>,
	samplers: readonly unknown[],
	channel: unknown,
	place: string,
	refusals: Refusal[]
): number | undefined {
	let lastSeconds: number | undefined;
	attemptRead(refusals, place, () => {
		const channelObject = objectOf(channel);
		const target = objectOf(channelObject['target']);
		const path = target['path'] as string;
		if (!CHANNEL_PATHS.includes(path)) {
			unreadable('the target names a path glTF does not give');
		}
		const sampler = objectOf(samplers[indexOf(channelObject['sampler'])]);
		const notAllowed = trackNotAllowed(json, roles, target, path);
		if (notAllowed !== undefined) {
			refusals.push({ code: 'clip_track_not_allowed', detail: `${place} ${notAllowed}` });
		}
		if (path !== 'weights') {
			lastSeconds = keyRefusals(json, binaryChunk, place, { path: path as KeyChannel['path'], sampler }, refusals);
		}
	});
	return lastSeconds;
}

/** Why the profile does not take a channel, or undefined when it does. */
function trackNotAllowed(json: JsonObject, roles: ReadonlyMap<number, readonly NodeRole[]>, target: JsonObject, path: string): string | undefined {
	if (target['node'] === undefined) {
		return 'has no target node';
	}
	const node = indexOf(target['node']);
	if (!isJsonObject(listOf(json['nodes'])[node])) {
		unreadable('the target names a node that is no entry of nodes');
	}
	if (path === 'weights') {
		return 'animates weights, and the clip has no mesh';
	}
	const refusingRole = roles.get(node)?.find((role) => !pathsOfRole[role].includes(path));
	return refusingRole === undefined ? undefined : `animates the ${path} of a node that is a ${refusingRole}`;
}
