import { analysisWindowLength, vowelWeights, type VowelWeights } from './vowelWeights.js';

/**
 * The tap on a host's voice. It makes one analyser with the voice's own context, connects the voice to it and nothing else, and reads
 * the analyser's time-domain samples into one buffer it keeps. It creates no context, connects nothing to a destination and plays
 * nothing; it only ever disconnects its own analyser. A voice it cannot tap gives no mouth and no error.
 */
export interface VoiceTap {
	/** Follows `voice` until the next call: the same node again keeps its tap, another one or none releases the last one first. */
	follow(voice: AudioNode | undefined): void;
	/** The mouth weights of the voice's latest samples, or null when no voice is tapped, its context does not run or the analyser cannot be read. */
	weights(): VowelWeights | null;
}

/** What a tapped voice holds: the node, its analyser, the buffer the analyser fills and the rate it was made for. */
interface Tapped {
	readonly voice: AudioNode;
	readonly analyser: AnalyserNode;
	readonly samples: Float32Array<ArrayBuffer>;
	readonly sampleRate: number;
}

/** The analyser's block for a sample rate: the smallest power of two that covers the window the analysis reads. */
function blockLength(sampleRate: number): number {
	return 2 ** Math.ceil(Math.log2(analysisWindowLength(sampleRate)));
}

/**
 * Taps `voice`, or returns undefined for anything that cannot be tapped: a value that is no audio node, a context that is closed,
 * a `createAnalyser` or `connect` that throws. Whatever the host passes is judged by what it answers.
 */
function tapOf(voice: AudioNode): Tapped | undefined {
	try {
		const context = voice.context;
		if (context.state === 'closed') return undefined;
		const analyser = context.createAnalyser();
		analyser.fftSize = blockLength(context.sampleRate);
		voice.connect(analyser);
		return { voice, analyser, samples: new Float32Array(analyser.fftSize), sampleRate: context.sampleRate };
	} catch {
		return undefined;
	}
}

export function createVoiceTap(): VoiceTap {
	let tapped: Tapped | undefined;
	const release = () => {
		if (tapped === undefined) return;
		const { voice, analyser } = tapped;
		tapped = undefined;
		try {
			voice.disconnect(analyser);
		} catch {
			// A voice the host disconnected from everything refuses to disconnect the analyser again.
		}
	};
	return {
		follow(voice) {
			if (voice !== undefined && voice === tapped?.voice) return;
			release();
			if (voice !== undefined) tapped = tapOf(voice);
		},
		weights() {
			if (tapped === undefined) return null;
			try {
				// A context that does not run leaves its analyser the last samples it captured, which are no voice.
				if (tapped.analyser.context.state !== 'running') return null;
				tapped.analyser.getFloatTimeDomainData(tapped.samples);
				return vowelWeights(tapped.samples, tapped.sampleRate);
			} catch {
				release();
				return null;
			}
		}
	};
}
