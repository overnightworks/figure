import { loadClip } from './clipLoader.js';
import { mountWithClipLoad, type FigureHandle, type MountOptions } from './figureMount.js';

export { figureSignal, type FigureSignal } from './signals.js';
export type { FigureMood } from './expressions.js';
export type { FigureGesture } from './gestures.js';
export type { FigureHandle, MountOptions } from './figureMount.js';

/**
 * Draws the VRM in `bytes` into `canvas`, whose CSS size the host owns, and keeps it alive: the figure breathes, sways, blinks and
 * glances, or only blinks while the page asks for reduced motion, shows that its agent thinks while the host reports it through
 * `think`, turns toward whoever speaks and nods now and then while the host names the speaker's element through `listen`, moves its mouth and nods with the agent's voice and shows its mood while the host passes them through `speak`, and is drawn each animation frame at the canvas's size and the device pixel ratio, until `dispose`. While the page is hidden or the canvas is out of the viewport it is not drawn, and it goes on
 * without a jump when both are back. A context lost while the figure loads or lives gives `lost`, and a figure its frame-time guard finds too
 * slow to keep gives `slow`; either ends it for good, with no restore: a remount needs a fresh canvas.
 * It resolves to a handle holding the first signal, which `onSignal` has had by then. It never rejects: an error `onSignal` throws is reported to the window's error handlers.
 */
export function mount(canvas: HTMLCanvasElement, bytes: Uint8Array, options?: MountOptions): Promise<FigureHandle> {
	return mountWithClipLoad(loadClip, canvas, bytes, options);
}
