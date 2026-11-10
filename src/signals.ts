/**
 * Everything a mounted figure tells its app; each key is one signal and nowhere else is one written.
 * `drawn` is the first frame on the canvas. `unsupported`, `refused`, `lost` and `slow` end the figure.
 * `lost` and `slow` have no producer yet.
 */
export const figureSignal = {
	drawn: 'drawn',
	unsupported: 'unsupported',
	refused: 'refused',
	lost: 'lost',
	slow: 'slow'
} as const;

export type FigureSignal = (typeof figureSignal)[keyof typeof figureSignal];
