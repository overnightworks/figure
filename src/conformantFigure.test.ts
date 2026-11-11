import { describe, expect, it } from 'vitest';
import { checkFigure } from './check.js';
import { figureProfile } from './profile.js';
import { buildVrmGlb, vrmParts } from '../tests/figureFixtures.js';
import { buildBudgetVrm } from '../tests/glbBuilder.js';

type Json = Record<string, any>;

const { json, binary } = vrmParts();
const vrm = json.extensions.VRMC_vrm;
const nodes: Json[] = json.nodes;

const componentBytes: Record<number, number> = { 5121: 1, 5123: 2, 5126: 4 };
const componentCounts: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** The numbers an accessor points at, read by the rules of glTF 2.0 section 3.6 from the binary chunk. */
function valuesOf(accessorIndex: number): number[] {
	const accessor = json.accessors[accessorIndex];
	const view = json.bufferViews[accessor.bufferView];
	const data = new DataView(binary.buffer, binary.byteOffset + view.byteOffset, view.byteLength);
	const reads: Record<number, (offset: number) => number> = {
		5121: (offset) => data.getUint8(offset),
		5123: (offset) => data.getUint16(offset, true),
		5126: (offset) => data.getFloat32(offset, true)
	};
	const count = accessor.count * componentCounts[accessor.type]!;
	return Array.from({ length: count }, (_, index) => reads[accessor.componentType]!(index * componentBytes[accessor.componentType]!));
}

function parentOf(node: number): number | undefined {
	const parent = nodes.findIndex((candidate) => candidate.children?.includes(node));
	return parent < 0 ? undefined : parent;
}

function rootOf(node: number): number {
	const parent = parentOf(node);
	return parent === undefined ? node : rootOf(parent);
}

function worldPosition(node: number): number[] {
	const parent = parentOf(node);
	const base = parent === undefined ? [0, 0, 0] : worldPosition(parent);
	return base.map((value, axis) => value + nodes[node]!.translation[axis]);
}

const boneNode = (name: string): number => vrm.humanoid.humanBones[name].node;
const primitives: Json[] = json.meshes.flatMap((mesh: Json) => mesh.primitives);

describe('the conformant synthetic VRM (VRMC_vrm-1.0 schema: VRMC_vrm.humanoid.humanBones.schema.json)', () => {
	it('passes the check with no refusal', () => {
		expect(checkFigure(buildVrmGlb())).toEqual([]);
	});

	it('names every required bone and puts chest and neck between spine and head', () => {
		for (const bone of figureProfile.requiredHumanBones) {
			expect(nodes[boneNode(bone)]?.name).toBe(bone);
		}
		expect([parentOf(boneNode('head')), parentOf(boneNode('neck')), parentOf(boneNode('chest'))]).toEqual([
			boneNode('neck'),
			boneNode('chest'),
			boneNode('spine')
		]);
	});

	it('hangs every bone from the hips with a translation of its own', () => {
		const bones = Object.values<Json>(vrm.humanoid.humanBones).map(({ node }) => node);
		for (const bone of bones) {
			expect(nodes[bone]?.translation).toHaveLength(3);
			expect(rootOf(bone)).toBe(boneNode('hips'));
		}
	});

	it('stands the head above the chest and the feet below the hips', () => {
		expect(worldPosition(boneNode('head'))[1]).toBeGreaterThan(worldPosition(boneNode('chest'))[1]!);
		expect(worldPosition(boneNode('leftFoot'))[1]).toBeLessThan(worldPosition(boneNode('hips'))[1]!);
	});
});

describe('the conformant synthetic VRM as glTF 2.0 meshes and skin (sections 3.7 and 3.10)', () => {
	it('holds two skinned meshes whose nodes name the one skin', () => {
		const skinned = nodes.filter((node) => node.mesh !== undefined);
		expect(skinned.map((node) => node.skin)).toEqual([0, 0]);
		expect(json.skins).toHaveLength(1);
	});

	it('gives every vertex attribute of a primitive the same count and indices that stay in range', () => {
		for (const { attributes, indices } of primitives) {
			const counts = Object.values<number>(attributes).map((accessor) => json.accessors[accessor].count);
			expect(new Set(counts).size).toBe(1);
			expect(Math.max(...valuesOf(indices))).toBeLessThan(counts[0]!);
			expect(valuesOf(indices).length % 3).toBe(0);
		}
	});

	it('binds each vertex to a joint of the skin with weights adding up to 1', () => {
		for (const { attributes } of primitives) {
			expect(Math.max(...valuesOf(attributes.JOINTS_0))).toBeLessThan(json.skins[0].joints.length);
			const weights = valuesOf(attributes.WEIGHTS_0);
			for (let vertex = 0; vertex < weights.length; vertex += 4) {
				expect(weights[vertex]! + weights[vertex + 1]! + weights[vertex + 2]! + weights[vertex + 3]!).toBeCloseTo(1);
			}
		}
	});

	it('states POSITION bounds that hold the positions', () => {
		for (const { attributes } of primitives) {
			const { min, max } = json.accessors[attributes.POSITION];
			valuesOf(attributes.POSITION).forEach((value, index) => {
				expect(value).toBeGreaterThanOrEqual(min[index % 3]);
				expect(value).toBeLessThanOrEqual(max[index % 3]);
			});
		}
	});

	it('gives each joint the inverse of its world translation as inverse bind matrix', () => {
		const matrices = valuesOf(json.skins[0].inverseBindMatrices);
		json.skins[0].joints.forEach((joint: number, index: number) => {
			const column = matrices.slice(16 * index + 12, 16 * index + 15);
			expect(column).toEqual(worldPosition(joint).map((value) => expect.closeTo(-value, 5)));
		});
	});

	it('skins the torso to spine and chest and the head to the head bone', () => {
		const jointNodes = (mesh: number) => [...new Set(valuesOf(json.meshes[mesh].primitives[0].attributes.JOINTS_0).filter((_, index) => index % 4 === 0))].map((joint) => json.skins[0].joints[joint]);
		expect(jointNodes(0).sort()).toEqual([boneNode('spine'), boneNode('chest')].sort());
		expect(jointNodes(1)).toEqual([boneNode('head')]);
	});

	it('reads its texture from an image through a core material and no extension but VRMC_vrm', () => {
		const texture = json.textures[json.materials[0].pbrMetallicRoughness.baseColorTexture.index];
		expect(json.images[texture.source].mimeType).toBe('image/png');
		expect(json.extensionsUsed).toEqual(['VRMC_vrm']);
		expect(json.materials[0].extensions).toBeUndefined();
		expect(primitives.map((primitive) => primitive.material)).toEqual([0, 0]);
	});
});

describe('the blink expression (schema: VRMC_vrm.expressions.expression.morphTargetBind.schema.json)', () => {
	const bind = vrm.expressions.preset.blink.morphTargetBinds[0];

	it('binds a morph target of the head mesh with node, index and weight', () => {
		expect(Object.keys(bind).sort()).toEqual(['index', 'node', 'weight']);
		const mesh = json.meshes[nodes[bind.node].mesh];
		expect(mesh.primitives[0].targets).toHaveLength(bind.index + 1);
	});

	it('moves vertices of the head', () => {
		const target = json.meshes[nodes[bind.node].mesh].primitives[0].targets[bind.index];
		expect(valuesOf(target.POSITION).some((delta) => delta !== 0)).toBe(true);
	});

	it('leaves every other preset empty', () => {
		const others = figureProfile.presets.filter((name) => name !== 'blink');
		expect(others.map((name) => vrm.expressions.preset[name])).toEqual(others.map(() => ({})));
	});
});

describe('the synthetic VRM at the budgets', () => {
	const { glb, morphTargets } = buildBudgetVrm(figureProfile, figureProfile);
	const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
	const budgetJson: Json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + view.getUint32(12, true))));
	const budgetPrimitives: Json[] = budgetJson.meshes.flatMap((mesh: Json) => mesh.primitives);
	const binaryStart = 20 + view.getUint32(12, true) + 8;

	it('passes the check with no refusal', () => {
		expect(checkFigure(glb)).toEqual([]);
	});

	it('names every image through a texture that its material uses, so a renderer loads all of them', () => {
		const material = budgetJson.materials[0];
		const slots = [material.pbrMetallicRoughness.baseColorTexture, material.emissiveTexture, material.occlusionTexture, material.normalTexture];
		const usedSources = slots.filter((slot) => slot !== undefined).map((slot) => budgetJson.textures[slot.index].source);
		expect(usedSources.sort()).toEqual(budgetJson.images.map((_: Json, image: number) => image));
	});

	it('fills the triangle budget exactly', () => {
		const triangles = budgetPrimitives.reduce((sum, primitive) => sum + budgetJson.accessors[primitive.indices].count / 3, 0);
		expect(triangles).toBe(figureProfile.maxTriangles);
	});

	it('fills the texel budget exactly, with no image longer than the side budget', () => {
		const sizes = budgetJson.images.map((image: Json) => {
			const header = budgetJson.bufferViews[image.bufferView].byteOffset + binaryStart + 16;
			return [view.getUint32(header), view.getUint32(header + 4)];
		});
		expect(sizes.reduce((sum: number, [width, height]: number[]) => sum + width! * height!, 0)).toBe(figureProfile.maxTexels);
		expect(Math.max(...sizes.flat())).toBeLessThanOrEqual(figureProfile.maxTextureSidePixels);
	});

	it('gives one primitive the morph targets the file budget leaves, no more than the profile allows', () => {
		expect(Math.max(...budgetPrimitives.map((primitive) => primitive.targets?.length ?? 0))).toBe(morphTargets);
		expect(morphTargets).toBeGreaterThan(1);
		expect(morphTargets).toBeLessThanOrEqual(figureProfile.maxMorphTargetsPerPrimitive);
		expect(glb.length).toBeLessThanOrEqual(figureProfile.fileBudgetBytes);
	});
});
