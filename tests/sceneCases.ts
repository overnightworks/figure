/** The scene and node cases both a clip and a room answer to: the loader walks the default scene and every node's children for either. A test file drives them through the check of its kind. */

type Json = Record<string, any>;
type Change = (json: Json) => void;

export type SceneKind = 'clip' | 'room';

/** The code each kind gives for a file without a scene, and for a node that holds a property the kind forbids. */
export const sceneMissingCode = { clip: 'clip_scene_missing', room: 'room_scene_missing' } as const;
export const nodeContentCode = { clip: 'clip_content_not_allowed', room: 'room_content_not_allowed' } as const;

export const missingSceneCases: readonly (readonly [name: string, change: Change])[] = [
	['no scenes', (json) => delete json.scenes],
	['an empty scenes list', (json) => (json.scenes = [])]
];

/** Each is refused as `gltf_invalid` alone. */
export const invalidSceneCases: readonly (readonly [name: string, change: Change])[] = [
	['scenes that is not a list', (json) => (json.scenes = {})],
	['a scene index that names no scene', (json) => (json.scene = json.scenes.length)],
	['a scene that is not an object', (json) => (json.scenes = [null])],
	['a scene whose nodes is not a list', (json) => (json.scenes[0].nodes = 0)],
	['a scene that names a node that is no entry of nodes', (json) => json.scenes[0].nodes.push(json.nodes.length)],
	['a scene that names a node by an index that is not an integer', (json) => (json.scenes[0].nodes[0] = '0')]
];

/** Each is refused as `gltf_invalid`, beside any other refusal the shape draws. */
export const invalidNodeCases: readonly (readonly [name: string, change: Change])[] = [
	['a nodes entry that is not an object', (json) => json.nodes.push(null)],
	['nodes that is not a list', (json) => (json.nodes = {})],
	['a children that is not a list', (json) => (json.nodes[0].children = 1)],
	['a children index that names no node', (json) => (json.nodes[0].children = [json.nodes.length])],
	[
		'a children index that names an entry of nodes that is not an object',
		(json) => {
			json.nodes.push(null);
			json.nodes[0].children = [json.nodes.length - 1];
		}
	],
	['a children index that is not an integer', (json) => (json.nodes[0].children = ['1'])],
	['a node that is its own child', (json) => (json.nodes[0].children = [0])],
	[
		"two nodes that are each other's child",
		(json) => {
			json.nodes[0].children = [1];
			json.nodes[1].children = [0];
		}
	],
	[
		"three nodes that are each other's descendant in a ring",
		(json) => {
			json.nodes[0].children = [1];
			json.nodes[1].children = [2];
			json.nodes[2].children = [0];
		}
	],
	[
		'a node under a cycle that does not contain it',
		(json) => {
			json.nodes[0].children = [1];
			json.nodes[1].children = [2];
			json.nodes[2].children = [1];
		}
	],
	['a node whose name is a number', (json) => (json.nodes[0].name = 5)],
	['a node whose name is null', (json) => (json.nodes[0].name = null)],
	['a scene whose name is a number', (json) => (json.scenes[0].name = 5)]
];

export const passingNodeCases: readonly (readonly [name: string, change: Change])[] = [
	['a node whose children name nodes', (json) => (json.nodes[0].children = [1, 2])],
	[
		'two nodes that share a child, which is no cycle',
		(json) => {
			json.nodes[0].children = [2];
			json.nodes[1].children = [2];
		}
	],
	[
		'text names on nodes and scenes',
		(json) => {
			json.nodes[0].name = 'root';
			json.scenes[0].name = 'scene';
		}
	],
	['no default scene', (json) => delete json.scene]
];

/** A child whose own children are unreadable is refused once. */
export const unreadableGrandchildCase: Change = (json) => {
	json.nodes[0].children = [1];
	json.nodes[1].children = ['2'];
};

/** A node property the clip forbids, and whether the room forbids it too: a room's node may draw a mesh. */
export const nodeProperties: readonly (readonly [property: string, refusedBy: readonly SceneKind[]])[] = [
	['mesh', ['clip']],
	['camera', ['clip', 'room']],
	['skin', ['clip', 'room']]
];
