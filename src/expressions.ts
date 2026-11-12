/** The five mouth shapes a figure's face carries, one per vowel the voice can make; each key is one VRM expression preset and nowhere else is one written. */
export const mouthShape = {
	aa: 'aa',
	ih: 'ih',
	ou: 'ou',
	ee: 'ee',
	oh: 'oh'
} as const;

export type MouthShape = (typeof mouthShape)[keyof typeof mouthShape];

/** The five moods a figure's face carries, one VRM expression preset each. */
export const figureMood = {
	happy: 'happy',
	angry: 'angry',
	sad: 'sad',
	relaxed: 'relaxed',
	surprised: 'surprised'
} as const;

export type FigureMood = (typeof figureMood)[keyof typeof figureMood];
