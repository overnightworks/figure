import { describe, expect, it } from 'vitest';
import { mouthShape, type MouthShape } from './expressions.js';
import { vowelWeights } from './vowelWeights.js';

/** A small seeded source of numbers in [0, 1) (mulberry32), so a run is the same every time. */
function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
	};
}

type Speaker = 'man' | 'woman';

/**
 * The first three formants in Hz of the vowels in Peterson and Barney (1952), "Control methods used in a study of the vowels",
 * Journal of the Acoustical Society of America 24(2), table V, the averages of the men and of the women. The mouth shape of a
 * vowel is the VRM name of the English vowel it opens the mouth for: aa is /ɑ/ (hot), ih is /i/ (heed), ou is /u/ (who'd),
 * ee is /ɛ/ (head) and oh is /ɔ/ (hawed).
 */
const publishedFormants: Record<Speaker, Record<MouthShape, readonly [number, number, number]>> = {
	man: {
		aa: [730, 1090, 2440],
		ih: [270, 2290, 3010],
		ou: [300, 870, 2240],
		ee: [530, 1840, 2480],
		oh: [570, 840, 2410]
	},
	woman: {
		aa: [850, 1220, 2810],
		ih: [310, 2790, 3310],
		ou: [370, 950, 2670],
		ee: [610, 2330, 2990],
		oh: [590, 920, 2710]
	}
};

/** Typical formant bandwidths in Hz of Klatt (1980), "Software for a cascade/parallel formant synthesizer", JASA 67(3). */
const formantBandwidths = [60, 90, 150] as const;

const sampleRate = 48_000;
const blockLength = 2048;
const warmUpLength = 4096;
const pitchJitterShare = 0.02;
const glottalTilt = 0.95;

interface VoiceOptions {
	readonly speaker: Speaker;
	readonly vowel: MouthShape;
	readonly pitchHz: number;
	readonly rate: number;
	readonly rms: number;
	readonly noiseShare: number;
	readonly seed: number;
}

/** Impulses one jittered pitch period apart. */
function pulseTrain(length: number, pitchHz: number, rate: number, random: () => number): Float64Array {
	const pulses = new Float64Array(length);
	let position = 0;
	while (position < length) {
		pulses[Math.floor(position)] = 1;
		position += (rate / pitchHz) * (1 + pitchJitterShare * (2 * random() - 1));
	}
	return pulses;
}

/** The pulses through a one-pole low-pass, which tilts the source spectrum down as a glottal flow does. */
function tilted(pulses: Float64Array): Float64Array {
	const flow = new Float64Array(pulses.length);
	pulses.forEach((pulse, index) => {
		flow[index] = pulse + glottalTilt * (flow[index - 1] ?? 0);
	});
	return flow;
}

/** One digital resonator of Klatt (1980) at a formant frequency and bandwidth. */
function resonated(input: Float64Array, frequencyHz: number, bandwidthHz: number, rate: number): Float64Array {
	const decay = Math.exp((-Math.PI * bandwidthHz) / rate);
	const feedback = 2 * decay * Math.cos((2 * Math.PI * frequencyHz) / rate);
	const feedbackTwo = -decay * decay;
	const output = new Float64Array(input.length);
	input.forEach((sample, index) => {
		output[index] = (1 - feedback - feedbackTwo) * sample + feedback * (output[index - 1] ?? 0) + feedbackTwo * (output[index - 2] ?? 0);
	});
	return output;
}

function rootMeanSquare(samples: ArrayLike<number>): number {
	return Math.sqrt(Array.from(samples).reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
}

function scaledToRms(samples: Float64Array, rms: number): Float64Array {
	const gain = rms / rootMeanSquare(samples);
	return samples.map((sample) => sample * gain);
}

/** Approximately Gaussian noise of unit variance, the sum of twelve uniform numbers. */
function noiseSample(random: () => number): number {
	return Array.from({ length: 12 }, random).reduce((sum, uniform) => sum + uniform, -6);
}

/** One block of a sustained vowel: a jittered glottal pulse train through three formant resonators, plus noise at a share of the voice's level. */
function voicedBlock(options: VoiceOptions): Float32Array {
	const random = seededRandom(options.seed);
	const formants = publishedFormants[options.speaker][options.vowel];
	const voice = formants.reduce(
		(signal, frequencyHz, index) => resonated(signal, frequencyHz, formantBandwidths[index] ?? 0, options.rate),
		tilted(pulseTrain(warmUpLength + blockLength, options.pitchHz, options.rate, random))
	);
	const level = scaledToRms(voice.slice(warmUpLength), options.rms);
	return Float32Array.from(level, (sample) => sample + options.noiseShare * options.rms * noiseSample(random));
}

const speakers: readonly Speaker[] = ['man', 'woman'];
const vowels = Object.values(mouthShape);
const pitches = [100, 130, 160, 190, 220, 250];
const defaultVoice: VoiceOptions = { speaker: 'man', vowel: 'aa', pitchHz: 130, rate: sampleRate, rms: 0.2, noiseShare: 0.03, seed: 7 };

function strongest(weights: Readonly<Record<MouthShape, number>>): MouthShape | undefined {
	return vowels.reduce<MouthShape | undefined>((best, vowel) => (best === undefined || weights[vowel] > weights[best] ? vowel : best), undefined);
}

describe('vowelWeights of a voiced vowel', () => {
	const cases = [48_000, 44_100].flatMap((rate) =>
		speakers.flatMap((speaker) => vowels.flatMap((vowel) => pitches.map((pitchHz) => ({ rate, speaker, vowel, pitchHz }))))
	);

	it.each(cases)('weighs the mouth shape of $vowel highest for a $speaker at $pitchHz Hz sampled at $rate Hz', ({ rate, speaker, vowel, pitchHz }) => {
		const block = voicedBlock({ ...defaultVoice, speaker, vowel, pitchHz, rate, seed: pitchHz });
		expect(strongest(vowelWeights(block, rate))).toBe(vowel);
	});

	it('weighs every mouth shape between 0 and 1', () => {
		const weights = vowelWeights(voicedBlock(defaultVoice), sampleRate);
		for (const vowel of vowels) {
			expect(weights[vowel]).toBeGreaterThanOrEqual(0);
			expect(weights[vowel]).toBeLessThanOrEqual(1);
		}
	});

	const otherRates = [32_000, 22_050, 16_000, 11_025];
	const otherRateCases = otherRates.flatMap((rate) => speakers.flatMap((speaker) => vowels.map((vowel) => ({ rate, speaker, vowel }))));

	it.each(otherRateCases)('finds the vowel $vowel of a $speaker in a block sampled at $rate Hz', ({ rate, speaker, vowel }) => {
		expect(strongest(vowelWeights(voicedBlock({ ...defaultVoice, speaker, vowel, rate }), rate))).toBe(vowel);
	});

	it('leaves the block unchanged and gives the same weights twice', () => {
		const block = voicedBlock(defaultVoice);
		const copy = Float32Array.from(block);
		expect(vowelWeights(block, sampleRate)).toEqual(vowelWeights(block, sampleRate));
		expect(block).toEqual(copy);
	});

	it('reads only the newest samples of a longer block', () => {
		const block = voicedBlock(defaultVoice);
		const longer = Float32Array.from([...voicedBlock({ ...defaultVoice, vowel: 'ih', seed: 3 }), ...block]);
		expect(vowelWeights(longer, sampleRate)).toEqual(vowelWeights(block, sampleRate));
	});
});

describe('vowelWeights by loudness', () => {
	const loudest = vowelWeights(voicedBlock(defaultVoice), sampleRate);

	it('weighs the mouth shapes by one level at full loudness, which sums to 1', () => {
		expect(vowels.reduce((sum, vowel) => sum + loudest[vowel], 0)).toBeCloseTo(1, 6);
	});

	it('scales every weight by the same share when the voice is quieter, keeping the vowel', () => {
		const quieter = vowelWeights(voicedBlock({ ...defaultVoice, rms: 0.03 }), sampleRate);
		const shares = vowels.filter((vowel) => loudest[vowel] > 1e-3).map((vowel) => quieter[vowel] / loudest[vowel]);
		expect(shares.length).toBeGreaterThan(0);
		for (const share of shares) {
			expect(share).toBeCloseTo(shares[0] ?? 0, 2);
			expect(share).toBeLessThan(1);
		}
		expect(strongest(quieter)).toBe('aa');
	});

	it('weighs less as the voice gets quieter', () => {
		const levels = [0.02, 0.04, 0.08].map((rms) => {
			const weights = vowelWeights(voicedBlock({ ...defaultVoice, rms }), sampleRate);
			return weights.aa;
		});
		expect(levels[0]).toBeLessThan(levels[1] ?? 0);
		expect(levels[1]).toBeLessThan(levels[2] ?? 0);
		expect(levels[2]).toBeLessThan(loudest.aa);
	});

	it('weighs a voice louder than full loudness as full loudness', () => {
		const louder = vowelWeights(voicedBlock({ ...defaultVoice, rms: 0.4 }), sampleRate);
		for (const vowel of vowels) expect(louder[vowel]).toBeCloseTo(loudest[vowel], 6);
	});
});

describe('vowelWeights of a block without a voice', () => {
	const noNoise = { ...defaultVoice, noiseShare: 0 };
	const silent = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };

	function noise(rms: number, length = blockLength): Float32Array {
		const random = seededRandom(11);
		return Float32Array.from({ length }, () => rms * noiseSample(random));
	}

	it('gives all zeros for zeros', () => {
		expect(vowelWeights(new Float32Array(blockLength), sampleRate)).toEqual(silent);
	});

	it.each([0.001, 0.005, 0.009])('keeps every weight below 0.05 for noise of rms %f', (rms) => {
		const weights = vowelWeights(noise(rms), sampleRate);
		for (const vowel of vowels) expect(weights[vowel]).toBeLessThan(0.05);
	});

	it('gives all zeros for a voice below the gate', () => {
		expect(vowelWeights(voicedBlock({ ...noNoise, rms: 0.009 }), sampleRate)).toEqual(silent);
	});

	it('keeps every weight finite for loud noise', () => {
		const weights = vowelWeights(noise(0.1), sampleRate);
		for (const vowel of vowels) expect(Number.isFinite(weights[vowel])).toBe(true);
	});

	it('gives all zeros for a block shorter than it reads', () => {
		expect(vowelWeights(voicedBlock(defaultVoice).slice(0, 100), sampleRate)).toEqual(silent);
		expect(vowelWeights(new Float32Array(), sampleRate)).toEqual(silent);
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('gives all zeros for a block holding %f', (bad) => {
		const block = voicedBlock(defaultVoice);
		block[block.length - 1] = bad;
		expect(vowelWeights(block, sampleRate)).toEqual(silent);
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -48_000, 4000])('gives all zeros for a sample rate of %f', (rate) => {
		expect(vowelWeights(voicedBlock(defaultVoice), rate)).toEqual(silent);
	});

	it('gives all zeros for a tone the analysis does not hear', () => {
		const nyquistTone = Float32Array.from({ length: blockLength }, (_, index) => (index % 2 === 0 ? 0.2 : -0.2));
		expect(vowelWeights(nyquistTone, sampleRate)).toEqual(silent);
	});
});
