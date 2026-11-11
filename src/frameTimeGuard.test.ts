import { describe, expect, it } from 'vitest';
import { frameWindowLength, isSlow, recordFrameInterval } from './frameTimeGuard.js';

/** The intervals of `count` frames, each `milliseconds` long. */
function framesOf(milliseconds: number, count: number): number[] {
	return Array.from({ length: count }, () => milliseconds);
}

/** The window the guard holds after each of `intervals` is recorded in turn. */
function recordAll(intervals: readonly number[]): readonly number[] {
	return intervals.reduce<readonly number[]>((window, interval) => recordFrameInterval(window, interval), []);
}

describe('the frame-time guard', () => {
	it.each([
		['forty intervals of 33 ms', framesOf(33, 40), false],
		['forty intervals of 60 ms', framesOf(60, 40), true],
		['forty intervals whose median is 55 ms, not above it', framesOf(55, 40), false],
		['thirty-nine intervals of 200 ms, one short of a window', framesOf(200, 39), false],
		['twenty-one intervals of 60 ms, listed first, among nineteen of 16 ms', [...framesOf(60, 21), ...framesOf(16, 19)], true],
		['twenty intervals of 60 ms among twenty of 16 ms: the median is the upper middle value, 60 ms', [...framesOf(16, 20), ...framesOf(60, 20)], true],
	])('judges %s', (_description, intervals, slow) => {
		expect(isSlow(intervals)).toBe(slow);
	});

	it('gives no slow once the slow intervals have left the window', () => {
		expect(isSlow(recordAll([...framesOf(60, 40), ...framesOf(33, 40)]))).toBe(false);
	});

	it('keeps the newest forty intervals and drops the oldest', () => {
		const window = recordAll([...framesOf(33, 41), 60]);

		expect(window).toHaveLength(frameWindowLength);
		expect(window.at(-1)).toBe(60);
	});
});
