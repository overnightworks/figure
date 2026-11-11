import { describe, expect, it } from 'vitest';
import { checkFigure } from './check.js';
import { figureProfile } from './profile.js';
import { buildVrmGlb, readGlb } from '../tests/figureFixtures.js';
import { buildBudgetVrm } from '../tests/glbBuilder.js';

type Json = Record<string, any>;

const { json, binary } = readGlb(buildVrmGlb());
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
const materialOf = (primitive: Json): Json => json.materials[primitive.material];
const isTextured = (material: Json): boolean => material.pbrMetallicRoughness.baseColorTexture !== undefined;

/** The node each vertex of a primitive is bound to, read from its first joint component. */
function jointNodesOf(primitive: Json): number[] {
	return valuesOf(primitive.attributes.JOINTS_0)
		.filter((_, index) => index % 4 === 0)
		.map((joint) => json.skins[0].joints[joint]);
}

/** The position deltas of a bound morph target, all the primitives of its mesh together. */
function deltasOf(name: string): number[] {
	const bind = vrm.expressions.preset[name].morphTargetBinds[0];
	return json.meshes[nodes[bind.node].mesh].primitives.flatMap((primitive: Json) => valuesOf(primitive.targets[bind.index].POSITION));
}

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
	it('holds skinned meshes whose nodes all name the one skin', () => {
		const skinned = nodes.filter((node) => node.mesh !== undefined);
		expect(skinned.length).toBeGreaterThan(0);
		expect(skinned.every((node) => node.skin === 0)).toBe(true);
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
	});

	it('paints the skin with the textured material and nothing else with it', () => {
		const skinJoints = [boneNode('spine'), boneNode('chest'), boneNode('head')];
		const textured = primitives.filter((primitive) => isTextured(materialOf(primitive)));
		expect(textured.length).toBeGreaterThan(0);
		expect(textured.every((primitive) => skinJoints.includes(jointNodesOf(primitive)[0]!))).toBe(true);
	});

	it('gives the eyes, the nose and the features untextured materials, each a colour of its own', () => {
		const untextured = [...new Set(primitives.filter((primitive) => !isTextured(materialOf(primitive))).map((primitive) => primitive.material))];
		const colours = untextured.map((index) => JSON.stringify(json.materials[index].pbrMetallicRoughness.baseColorFactor));
		expect(untextured.length).toBeGreaterThanOrEqual(3);
		expect(new Set(colours).size).toBe(colours.length);
	});
});

describe('the eyes and the look-at (schema: VRMC_vrm.humanoid and VRMC_vrm.lookAt)', () => {
	it('hangs the left and right eye from the head, on the left and right side of the figure', () => {
		expect(parentOf(boneNode('leftEye'))).toBe(boneNode('head'));
		expect(parentOf(boneNode('rightEye'))).toBe(boneNode('head'));
		expect(worldPosition(boneNode('leftEye'))[0]).toBeGreaterThan(0);
		expect(worldPosition(boneNode('rightEye'))[0]).toBeLessThan(0);
	});

	it.each(['leftEye', 'rightEye'])('skins %s to its eye bone with an untextured material', (eye) => {
		const eyePrimitives = primitives.filter((primitive) => jointNodesOf(primitive)[0] === boneNode(eye));
		expect(eyePrimitives.length).toBeGreaterThan(0);
		expect(eyePrimitives.every((primitive) => !isTextured(materialOf(primitive)))).toBe(true);
	});

	it('gives the look-at the bone type and the eyes\' midpoint as its offset from the head', () => {
		const lookAt = vrm.lookAt;
		const eyeMidpoint = [0, 1, 2].map((axis) => (worldPosition(boneNode('leftEye'))[axis]! + worldPosition(boneNode('rightEye'))[axis]!) / 2);
		const offsetFromHead = eyeMidpoint.map((value, axis) => value - worldPosition(boneNode('head'))[axis]!);

		expect(lookAt.type).toBe('bone');
		lookAt.offsetFromHeadBone.forEach((value: number, axis: number) => expect(value).toBeCloseTo(offsetFromHead[axis]!));
	});

	it.each(['rangeMapHorizontalInner', 'rangeMapHorizontalOuter', 'rangeMapVerticalDown', 'rangeMapVerticalUp'])(
		'gives the look-at %s an input and an output scale',
		(map) => {
			expect(vrm.lookAt[map].inputMaxValue).toBeGreaterThan(0);
			expect(vrm.lookAt[map].outputScale).toBeGreaterThan(0);
		}
	);
});

describe('the expressions (schema: VRMC_vrm.expressions.expression.morphTargetBind.schema.json)', () => {
	it('points the blink at a morph target that the mesh of its node carries', () => {
		const bind = vrm.expressions.preset.blink.morphTargetBinds[0];
		const mesh = json.meshes[nodes[bind.node].mesh];
		expect(mesh.primitives[0].targets).toHaveLength(bind.index + 1);
	});

	it.each(figureProfile.presets)('binds %s to a morph target with node, index and weight that moves vertices', (name) => {
		const bind = vrm.expressions.preset[name].morphTargetBinds[0];
		expect(Object.keys(bind).sort()).toEqual(['index', 'node', 'weight']);
		expect(deltasOf(name).some((delta) => delta !== 0)).toBe(true);
	});

	it('gives every mesh the same number of morph targets on each primitive, as glTF 2.0 requires', () => {
		for (const mesh of json.meshes) {
			expect(new Set(mesh.primitives.map((primitive: Json) => primitive.targets?.length ?? 0)).size).toBe(1);
		}
	});

	it('gives each preset a shape of its own', () => {
		const shapes = figureProfile.presets.map((name) => JSON.stringify(deltasOf(name)));
		expect(new Set(shapes).size).toBe(figureProfile.presets.length);
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
