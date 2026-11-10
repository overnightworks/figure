import { WebGLRenderer } from 'three';
import { VRMUtils, type VRM } from '@pixiv/three-vrm';
import { checkFigure } from './check.js';
import { drawFigureFrame } from './figureFrame.js';
import { loadFigure } from './figureLoader.js';
import { figureSignal, type FigureSignal } from './signals.js';

export { figureSignal, type FigureSignal } from './signals.js';

export interface MountOptions {
	/** Called with every signal the figure gives, the first one before `mount` resolves. */
	readonly onSignal: (signal: FigureSignal) => void;
}

export interface FigureHandle {
	/** The last signal the figure gave; never empty. */
	readonly signal: FigureSignal;
	/** Frees the scene, the renderer and the canvas's context; a second call does nothing. */
	dispose(): void;
}

/** What the mount's work gave: the signal and what to free when the app is done with it. */
interface Outcome {
	readonly signal: FigureSignal;
	readonly release: () => void;
}

function ended(signal: FigureSignal): Outcome {
	return { signal, release: () => {} };
}

async function start(canvas: HTMLCanvasElement, bytes: Uint8Array): Promise<Outcome> {
	if (checkFigure(bytes).length > 0) return ended(figureSignal.refused);
	const context = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'low-power' });
	if (context === null) return ended(figureSignal.unsupported);
	if (context.isContextLost()) return ended(figureSignal.lost);
	const renderer = new WebGLRenderer({ canvas, context, alpha: true });
	let vrm: VRM | undefined;
	const release = () => {
		if (vrm !== undefined) VRMUtils.deepDispose(vrm.scene);
		renderer.dispose();
		renderer.forceContextLoss();
	};
	try {
		vrm = await loadFigure(bytes);
		drawFigureFrame(renderer, canvas, vrm);
		return { signal: figureSignal.drawn, release };
	} catch {
		release();
		return ended(figureSignal.refused);
	}
}

/**
 * Draws one frame of the VRM in `bytes` into `canvas`, whose CSS size the host owns, and resolves to a handle holding the
 * first signal, which `onSignal` has had by then. It never rejects: an error `onSignal` throws is reported to the window's error handlers.
 */
export async function mount(canvas: HTMLCanvasElement, bytes: Uint8Array, { onSignal }: MountOptions): Promise<FigureHandle> {
	const { signal, release } = await start(canvas, bytes);
	let disposed = false;
	try {
		onSignal(signal);
	} catch (error) {
		reportError(error);
	}
	return {
		signal,
		dispose() {
			if (disposed) return;
			disposed = true;
			release();
		}
	};
}
