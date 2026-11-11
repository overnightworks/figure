/**
 * Everything a mounted figure tells its app; each key is one signal and nowhere else is one written.
 * `drawn` is the first frame on the canvas. `unsupported`, `refused`, `lost` and `slow` end the figure.
 * `lost` is given for a context already lost at the mount, or lost while the figure lives; `slow` has no producer yet.
 */
export const figureSignal = {
	drawn: 'drawn',
	unsupported: 'unsupported',
	refused: 'refused',
	lost: 'lost',
	slow: 'slow'
} as const;

export type FigureSignal = (typeof figureSignal)[keyof typeof figureSignal];
