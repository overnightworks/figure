import { describe, expect, it } from 'vitest';
import { checkRoom } from './check.js';
import { buildRoomGlb } from '../tests/roomBuilder.js';
import {
	invalidNodeCases,
	invalidSceneCases,
	missingSceneCases,
	nodeContentCode,
	nodeProperties,
	passingNodeCases,
	sceneMissingCode,
	unreadableGrandchildCase
} from '../tests/sceneCases.js';

type Json = Record<string, any>;

function refusalsOf(change: (json: Json) => void) {
	return checkRoom(buildRoomGlb({ change }));
}

function codesOf(change: (json: Json) => void): string[] {
	return refusalsOf(change).map(({ code }) => code);
}

describe('the scene and node rules a room shares with a clip', () => {
	it.each(missingSceneCases)('refuse %s as room_scene_missing alone', (_name, change) => {
		expect(codesOf(change)).toEqual([sceneMissingCode.room]);
	});

	it.each(invalidSceneCases)('refuse %s as gltf_invalid', (_name, change) => {
		expect(codesOf(change)).toEqual(['gltf_invalid']);
	});

	it.each(invalidNodeCases)('refuse %s as gltf_invalid', (_name, change) => {
		expect(codesOf(change)).toContain('gltf_invalid');
	});

	it.each(passingNodeCases)('pass %s', (_name, change) => {
		expect(codesOf(change)).toEqual([]);
	});

	it('refuse a child whose own children are unreadable once, as gltf_invalid', () => {
		expect(codesOf(unreadableGrandchildCase)).toEqual(['gltf_invalid']);
	});

	it.each(nodeProperties)('judge a node with a %s as the room does, not as the clip does', (property, refusedBy) => {
		const refusals = refusalsOf((json) => (json.nodes[0][property] = 0));
		expect(refusals.map(({ code }) => code)).toEqual(refusedBy.includes('room') ? [nodeContentCode.room] : []);
	});
});
