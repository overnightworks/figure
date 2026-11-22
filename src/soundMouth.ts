import { mouthShape, type MouthShape } from './expressions.js';
import type { SpokenSounds } from './mountOptions.js';
import type { VowelWeights } from './vowelWeights.js';

/**
 * The mouth the sounds speech times give, with no three and no DOM: the one table from a sound to a mouth goal and the choice, per
 * frame, of the goal the voice's position asks for. A goal is the five mouth weights, or closed lips, which `lipsClosed` marks and
 * which the mouth's easing reaches fast. A moment no known sound covers has no goal, and the analyser's mouth goes on there.
 */
export type MouthGoal = VowelWeights & { readonly lipsClosed?: true };

/** The two clocks of the voice a frame reads: whether its audio context runs and how many seconds that context has run. */
export interface VoiceClock {
	readonly running: boolean;
	readonly seconds: number;
}

/** How far the mouth leads the sound, in seconds: a picture ahead of its sound is noticed only beyond about 0.125 s, one behind it beyond about 0.045 s. */
export const soundLeadSeconds = 0.05;

const stillMouth: VowelWeights = Object.freeze({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 });
const closedLips: MouthGoal = Object.freeze({ ...stillMouth, lipsClosed: true });
const { aa, ih, ou, ee, oh } = mouthShape;

/** Each row gives the goal of the sounds it lists, written without length, stress and combining marks. */
type Row = readonly [sounds: readonly string[], goal: MouthGoal];

const shaped = (shares: Partial<Record<MouthShape, number>>): MouthGoal => Object.freeze({ ...stillMouth, ...shares });

/**
 * Every sound espeak's German and English voices give, as the shapes it is closest to, by the opening it has; vowels and diphthongs
 * blend the shapes they pass through. A consonant with no lip shape of its own shows the slight shape its neighbours' lips take: the
 * teeth ones spread a little, the postalveolar ones round, the back ones sit open.
 */
const rows: readonly Row[] = [
	[['p', 'b', 'm', 'pf'], closedLips],
	[['a', 'ɑ', 'ɐ'], shaped({ [aa]: 1 })],
	[['æ'], shaped({ [aa]: 0.7, [ee]: 0.25 })],
	[['ʌ'], shaped({ [aa]: 0.7 })],
	[['ɛ', 'e', 'ɜ'], shaped({ [ee]: 0.8 })],
	[['ə', 'ᵻ'], shaped({ [ee]: 0.3 })],
	[['ɚ'], shaped({ [ee]: 0.3, [ou]: 0.1 })],
	[['ɪ'], shaped({ [ih]: 0.6 })],
	[['i'], shaped({ [ih]: 0.8 })],
	[['ɔ', 'ɒ', 'o'], shaped({ [oh]: 0.9 })],
	[['ʊ'], shaped({ [ou]: 0.7 })],
	[['u'], shaped({ [ou]: 0.9 })],
	[['y'], shaped({ [ih]: 0.4, [ou]: 0.4 })],
	[['ʏ'], shaped({ [ih]: 0.3, [ou]: 0.3 })],
	[['ø', 'œ'], shaped({ [ee]: 0.4, [oh]: 0.4 })],
	[['aɪ'], shaped({ [aa]: 0.7, [ih]: 0.3 })],
	[['aʊ'], shaped({ [aa]: 0.6, [ou]: 0.4 })],
	[['ɔɪ', 'ɔʏ', 'ɔy'], shaped({ [oh]: 0.6, [ih]: 0.3 })],
	[['eɪ'], shaped({ [ee]: 0.6, [ih]: 0.3 })],
	[['oʊ', 'əʊ'], shaped({ [oh]: 0.6, [ou]: 0.3 })],
	[['ɪə'], shaped({ [ih]: 0.4, [ee]: 0.3 })],
	[['ɛə'], shaped({ [ee]: 0.6 })],
	[['ʊə'], shaped({ [ou]: 0.5, [ee]: 0.2 })],
	[['f', 'v'], shaped({ [ih]: 0.15 })],
	[['w', 'ʍ'], shaped({ [ou]: 0.7 })],
	[['j'], shaped({ [ih]: 0.5 })],
	[['ɹ', 'r', 'ɾ', 'ʁ'], shaped({ [ou]: 0.3 })],
	[['l', 'ɫ', 'h', 'ʔ'], shaped({ [aa]: 0.2 })],
	[['t', 'd', 'n', 's', 'z', 'θ', 'ð', 'ts', 'dz'], shaped({ [ih]: 0.25 })],
	[['ʃ', 'ʒ', 'tʃ', 'dʒ'], shaped({ [ou]: 0.35 })],
	[['k', 'ɡ', 'g', 'ŋ', 'x'], shaped({ [ee]: 0.25 })],
	[['ç'], shaped({ [ih]: 0.3 })]
];

const table: ReadonlyMap<string, MouthGoal> = new Map(rows.flatMap(([sounds, goal]) => sounds.map((sound): [string, MouthGoal] => [sound, goal])));

/** What a sound is looked up by: its length marks, stress marks and other modifiers and combining marks dropped (a tie bar leaves its two letters). */
const markless = /[\p{M}\p{Lm}]/gu;

/** The goal of the sound `ipa`, or undefined for one the table does not know, a pause included. */
export function mouthGoalOfSound(ipa: string): MouthGoal | undefined {
	return table.get(ipa) ?? table.get(ipa.normalize('NFD').replace(markless, ''));
}

/** A sound with its goal resolved, or null where the table has none. */
interface Span {
	readonly start: number;
	readonly end: number;
	readonly goal: MouthGoal | null;
}

/** The answer's sounds as they are followed: the player's read and the spans, sorted by start. */
interface Followed {
	readonly played: () => number;
	readonly spans: readonly Span[];
	readonly end: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** The sounds a host handed over, copied and resolved once, or undefined for anything that is not a well-formed `SpokenSounds`: whatever the host passes is judged by what it answers. */
function followedOf(value: unknown): Followed | undefined {
	try {
		if (!isRecord(value) || typeof value.played !== 'function' || !Array.isArray(value.sounds)) return undefined;
		const played = value.played as SpokenSounds['played'];
		const spans: Span[] = [];
		let end = -Infinity;
		for (const sound of value.sounds as unknown[]) {
			if (!isRecord(sound) || typeof sound.ipa !== 'string') return undefined;
			const { start, end: stop } = sound;
			if (typeof start !== 'number' || typeof stop !== 'number' || !Number.isFinite(start) || !Number.isFinite(stop) || stop < start) return undefined;
			if (start < (spans.at(-1)?.start ?? -Infinity)) return undefined;
			spans.push({ start, end: stop, goal: mouthGoalOfSound(sound.ipa) ?? null });
			end = Math.max(end, stop);
		}
		return { played: () => played.call(value), spans, end };
	} catch {
		return undefined;
	}
}

/** The goal of the sound that covers `seconds`, found by the last start at or before it, or null where none does or the sound is unknown. */
function goalAt(spans: readonly Span[], seconds: number): MouthGoal | null {
	let low = 0;
	let high = spans.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (spans[middle]!.start <= seconds) low = middle + 1;
		else high = middle;
	}
	const span = spans[low - 1];
	return span !== undefined && seconds < span.end ? span.goal : null;
}

/** The player's position in seconds, or undefined for a read that throws or gives no finite number. */
function positionOf(followed: Followed): number | undefined {
	try {
		const position: unknown = followed.played();
		return typeof position === 'number' && Number.isFinite(position) ? position : undefined;
	} catch {
		return undefined;
	}
}

export interface SoundMouth {
	/** Follows `sounds` until the next call, which replaces them: anything that is no well-formed `SpokenSounds`, undefined included, drops them, and the first position read after a call is a baseline. */
	follow(sounds: unknown): void;
	/**
	 * The goal for one drawn frame, or null where the analyser's mouth goes on: no sounds, no clock (a null `voice`, or a read of the position that throws or is not finite),
	 * a context that does not run, a moment no known sound covers, and the moments past the last sound. While the position stands still though the voice's context has run on, and it
	 * is not past the last sound, the goal is the still mouth, which the mouth eases to at its ordinary fall; the rest lasts until the position moves.
	 */
	goal(voice: VoiceClock | null): MouthGoal | null;
}

/** The mouth the sounds drive: the sounds being followed, the last good read of the position and of the voice's clock, which a stall is told from, and whether the position stands stalled. */
export function createSoundMouth(): SoundMouth {
	let followed: Followed | undefined;
	let baseline: { readonly position: number; readonly seconds: number } | undefined;
	let stalled = false;
	return {
		follow(sounds) {
			followed = followedOf(sounds);
			baseline = undefined;
			stalled = false;
		},
		goal(voice) {
			if (followed === undefined || voice === null) return null;
			const position = positionOf(followed);
			if (position === undefined) return null;
			const previous = baseline;
			baseline = { position, seconds: voice.seconds };
			if (!voice.running) return null;
			if (previous === undefined || position > previous.position) stalled = false;
			else if (voice.seconds > previous.seconds) stalled = true;
			if (stalled && position <= followed.end) return stillMouth;
			return goalAt(followed.spans, position + soundLeadSeconds);
		}
	};
}
