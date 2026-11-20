/**
 * How a host asks to see its figure, from the face to the whole body; each key is one framing and nowhere else is one written.
 * `shoulders` is the picture a figure draws when the host names none.
 */
export const figureFraming = {
	face: 'face',
	shoulders: 'shoulders',
	upperBody: 'upperBody',
	fullBody: 'fullBody'
} as const;

export type FigureFraming = (typeof figureFraming)[keyof typeof figureFraming];

/** The framing a figure starts in when the host names none or names one that is not a framing. */
export const defaultFraming: FigureFraming = figureFraming.shoulders;

/** Whether `value` names a framing: a string that is an own key of `figureFraming`, so `'constructor'` and every other inherited name is no framing. */
export function isFigureFraming(value: unknown): value is FigureFraming {
	return typeof value === 'string' && Object.hasOwn(figureFraming, value);
}
