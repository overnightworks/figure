// A voice made of real Web Audio nodes: a glottal-like pulse source through two formant resonators, for the browser tests and the stage.
import { mouthShape, type MouthShape } from '../src/expressions.js';
import type { SpokenSound, SpokenSounds } from '../src/mountOptions.js';

/**
 * The first two formants in Hz of the vowel each mouth shape opens for (Peterson and Barney, 1952, table V, the men's averages):
 * aa is /ɑ/ (hot), ih is /i/ (heed), ou is /u/ (who'd), ee is /ɛ/ (head) and oh is /ɔ/ (hawed).
 */
const synthesizedFormants: Record<MouthShape, readonly [number, number]> = {
	[mouthShape.aa]: [730, 1090],
	[mouthShape.ih]: [270, 2290],
	[mouthShape.ou]: [300, 870],
	[mouthShape.ee]: [530, 1840],
	[mouthShape.oh]: [570, 840]
};

const pitchHz = 130;
/** The bandwidths in Hz of the first two formants (Klatt, 1980, "Software for a cascade/parallel formant synthesizer"). */
const formantBandwidthsHz = [60, 90] as const;
/** The gain that brings the voice well above the loudness at which the mouth is fully open. */
const speechGain = 0.2;

/** A voice that sounds until `stop`: its `output` is the node a host passes to `speak`. */
export interface SyntheticVoice {
	readonly output: GainNode;
	stop(): void;
}

/** A resonator at `frequencyHz` of the given bandwidth: a low-pass whose resonance (its Q, in dB) is the ratio of the two. */
function formantResonator(context: AudioContext, frequencyHz: number, bandwidthHz: number): BiquadFilterNode {
	const resonator = context.createBiquadFilter();
	resonator.type = 'lowpass';
	resonator.frequency.value = frequencyHz;
	resonator.Q.value = 20 * Math.log10(frequencyHz / bandwidthHz);
	return resonator;
}

/** A sustained `vowel` at a pitch of 130 Hz: a sawtooth through the two formants in series; a `gain` of 0 makes the silent voice of a person who is not talking. */
export function syntheticVoice(context: AudioContext, vowel: MouthShape, gain = speechGain): SyntheticVoice {
	const source = context.createOscillator();
	source.type = 'sawtooth';
	source.frequency.value = pitchHz;
	const output = context.createGain();
	output.gain.value = gain;
	synthesizedFormants[vowel]
		.map((formantHz, index) => formantResonator(context, formantHz, formantBandwidthsHz[index]!))
		.reduce<AudioNode>((previous, resonator) => previous.connect(resonator), source)
		.connect(output);
	source.start();
	return { output, stop: () => source.stop() };
}

/** A voice that plays one vowel while its sounds are timed on a clock of their own: the clock of an answer a host's player has played, which a test can move and hold. */
export interface SyntheticSequence extends SyntheticVoice {
	/** What a host passes to `speak` beside `output`: the sounds, and the position the sequence has played. */
	readonly sounds: SpokenSounds;
	/** Moves the played position to `seconds` of the answer, from where it runs on with the context's clock. */
	seek(seconds: number): void;
	/** Stands the played position still while the context's clock runs on, as a player does while it waits for a late chunk. */
	hold(): void;
	/** Lets the position run on from where `hold` left it. */
	release(): void;
}

/**
 * A `syntheticVoice` of `vowel` whose position starts at 0 with the context's clock and runs with it, as speech's player derives its
 * played position from the context's `currentTime`; the voice's own vowel and the sounds are independent, so a test sees which one the mouth follows.
 */
export function syntheticSequence(context: AudioContext, vowel: MouthShape, sounds: readonly SpokenSound[], gain?: number): SyntheticSequence {
	const voice = syntheticVoice(context, vowel, gain);
	let base = 0;
	let anchor = context.currentTime;
	let held: number | undefined;
	const position = () => held ?? base + context.currentTime - anchor;
	return {
		...voice,
		sounds: { played: position, sounds },
		seek(seconds) {
			base = seconds;
			anchor = context.currentTime;
		},
		hold() {
			held ??= position();
		},
		release() {
			if (held === undefined) return;
			base = held;
			anchor = context.currentTime;
			held = undefined;
		}
	};
}
