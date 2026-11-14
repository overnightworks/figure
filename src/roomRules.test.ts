import { describe, expect, it } from 'vitest';
import { checkRoom } from './check.js';
import { buildRoomGlb, type RoomLook, type RoomVariant } from '../tests/roomBuilder.js';
import { invalidReferenceCases } from '../tests/roomCases.js';
import { nodeContentCode, nodeProperties } from '../tests/sceneCases.js';

type Json = Record<string, any>;

function refusalsOf(change: (json: Json) => void, variant: RoomVariant = {}) {
	return checkRoom(buildRoomGlb({ ...variant, change }));
}

function codesOf(change: (json: Json) => void, variant: RoomVariant = {}): string[] {
	return refusalsOf(change, variant).map(({ code }) => code);
}

/** The codes without repeats: a reference two rules both read may be refused by each. */
function distinctCodesOf(change: (json: Json) => void): string[] {
	return [...new Set(codesOf(change))];
}

const looks: RoomLook[] = ['both', 'textured', 'vertexColoured'];

describe('the room rules', () => {
	it.each(looks)('pass the conformant room painted %s with no refusal', (look) => {
		expect(codesOf(() => {}, { look })).toEqual([]);
	});

	it('pass a node that draws a mesh, which a clip forbids', () => {
		expect(codesOf((json) => (json.nodes[0].mesh = 0))).toEqual([]);
	});

	it('pass the extensions the room allows when a texture uses them', () => {
		const change = (json: Json) => {
			json.extensionsUsed.push('KHR_texture_transform', 'EXT_texture_webp');
			json.materials[0].pbrMetallicRoughness.baseColorTexture.extensions = { KHR_texture_transform: { scale: [2, 2] } };
			json.textures[0] = { extensions: { EXT_texture_webp: { source: 0 } } };
		};
		expect(codesOf(change)).toEqual([]);
	});

	describe('what a room may not hold', () => {
		it.each(['skins', 'animations', 'cameras'])('refuses %s as room_content_not_allowed naming it', (property) => {
			expect(refusalsOf((json) => (json[property] = []))).toEqual([{ code: 'room_content_not_allowed', detail: expect.stringContaining(property) }]);
		});

		it.each(nodeProperties.filter(([, refusedBy]) => refusedBy.includes('room')))('refuses a node with a %s as room_content_not_allowed naming it', (property) => {
			expect(refusalsOf((json) => (json.nodes[0][property] = 0))).toEqual([{ code: nodeContentCode.room, detail: expect.stringContaining(property) }]);
		});

		it('refuses a primitive with morph targets as room_content_not_allowed naming them', () => {
			const refusals = refusalsOf((json) => (json.meshes[0].primitives[0].targets = [{ POSITION: 0 }]));
			expect(refusals).toEqual([{ code: 'room_content_not_allowed', detail: expect.stringContaining('targets') }]);
		});

		it('refuses a mesh with weights as room_content_not_allowed naming them', () => {
			const refusals = refusalsOf((json) => (json.meshes[0].weights = [0]));
			expect(refusals).toEqual([{ code: 'room_content_not_allowed', detail: expect.stringContaining('weights') }]);
		});

		it.each([
			['a VRM extension', 'VRMC_vrm'],
			['a light', 'KHR_lights_punctual'],
			['a compression', 'KHR_draco_mesh_compression'],
			['an instancing extension', 'EXT_mesh_gpu_instancing']
		])('refuses %s in extensionsRequired as extension_not_allowed', (_name, extension) => {
			expect(codesOf((json) => (json.extensionsRequired = [extension]))).toEqual(['extension_not_allowed']);
		});
	});

	describe('the materials', () => {
		it.each([
			['a material without extensions', (json: Json) => delete json.materials[0].extensions],
			['a material whose extensions do not hold the unlit one', (json: Json) => (json.materials[0].extensions = { KHR_texture_transform: {} })],
			['a material whose extensions are not an object', (json: Json) => (json.materials[0].extensions = 'KHR_materials_unlit')],
			['a material whose unlit extension is not an object', (json: Json) => (json.materials[0].extensions.KHR_materials_unlit = true)],
			['a lit material of the glTF default model', (json: Json) => (json.materials[0] = { pbrMetallicRoughness: {} })],
			['an unused material that is lit', (json: Json) => json.materials.push({})]
		])('refuses %s as room_material_not_unlit naming the material', (_name, change) => {
			const refusals = refusalsOf(change);
			expect(refusals).toEqual([{ code: 'room_material_not_unlit', detail: expect.stringMatching(/materials\[\d+\]/) }]);
		});

		it('refuses a primitive without a material as room_material_not_unlit naming the primitive, since the default material is lit', () => {
			const refusals = refusalsOf((json) => delete json.meshes[0].primitives[0].material);
			expect(refusals).toEqual([{ code: 'room_material_not_unlit', detail: expect.stringContaining('meshes[0].primitives[0]') }]);
		});

		it('does not read the textures an unlit material never draws', () => {
			const change = (json: Json) => {
				json.materials[0].normalTexture = { index: json.textures.length };
				json.materials[0].occlusionTexture = { index: json.textures.length };
				json.materials[0].emissiveTexture = { index: json.textures.length };
			};
			expect(codesOf(change)).toEqual([]);
		});
	});

	describe('the references the rules walk', () => {
		it.each(invalidReferenceCases)('refuses %s as gltf_invalid', (_name, change) => {
			expect(distinctCodesOf(change)).toEqual(['gltf_invalid']);
		});

		it('names the place that names no entry', () => {
			const refusals = refusalsOf((json) => (json.nodes[2].mesh = json.meshes.length));
			expect(refusals[0]?.detail).toContain('nodes[2]');
		});

		it('leaves a listed Draco object to the extension allowlist', () => {
			const change = (json: Json) => {
				json.extensionsUsed.push('KHR_draco_mesh_compression');
				json.meshes[0].primitives[0].extensions = { KHR_draco_mesh_compression: { bufferView: 0, attributes: {} } };
			};
			expect(codesOf(change)).toEqual(['extension_not_allowed']);
		});

		it('passes a primitive without indices, which is not indexed', () => {
			expect(codesOf((json) => delete json.meshes[0].primitives[0].indices)).toEqual([]);
		});

		it.each([
			['meshes that are not a list', (json: Json) => (json.meshes = {})],
			['a mesh that is not an object', (json: Json) => (json.meshes[1] = null)],
			['primitives that are not a list', (json: Json) => (json.meshes[1].primitives = 'x')],
			['a primitive that is not an object', (json: Json) => (json.meshes[1].primitives = [null])]
		])('leaves %s to the budget rules, which refuse it as gltf_invalid', (_name, change) => {
			expect(distinctCodesOf(change)).toEqual(['gltf_invalid']);
		});

		it('passes a node that draws no mesh', () => {
			expect(codesOf((json) => delete json.nodes[1].mesh)).toEqual([]);
		});
	});
});
