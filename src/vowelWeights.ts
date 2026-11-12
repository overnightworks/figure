import { mouthShape, type MouthShape } from './expressions.js';

export type VowelWeights = Readonly<Record<MouthShape, number>>;

/** The first two formants in Hz that open the mouth to each shape. */
const vowelFormants: Record<MouthShape, readonly [number, number]> = {
	aa: [800, 1200],
	ih: [300, 2300],
	ou: [330, 800],
	ee: [500, 1850],
	oh: [500, 950]
};

const firstSpreadHz = 170;
const secondSpreadHz = 330;
const sharpeningPower = 1.6;
const gateRms = 0.01;
const fullLevelRms = 0.1;
const levelPower = 0.6;

const analysisRateHz = 8000;
const frameLength = 320;
const predictorOrder = 8;
// Milder than the usual 0.97: a stronger tilt compensation lets the harmonics at 220 and 440 Hz pull a woman's first formant near 370 Hz upward.
const preEmphasis = 0.8;
const whiteNoiseCorrection = 1 + 1e-6;
const lowestFormantHz = 200;
const highestFormantHz = 3500;
const widestBandwidthHz = 400;
const startRadius = 0.9;
const startAngle = 0.4;
const maximumRounds = 100;
const rootTolerance = 1e-9;

const shapes = Object.values(mouthShape);
const silence = Object.freeze(weightsOf(() => 0));

const frame = new Float64Array(frameLength);
const hammingWindow = Float64Array.from({ length: frameLength }, (_, index) => 0.54 - 0.46 * Math.cos((2 * Math.PI * index) / (frameLength - 1)));
const correlation = new Float64Array(predictorOrder + 1);
const predictor = new Float64Array(predictorOrder + 1);
const earlierPredictor = new Float64Array(predictorOrder + 1);
const rootReal = new Float64Array(predictorOrder);
const rootImaginary = new Float64Array(predictorOrder);
const scratch = new Float64Array(2);
const formants = new Float64Array(2);
const sharpened = new Float64Array(shapes.length);

function weightsOf(weightAt: (index: number) => number): VowelWeights {
	return Object.fromEntries(shapes.map((shape, index) => [shape, weightAt(index)])) as VowelWeights;
}

/** The share of full loudness the samples carry, 0 below the gate or when any sample is not finite. */
function loudness(samples: Float32Array, start: number): number {
	let sumOfSquares = 0;
	for (let index = start; index < samples.length; index++) sumOfSquares += samples[index] * samples[index];
	const rms = Math.sqrt(sumOfSquares / (samples.length - start));
	if (!Number.isFinite(rms) || rms < gateRms) return 0;
	return Math.min(rms / fullLevelRms, 1) ** levelPower;
}

/** Fills the frame with the samples decimated by averaging, pre-emphasized and windowed. */
function fillFrame(samples: Float32Array, start: number, decimation: number): void {
	let earlierMean = 0;
	for (let index = 0; index < frameLength; index++) {
		let sum = 0;
		for (let offset = 0; offset < decimation; offset++) sum += samples[start + index * decimation + offset];
		const mean = sum / decimation;
		frame[index] = (mean - preEmphasis * earlierMean) * hammingWindow[index];
		earlierMean = mean;
	}
}

function fillCorrelation(): void {
	for (let lag = 0; lag <= predictorOrder; lag++) {
		let sum = 0;
		for (let index = lag; index < frameLength; index++) sum += frame[index] * frame[index - lag];
		correlation[lag] = sum;
	}
	correlation[0] *= whiteNoiseCorrection;
}

/** The predictor polynomial 1 + a1 z^-1 + ... of the frame, by Levinson-Durbin recursion over its autocorrelation. */
function fillPredictor(): void {
	predictor.fill(0);
	predictor[0] = 1;
	let error = correlation[0];
	for (let order = 1; order <= predictorOrder; order++) {
		let projection = correlation[order];
		for (let index = 1; index < order; index++) projection += predictor[index] * correlation[order - index];
		const reflection = -projection / error;
		earlierPredictor.set(predictor);
		for (let index = 1; index < order; index++) predictor[index] = earlierPredictor[index] + reflection * earlierPredictor[order - index];
		predictor[order] = reflection;
		error *= 1 - reflection * reflection;
	}
}

/** Sets `scratch` to the predictor's characteristic polynomial z^n + a1 z^(n-1) + ... + an at a point, by Horner's rule. */
function polynomialAt(real: number, imaginary: number): void {
	let valueReal = 1;
	let valueImaginary = 0;
	for (let order = 1; order <= predictorOrder; order++) {
		const nextReal = valueReal * real - valueImaginary * imaginary + predictor[order];
		valueImaginary = valueReal * imaginary + valueImaginary * real;
		valueReal = nextReal;
	}
	scratch[0] = valueReal;
	scratch[1] = valueImaginary;
}

/** Sets `scratch` to the product of the differences between one root and the others. */
function differenceProductAt(rootIndex: number): void {
	let productReal = 1;
	let productImaginary = 0;
	for (let other = 0; other < predictorOrder; other++) {
		if (other === rootIndex) continue;
		const differenceReal = rootReal[rootIndex] - rootReal[other];
		const differenceImaginary = rootImaginary[rootIndex] - rootImaginary[other];
		const nextReal = productReal * differenceReal - productImaginary * differenceImaginary;
		productImaginary = productReal * differenceImaginary + productImaginary * differenceReal;
		productReal = nextReal;
	}
	scratch[0] = productReal;
	scratch[1] = productImaginary;
}

/** Moves one root by a step of Durand-Kerner's method and returns the length of the step. */
function stepRoot(rootIndex: number): number {
	polynomialAt(rootReal[rootIndex], rootImaginary[rootIndex]);
	const [valueReal, valueImaginary] = scratch;
	differenceProductAt(rootIndex);
	const [productReal, productImaginary] = scratch;
	const squaredProduct = productReal * productReal + productImaginary * productImaginary;
	const stepReal = (valueReal * productReal + valueImaginary * productImaginary) / squaredProduct;
	const stepImaginary = (valueImaginary * productReal - valueReal * productImaginary) / squaredProduct;
	rootReal[rootIndex] -= stepReal;
	rootImaginary[rootIndex] -= stepImaginary;
	return Math.hypot(stepReal, stepImaginary);
}

function fillRoots(): void {
	for (let index = 0; index < predictorOrder; index++) {
		const angle = (2 * Math.PI * index) / predictorOrder + startAngle;
		rootReal[index] = startRadius * Math.cos(angle);
		rootImaginary[index] = startRadius * Math.sin(angle);
	}
	for (let round = 0; round < maximumRounds; round++) {
		let longestStep = 0;
		for (let index = 0; index < predictorOrder; index++) longestStep = Math.max(longestStep, stepRoot(index));
		if (longestStep < rootTolerance) return;
	}
}

/** Sets `formants` to the two lowest resonances of the roots, in Hz, or leaves infinity where the roots hold fewer. */
function fillLowestFormants(rateHz: number): void {
	formants.fill(Infinity);
	for (let index = 0; index < predictorOrder; index++) {
		const frequencyHz = (Math.atan2(rootImaginary[index], rootReal[index]) * rateHz) / (2 * Math.PI);
		const bandwidthHz = (-Math.log(Math.hypot(rootReal[index], rootImaginary[index])) * rateHz) / Math.PI;
		if (frequencyHz < lowestFormantHz || frequencyHz > highestFormantHz || bandwidthHz > widestBandwidthHz) continue;
		if (frequencyHz < formants[0]) [formants[0], formants[1]] = [frequencyHz, formants[0]];
		else if (frequencyHz < formants[1]) formants[1] = frequencyHz;
	}
}

function weightsOfFormants(firstHz: number, secondHz: number, level: number): VowelWeights {
	let affinityTotal = 0;
	shapes.forEach((shape, index) => {
		const [vowelFirstHz, vowelSecondHz] = vowelFormants[shape];
		sharpened[index] = Math.exp(-(((firstHz - vowelFirstHz) / firstSpreadHz) ** 2 + ((secondHz - vowelSecondHz) / secondSpreadHz) ** 2));
		affinityTotal += sharpened[index];
	});
	let sharpenedTotal = 0;
	sharpened.forEach((affinity, index) => {
		sharpened[index] = (affinity / affinityTotal) ** sharpeningPower;
		sharpenedTotal += sharpened[index];
	});
	return weightsOf((index) => (sharpened[index] / sharpenedTotal) * level);
}

/**
 * From one block of time-domain samples at a sample rate, a weight from 0 to 1 for each of the five mouth shapes: the first two
 * formants of the newest samples (the roots of the linear predictor of a decimated, windowed, pre-emphasized frame, found by
 * autocorrelation and Levinson-Durbin), the distance of each to the formants of the five vowels, and the block's loudness
 * as the sum of the weights. A block of silence, below the loudness gate, shorter than the frame or holding a sample that is
 * not finite gives all zeros. Its limit is five vowel shapes only: consonants show as dips in loudness, closed lips are not
 * detected and the accuracy falls at a high pitch, where the harmonics are too far apart to trace the first formant.
 */
export function vowelWeights(samples: Float32Array, sampleRate: number): VowelWeights {
	const decimation = Math.floor(sampleRate / analysisRateHz);
	const start = samples.length - frameLength * decimation;
	if (!(decimation >= 1 && start >= 0)) return silence;
	const level = loudness(samples, start);
	if (level === 0) return silence;
	fillFrame(samples, start, decimation);
	fillCorrelation();
	if (!(correlation[0] > 0)) return silence;
	fillPredictor();
	fillRoots();
	fillLowestFormants(sampleRate / decimation);
	if (formants[1] === Infinity) return silence;
	return weightsOfFormants(formants[0], formants[1], level);
}
