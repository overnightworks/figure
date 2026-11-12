import { describe, expect, it } from 'vitest';
import { figureMood, mouthShape } from './expressions.js';
import { figureProfile } from './profile.js';

describe('the profile presets', () => {
	// "blink" is the VRM 1.0 preset name, which no module of figure owns.
	it('are the mouth shapes, the blink and the moods in that order', () => {
		expect(figureProfile.presets).toEqual([...Object.values(mouthShape), 'blink', ...Object.values(figureMood)]);
	});

	it('name each preset once', () => {
		expect(new Set(figureProfile.presets).size).toBe(figureProfile.presets.length);
	});
});
