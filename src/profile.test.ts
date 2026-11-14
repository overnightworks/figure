import { describe, expect, it } from 'vitest';
import { figureMood, mouthShape } from './expressions.js';
import { clipProfile, figureProfile, roomProfile } from './profile.js';

describe('the profile presets', () => {
	// "blink" is the VRM 1.0 preset name, which no module of figure owns.
	it('are the mouth shapes, the blink and the moods, and nothing else', () => {
		const owned = [...Object.values(mouthShape), ...Object.values(figureMood)];
		for (const preset of [...owned, 'blink']) expect(figureProfile.presets).toContain(preset);
		expect(figureProfile.presets).toHaveLength(owned.length + 1);
	});

	it('name each preset once', () => {
		expect(new Set(figureProfile.presets).size).toBe(figureProfile.presets.length);
	});
});

describe('the clip profile', () => {
	it('requires the bones the figure profile requires', () => {
		expect(clipProfile.requiredHumanBones).toEqual(figureProfile.requiredHumanBones);
	});
});

describe('the room profile', () => {
	it('allows no VRM extension, no light and no compression', () => {
		for (const extension of roomProfile.allowedExtensions) expect(extension).not.toMatch(/^VRMC_|lights|draco|meshopt|basisu|instancing/i);
	});

	it('sets no budget above the figure profile’s, since a room draws beside a figure', () => {
		expect(roomProfile.fileBudgetBytes).toBeLessThanOrEqual(figureProfile.fileBudgetBytes);
		expect(roomProfile.maxTriangles).toBeLessThanOrEqual(figureProfile.maxTriangles);
		expect(roomProfile.maxTexels).toBeLessThanOrEqual(figureProfile.maxTexels);
		expect(roomProfile.maxTextureSidePixels).toBeLessThanOrEqual(figureProfile.maxTextureSidePixels);
	});
});
