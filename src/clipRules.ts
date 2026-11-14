import type { Refusal } from './codes.js';
import { keyRefusals, type KeyChannel } from './clipKeyRules.js';
import { attemptRead, indexOf, isJsonObject, listOf, objectOf, requiredListOf, unreadable, type JsonObject } from './json.js';
import { clipProfile } from './profile.js';

/** The glTF properties that hold anything but animation; a clip holds none. */
const FORBIDDEN_PROPERTIES = ['meshes', 'skins', 'materials', 'textures', 'images', 'samplers', 'cameras'];
/** The node properties that point at geometry or a skeleton; a node of a clip holds none. */
const FORBIDDEN_NODE_PROPERTIES = ['mesh', 'camera', 'skin'];
const CHANNEL_PATHS: ReadonlySet<string> = new Set(['translation', 'rotation', 'scale', 'weights']);

/** The humanoid bones every clip names. */
const requiredBones: ReadonlySet<string> = new Set(clipProfile.requiredHumanBones);

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
	nodeRefusals(json, refusals);
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
	const humanBones = entriesOf(isJsonObject(extension['humanoid']) ? extension['humanoid']['humanBones'] : undefined);
	missingBoneRefusals(humanBones, refusals);
	for (const [bone, entry] of humanBones) {
		const isMissingRequiredBone = requiredBones.has(bone) && !namesNode(entry);
		if (!isMissingRequiredBone) {
			assign(`humanoid bone ${bone}`, entry, bone === 'hips' ? 'hips' : 'bone');
		}
	}
	for (const [name, entry] of expressionEntries(extension['expressions'])) {
		assign(`expression ${name}`, entry, 'expression');
	}
	if (extension['lookAt'] !== undefined) {
		assign('lookAt', extension['lookAt'], 'lookAt');
	}
	return roles;
}

function namesNode(entry: unknown): boolean {
	return isJsonObject(entry) && 'node' in entry;
}

function missingBoneRefusals(humanBones: ReadonlyMap<string, unknown>, refusals: Refusal[]): void {
	for (const bone of clipProfile.requiredHumanBones) {
		if (!namesNode(humanBones.get(bone))) {
			refusals.push({ code: 'humanoid_bone_missing', detail: `the bone ${bone} is missing` });
		}
	}
}

function* expressionEntries(expressions: unknown): Generator<[string, unknown]> {
	for (const group of ['preset', 'custom']) {
		yield* entriesOf(isJsonObject(expressions) ? expressions[group] : undefined);
	}
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
			nameMustBeText(objectOf(scene));
			for (const node of listOf(objectOf(scene)['nodes'])) {
				if (!isJsonObject(nodes[indexOf(node)])) {
					unreadable('a scene names a node that is no entry of nodes');
				}
			}
		}
	});
}

/** The loader sanitises a name with a string method, so a name that is present must be text. */
function nameMustBeText(entry: JsonObject): void {
	if (entry['name'] !== undefined && typeof entry['name'] !== 'string') {
		unreadable('a name is not text');
	}
}

/** The loader follows `children` recursively, so each must be an object, name only nodes that exist and hold no mesh, camera or skin, and the children must form no cycle. */
function nodeRefusals(json: JsonObject, refusals: Refusal[]): void {
	attemptRead(refusals, 'nodes', () => {
		const nodes = listOf(json['nodes']);
		const childrenOf = new Map<number, readonly number[]>();
		nodes.forEach((entry, nodeIndex) => {
			const place = `nodes[${nodeIndex}]`;
			attemptRead(refusals, place, () => {
				const node = objectOf(entry);
				nameMustBeText(node);
				const children = listOf(node['children']).map((child) => {
					if (!isJsonObject(nodes[indexOf(child)])) {
						unreadable('children names a node that is no entry of nodes');
					}
					return indexOf(child);
				});
				childrenOf.set(nodeIndex, children);
				for (const property of FORBIDDEN_NODE_PROPERTIES) {
					if (node[property] !== undefined) {
						refusals.push({ code: 'clip_content_not_allowed', detail: `${place} holds a ${property}` });
					}
				}
			});
		});
		const inCycle = firstNodeInCycle(childrenOf);
		if (inCycle !== undefined) {
			unreadable(`nodes[${inCycle}] is its own descendant`);
		}
	});
}

/** The first node, in index order, that a walk of `children` meets again on its own path, or undefined when the nodes form a forest. Iterative, since a clip may chain nodes deeper than the stack. */
function firstNodeInCycle(childrenOf: ReadonlyMap<number, readonly number[]>): number | undefined {
	const finished = new Set<number>();
	for (const start of childrenOf.keys()) {
		if (finished.has(start)) {
			continue;
		}
		const path = new Set<number>([start]);
		const pending: { node: number; next: number }[] = [{ node: start, next: 0 }];
		while (pending.length > 0) {
			const frame = pending[pending.length - 1];
			const child = childrenOf.get(frame.node)?.[frame.next++];
			if (child === undefined) {
				path.delete(frame.node);
				finished.add(frame.node);
				pending.pop();
			} else if (path.has(child)) {
				return child;
			} else if (!finished.has(child)) {
				path.add(child);
				pending.push({ node: child, next: 0 });
			}
		}
	}
	return undefined;
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
		if (!CHANNEL_PATHS.has(path)) {
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
