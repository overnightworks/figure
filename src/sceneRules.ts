import type { Refusal, RefusalCode } from './codes.js';
import { attemptRead, indexOf, isJsonObject, listOf, objectOf, unreadable, type JsonObject } from './json.js';

/** What differs between the kinds of file that walk a scene: the code for a file without one, and the node properties the kind forbids. */
export interface SceneKind {
	readonly missingSceneCode: RefusalCode;
	/** The code for a node that holds a forbidden property; its detail names the node and the property. */
	readonly contentCode: RefusalCode;
	readonly forbiddenNodeProperties: readonly string[];
}

/** Judges the scenes and the nodes as the loader walks them; a shape it would throw on is `gltf_invalid`. */
export function sceneRefusals(json: JsonObject, kind: SceneKind): Refusal[] {
	const refusals: Refusal[] = [];
	defaultSceneRefusals(json, kind, refusals);
	nodeRefusals(json, kind, refusals);
	return refusals;
}

/** The loader reads the default scene, so a file needs one, a `scene` index must name one, and every scene must be an object naming nodes that exist. */
function defaultSceneRefusals(json: JsonObject, kind: SceneKind, refusals: Refusal[]): void {
	attemptRead(refusals, 'scenes', () => {
		const scenes = listOf(json['scenes']);
		if (scenes.length === 0) {
			refusals.push({ code: kind.missingSceneCode });
		} else if (json['scene'] !== undefined && indexOf(json['scene']) >= scenes.length) {
			unreadable('scene names no entry of scenes');
		}
		const nodes = json['nodes'] === undefined ? [] : json['nodes'];
		for (const scene of scenes) {
			nameMustBeText(objectOf(scene));
			for (const node of listOf(objectOf(scene)['nodes'])) {
				const index = indexOf(node);
				// Nodes that are no list are refused once, by the node walk.
				if (Array.isArray(nodes) && !isJsonObject(nodes[index])) {
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

/** The loader follows `children` recursively, so each must be an object, name only nodes that exist and hold none of the kind's forbidden properties, and the children must form a forest: no cycle and no node under two parents. */
function nodeRefusals(json: JsonObject, kind: SceneKind, refusals: Refusal[]): void {
	attemptRead(refusals, 'nodes', () => {
		const nodes = listOf(json['nodes']);
		const childrenOf = new Map<number, readonly number[]>();
		nodes.forEach((entry, nodeIndex) => {
			const place = `nodes[${nodeIndex}]`;
			attemptRead(refusals, place, () => {
				const node = objectOf(entry);
				nameMustBeText(node);
				childrenOf.set(nodeIndex, childrenOfNode(nodes, node, 'refuse'));
				for (const property of kind.forbiddenNodeProperties) {
					if (node[property] !== undefined) {
						refusals.push({ code: kind.contentCode, detail: `${place} holds a ${property}` });
					}
				}
			});
		});
		const inCycle = firstNodeInCycle(childrenOf);
		if (inCycle !== undefined) {
			unreadable(`nodes[${inCycle}] is its own descendant`);
		}
		unlessAChildOfTwoNodes(childrenOf);
	});
}

/** The loader adds each child to its parent, which re-parents a node with two parents to the one it resolves last and draws it under the wrong transform; a node listed twice under one parent is added once. */
function unlessAChildOfTwoNodes(childrenOf: ReadonlyMap<number, readonly number[]>): void {
	const parentOf = new Map<number, number>();
	for (const [parent, children] of childrenOf) {
		for (const child of children) {
			if (parentOf.get(child) !== undefined && parentOf.get(child) !== parent) {
				unreadable(`nodes[${child}] is a child of more than one node`);
			}
			parentOf.set(child, parent);
		}
	}
}

/** What the loader reads as the children of `node`. `refuse` makes a child that is no entry of `nodes` unreadable; `skip` leaves out what is no list or no integer, for a caller that judges no other shape of the children. */
function childrenOfNode(nodes: readonly unknown[], node: JsonObject, onUnreadable: 'refuse' | 'skip'): number[] {
	if (onUnreadable === 'skip') {
		const children = node['children'];
		return Array.isArray(children) ? children.filter((child): child is number => Number.isInteger(child)) : [];
	}
	return listOf(node['children']).map((child) => {
		if (!isJsonObject(nodes[indexOf(child)])) {
			unreadable('children names a node that is no entry of nodes');
		}
		return indexOf(child);
	});
}

/** The shape the scene walk refuses, for a file kind that walks no scene: the children it can read, and nothing it cannot. */
export function sharedChildRefusals(json: JsonObject): Refusal[] {
	const refusals: Refusal[] = [];
	attemptRead(refusals, 'nodes', () => {
		const nodes: unknown[] = Array.isArray(json['nodes']) ? json['nodes'] : [];
		const childrenOf = new Map<number, readonly number[]>();
		for (const [index, node] of nodes.entries()) {
			childrenOf.set(index, childrenOfNode(nodes, isJsonObject(node) ? node : {}, 'skip'));
		}
		unlessAChildOfTwoNodes(childrenOf);
	});
	return refusals;
}

/** The first node, in index order, that a walk of `children` meets again on its own path, or undefined when the nodes form a forest. Iterative, since a file may chain nodes deeper than the stack. */
function firstNodeInCycle(childrenOf: ReadonlyMap<number, readonly number[]>): number | undefined {
	const finished = new Set<number>();
	for (const start of childrenOf.keys()) {
		if (finished.has(start)) {
			continue;
		}
		const path = new Set<number>([start]);
		const pending: { node: number; next: number }[] = [{ node: start, next: 0 }];
		for (let frame = pending.at(-1); frame !== undefined; frame = pending.at(-1)) {
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
