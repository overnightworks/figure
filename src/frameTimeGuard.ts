/**
 * The frame-time guard: whether a drawn figure is too slow to keep. The figure is slow when the median of its last 40 frame intervals is
 * above 55 ms, the values and the median of the agent tile's mockup in hopin. Pure: it reads numbers and names no clock, canvas or renderer.
 */
export const frameWindowLength = 40;
export const slowMedianMilliseconds = 55;

/** The window with `interval` added as its newest entry; once the window is full the oldest entry is dropped. */
export function recordFrameInterval(window: readonly number[], interval: number): readonly number[] {
	return [...window.slice(-(frameWindowLength - 1)), interval];
}

/**
 * Whether the window holds a full set of intervals whose median is above the slow median. For an even count the median is the upper
 * of the two middle values, which is how the mockup takes it (its sorted entry at half the count).
 */
export function isSlow(window: readonly number[]): boolean {
	if (window.length < frameWindowLength) return false;
	const sorted = [...window].sort((first, second) => first - second);
	return sorted[Math.floor(sorted.length / 2)] > slowMedianMilliseconds;
}
