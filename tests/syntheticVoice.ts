// A voice made of real Web Audio nodes: a glottal-like pulse source through two formant resonators, for the browser tests and the stage.
import { mouthShape, type MouthShape } from '../src/expressions.js';

/**
 * The first two formants in Hz of the vowel each mouth shape opens for (Peterson and Barney, 1952, table V, the men's averages):
 * aa is /ɑ/ (hot), ih is /i/ (heed), ou is /u/ (who'd), ee is /ɛ/ (head) and oh is /ɔ/ (hawed).
 */
export const vowelFormants: Record<MouthShape, readonly [number, number]> = {
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
	vowelFormants[vowel]
		.map((formantHz, index) => formantResonator(context, formantHz, formantBandwidthsHz[index]!))
		.reduce<AudioNode>((previous, resonator) => previous.connect(resonator), source)
		.connect(output);
	source.start();
	return { output, stop: () => source.stop() };
}
