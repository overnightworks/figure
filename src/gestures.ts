/**
 * Everything an agent can ask its figure to do on its own choice; each key is one gesture and nowhere else is one written.
 * `wave` is figure's neutral wave of the right arm.
 */
export const figureGesture = {
	wave: 'wave'
} as const;

export type FigureGesture = (typeof figureGesture)[keyof typeof figureGesture];

/** Whether `value` names a gesture: a string that is an own key of `figureGesture`, so `'constructor'` and every other inherited name is no gesture. */
export function isFigureGesture(value: unknown): value is FigureGesture {
	return typeof value === 'string' && Object.hasOwn(figureGesture, value);
}
