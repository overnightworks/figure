import { describe, expect, it } from 'vitest';
import { mouthShape, type MouthShape } from './expressions.js';
import { createSoundMouth, mouthGoalOfSound, soundLeadSeconds, type SoundMouth } from './soundMouth.js';

const shapes = Object.values(mouthShape);
const sum = (weights: Readonly<Record<MouthShape, number>>) => shapes.reduce((total, shape) => total + weights[shape], 0);
const dominantShape = (weights: Readonly<Record<MouthShape, number>>) => shapes.reduce((best, shape) => (weights[shape] > weights[best] ? shape : best));

/** The sounds espeak's German and English voices give, one array entry each; every one is a row of the table. */
const germanSounds = [
	...['a', 'aː', 'ɛ', 'ɛː', 'e', 'eː', 'ɪ', 'iː', 'i', 'ɔ', 'oː', 'o', 'ʊ', 'uː', 'u', 'œ', 'øː', 'ø', 'ʏ', 'yː', 'y', 'ə', 'ɐ', 'ɑ', 'aɪ', 'aʊ', 'ɔʏ', 'ɔɪ'],
	...['p', 'b', 'm', 'f', 'v', 't', 'd', 'n', 's', 'z', 'ʃ', 'ʒ', 'ç', 'x', 'j', 'ʁ', 'r', 'l', 'k', 'ɡ', 'g', 'ŋ', 'h', 'ʔ', 'p͡f', 't͡s', 't͡ʃ', 'd͡ʒ']
];
const englishSounds = [
	...['ɑː', 'æ', 'ʌ', 'ɔː', 'ɒ', 'ɛ', 'ə', 'ɚ', 'ɜː', 'ɪ', 'iː', 'i', 'ʊ', 'uː', 'u', 'ᵻ', 'ɐ', 'eɪ', 'oʊ', 'əʊ', 'aɪ', 'aʊ', 'ɔɪ', 'ɪə', 'ɛə', 'ʊə', 'e', 'a'],
	...['p', 'b', 'm', 'f', 'v', 'θ', 'ð', 't', 'd', 'n', 's', 'z', 'ʃ', 'ʒ', 'tʃ', 'dʒ', 'k', 'ɡ', 'ŋ', 'h', 'w', 'j', 'ɹ', 'l', 'ɫ', 'ɾ']
];

describe('the table from sounds to a mouth goal', () => {
	it.each([...new Set([...germanSounds, ...englishSounds])])('has a row for %s whose weights are five finite shares of the mouth', (ipa) => {
		const goal = mouthGoalOfSound(ipa);
		expect(goal).toBeDefined();
		shapes.forEach((shape) => {
			expect(goal![shape]).toBeGreaterThanOrEqual(0);
			expect(goal![shape]).toBeLessThanOrEqual(1);
		});
		expect(sum(goal!)).toBeLessThanOrEqual(1);
	});

	it.each(['m', 'b', 'p', 'p͡f'])('closes the lips on %s with all five weights at zero', (ipa) => {
		const goal = mouthGoalOfSound(ipa)!;
		expect(goal.lipsClosed).toBe(true);
		expect(sum(goal)).toBe(0);
	});

	it.each(['f', 'v', 't', 'k', 'ʃ', 'w', 'a', 'ɔ'])('leaves the lips of %s unclosed', (ipa) => {
		expect(mouthGoalOfSound(ipa)!.lipsClosed).not.toBe(true);
	});

	it.each([
		['a', mouthShape.aa],
		['iː', mouthShape.ih],
		['uː', mouthShape.ou],
		['ɛ', mouthShape.ee],
		['ɔ', mouthShape.oh],
		['w', mouthShape.ou]
	] as const)('shows %s with its own shape, %s, the most open', (ipa, shape) => {
		expect(dominantShape(mouthGoalOfSound(ipa)!)).toBe(shape);
	});

	it('takes a sound with its length, stress and combining marks as the sound itself', () => {
		expect(mouthGoalOfSound('aː')).toEqual(mouthGoalOfSound('a'));
		expect(mouthGoalOfSound('ˈa')).toEqual(mouthGoalOfSound('a'));
		expect(mouthGoalOfSound('p͡f')).toEqual(mouthGoalOfSound('pf'));
		expect(mouthGoalOfSound('ã')).toEqual(mouthGoalOfSound('a'));
	});

	it.each(['', ' ', ',', 'q̃x̂', 'not a sound', 'ʘ'])('has no row for %j', (ipa) => {
		expect(mouthGoalOfSound(ipa)).toBeUndefined();
	});
});

/** A sequence in seconds on the answer's clock: a pause, m, a, an unknown click, a pause, b. */
const sequence = [
	{ ipa: ' ', start: 0, end: 0.1 },
	{ ipa: 'm', start: 0.1, end: 0.2 },
	{ ipa: 'a', start: 0.2, end: 0.4 },
	{ ipa: 'ʘ', start: 0.4, end: 0.5 },
	{ ipa: 'b', start: 0.6, end: 0.7 }
];

/** A mouth following `sounds` whose played position and context time the test sets. */
function following(sounds: unknown = sequence): { mouth: SoundMouth; set: (position: number | (() => number), time?: number, running?: boolean) => ReturnType<SoundMouth['goal']> } {
	const mouth = createSoundMouth();
	let position: number | (() => number) = 0;
	mouth.follow({ played: () => (typeof position === 'function' ? position() : position), sounds });
	return {
		mouth,
		set(next, time = 0, running = true) {
			position = next;
			return mouth.goal({ seconds: time, running });
		}
	};
}

describe('the goal the sounds give a frame', () => {
	it('gives the sound that covers the position, ahead by the lead', () => {
		const { set } = following();
		expect(set(0.2 - soundLeadSeconds - 0.01, 0)).toBe(mouthGoalOfSound('m'));
		expect(set(0.3 - soundLeadSeconds, 0.1)).toBe(mouthGoalOfSound('a'));
	});

	it('closes the lips for m and b and shows a between them', () => {
		const { set } = following();
		expect(set(0.1)?.lipsClosed).toBe(true);
		expect(set(0.25, 0.1)?.lipsClosed).not.toBe(true);
		expect(set(0.6, 0.2)?.lipsClosed).toBe(true);
	});

	it('gives no goal for a pause, for an unknown sound, between sounds and before the first one', () => {
		const { set } = following([{ ipa: 'a', start: 1, end: 2 }, { ipa: 'ʘ', start: 2, end: 3 }, { ipa: 'a', start: 3.5, end: 4 }]);
		expect(set(0, 0)).toBeNull();
		expect(set(2.5, 0.1)).toBeNull();
		expect(set(3.2, 0.2)).toBeNull();
	});

	it('finds the sound among many by its start, however long the list', () => {
		const long = Array.from({ length: 200_000 }, (_, index) => ({ ipa: index % 2 === 0 ? 'm' : 'a', start: index * 0.1, end: index * 0.1 + 0.1 }));
		const { set } = following(long);
		expect(set(10_000.05 - soundLeadSeconds, 0)).toBe(mouthGoalOfSound('m'));
		expect(set(10_000.15 - soundLeadSeconds, 0.1)).toBe(mouthGoalOfSound('a'));
	});

	it('gives no goal without sounds, without a clock and for sounds that are not well formed', () => {
		const idle = createSoundMouth();
		expect(idle.goal({ seconds: 0, running: true })).toBeNull();
		const { mouth } = following();
		expect(mouth.goal(null)).toBeNull();
		const malformed: unknown[] = [
			null,
			'a',
			{},
			{ sounds: sequence },
			{ played: 0.3, sounds: sequence },
			{ played: () => 0.3 },
			{ played: () => 0.3, sounds: 'a' },
			{ played: () => 0.3, sounds: [null] },
			{ played: () => 0.3, sounds: [{ ipa: 1, start: 0, end: 1 }] },
			{ played: () => 0.3, sounds: [{ ipa: 'a', start: '0', end: 1 }] },
			{ played: () => 0.3, sounds: [{ ipa: 'a', start: 0, end: Number.NaN }] },
			{ played: () => 0.3, sounds: [{ ipa: 'a', start: 0, end: Infinity }] },
			{ played: () => 0.3, sounds: [{ ipa: 'm', start: 0, end: 1 }, { ipa: 'a', start: 0.5, end: 0.2 }] },
			{ played: () => 0.3, sounds: [{ ipa: 'a', start: 0.5, end: 1 }, { ipa: 'm', start: 0, end: 0.4 }] },
			{
				get played(): never {
					throw new Error('a getter that throws');
				},
				sounds: sequence
			}
		];
		malformed.forEach((value) => {
			const dropped = createSoundMouth();
			dropped.follow(value);
			expect(dropped.goal({ seconds: 0, running: true })).toBeNull();
		});
	});

	it('drops the sounds it followed when the next call has none', () => {
		const { mouth, set } = following();
		expect(set(0.1)).not.toBeNull();
		mouth.follow(undefined);
		expect(mouth.goal({ seconds: 0.1, running: true })).toBeNull();
	});

	it('gives no goal for a read of the position that throws or is no finite number, and the sounds again on the next good read', () => {
		const { set } = following();
		expect(set(0.1, 0)).not.toBeNull();
		[() => Number.NaN, () => Infinity, () => -Infinity, () => 'x' as unknown as number].forEach((bad, index) => {
			expect(set(bad, 0.01 * (index + 1))).toBeNull();
		});
		expect(
			set(() => {
				throw new Error('the player is gone');
			}, 0.1)
		).toBeNull();
		expect(set(0.12, 0.2)?.lipsClosed).toBe(true);
	});

	it('gives no goal while the context does not run, and goes on at the clock\'s place when it runs', () => {
		const { set } = following();
		expect(set(0.1, 0, false)).toBeNull();
		expect(set(0.1, 0, false)).toBeNull();
		expect(set(0.1, 0, true)?.lipsClosed).toBe(true);
		expect(set(0.12, 0.5, true)?.lipsClosed).toBe(true);
	});
});

describe('the stall of the position while the voice waits', () => {
	const closedLipsFalling = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };

	it('rests the mouth while the position stands still and the context\'s clock runs, and follows on when the position moves', () => {
		const { set } = following();
		expect(set(0.25, 0)).toBe(mouthGoalOfSound('a'));
		expect(set(0.25, 0.1)).toEqual(closedLipsFalling);
		expect(set(0.25, 0.2)).toEqual(closedLipsFalling);
		expect(set(0.25, 0.2 + 0.016)).toEqual(closedLipsFalling);
		expect(set(0.25 + 0.016, 0.3)).toBe(mouthGoalOfSound('a'));
	});

	it('rests a stalled mouth with lips that are not the fast closure of m, b and p', () => {
		const { set } = following();
		set(0.25, 0);
		expect(set(0.25, 0.1)?.lipsClosed).not.toBe(true);
	});

	it('keeps resting through frames where neither the position nor the context\'s clock moves, until the position does', () => {
		const { set } = following();
		set(0.25, 1);
		expect(set(0.25, 1.01)).toEqual(closedLipsFalling);
		expect(set(0.25, 1.01)).toEqual(closedLipsFalling);
		expect(set(0.25, 1.01)).toEqual(closedLipsFalling);
		expect(set(0.25 + 0.016, 1.02)).toBe(mouthGoalOfSound('a'));
	});

	it('does not rest the mouth when the context\'s clock has not moved either, as two frames inside one audio callback read it', () => {
		const { set } = following();
		set(0.25, 0);
		expect(set(0.25, 0)).toBe(mouthGoalOfSound('a'));
		expect(set(0.25, 0)).toBe(mouthGoalOfSound('a'));
	});

	it('does not rest the mouth when the position grows with the context\'s clock', () => {
		const { set } = following();
		set(0.2, 0);
		for (let frame = 1; frame < 10; frame++) expect(set(0.2 + frame * 0.01, frame * 0.01)).not.toEqual(closedLipsFalling);
	});

	it('takes the first read after the sounds begin as the baseline and closes nothing', () => {
		const { set } = following();
		expect(set(0.25, 5)).toBe(mouthGoalOfSound('a'));
	});

	it('keeps the baseline at the last good read through frames with no clock', () => {
		const { set } = following();
		set(0.25, 0);
		expect(set(Number.NaN, 0.1)).toBeNull();
		expect(set(0.25, 0.2)).toEqual(closedLipsFalling);
	});

	it('does not rest while the context was suspended, and takes the first running read as a fresh baseline', () => {
		const { set } = following();
		set(0.25, 0);
		expect(set(0.25, 0.5, false)).toBeNull();
		expect(set(0.25, 0.5, true)).toBe(mouthGoalOfSound('a'));
	});

	it('leaves the mouth to the analyser past the last sound, whether the position moves or not', () => {
		const { set } = following();
		set(5, 0);
		expect(set(5, 0.1)).toBeNull();
		expect(set(5.1, 0.2)).toBeNull();
	});

	it('rests the mouth at a stall at the last sound\'s end and no later', () => {
		const { set } = following();
		set(0.7, 0);
		expect(set(0.7, 0.1)).toEqual(closedLipsFalling);
		set(0.7 + 0.001, 0.2);
		expect(set(0.7 + 0.001, 0.3)).toBeNull();
	});

	it('starts a new baseline when the next call brings new sounds on a clock of its own', () => {
		const { mouth, set } = following();
		set(0.25, 0);
		mouth.follow({ played: () => 0, sounds: sequence });
		expect(mouth.goal({ seconds: 0.1, running: true })).not.toEqual(closedLipsFalling);
	});
});

describe('the sounds a mouth follows', () => {
	it('follows a longer list for the same clock without waiting for a position to move', () => {
		const mouth = createSoundMouth();
		const played = () => 3.05 - soundLeadSeconds;
		mouth.follow({ played, sounds: [{ ipa: 'a', start: 0, end: 1 }] });
		expect(mouth.goal({ seconds: 3, running: true })).toBeNull();
		mouth.follow({ played, sounds: [{ ipa: 'a', start: 0, end: 1 }, { ipa: 'm', start: 3, end: 3.1 }] });
		expect(mouth.goal({ seconds: 3.01, running: true })?.lipsClosed).toBe(true);
	});

	it('copies the list it is given, so a host that edits its array afterwards changes nothing', () => {
		const sounds = [{ ipa: 'm', start: 0, end: 1 }];
		const mouth = createSoundMouth();
		mouth.follow({ played: () => 0.5, sounds });
		sounds[0] = { ipa: 'a', start: 0, end: 1 };
		sounds.push({ ipa: 'a', start: 1, end: 2 });
		expect(mouth.goal({ seconds: 0, running: true })?.lipsClosed).toBe(true);
	});

	it('treats an estimated sound as any other', () => {
		const { set } = following([{ ipa: 'm', start: 0, end: 1, estimated: true }]);
		expect(set(0.5)?.lipsClosed).toBe(true);
	});
});
