import { describe, expect, it } from 'vitest';
import { figureMood, mouthShape } from './expressions.js';
import { figureProfile } from './profile.js';

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
