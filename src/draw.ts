import { WebGLRenderer } from 'three';
import { VRMUtils, type VRM } from '@pixiv/three-vrm';
import { checkFigure } from './check.js';
import { createFigureStage, type FigureStage } from './figureFrame.js';
import { loadFigure } from './figureLoader.js';
import { createIdleMotion } from './idleMotion.js';
import { figureSignal, type FigureSignal } from './signals.js';

export { figureSignal, type FigureSignal } from './signals.js';

export interface MountOptions {
	/** Called with every signal the figure gives, the first one before `mount` resolves. */
	readonly onSignal?: (signal: FigureSignal) => void;
}

export interface FigureHandle {
	/** The last signal the figure gave: `drawn` while it lives, then the signal that ended it, `lost` included; never empty. */
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

/** The renderer on the canvas's WebGL 2 context, or the signal for why there is none; a canvas that cannot give a context throws. */
function openRenderer(canvas: HTMLCanvasElement): WebGLRenderer | FigureSignal {
	try {
		const context = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'low-power' });
		if (context === null) return figureSignal.unsupported;
		if (context.isContextLost()) return figureSignal.lost;
		return new WebGLRenderer({ canvas, context, alpha: true });
	} catch {
		return figureSignal.unsupported;
	}
}

/** The page's own preference; a query's `matches` is live, so reading it each frame follows a change while the figure lives. */
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

/**
 * Draws the stage now, then each animation frame while the page is visible and the canvas is in the viewport: the loop is the one
 * place that draws. A context lost while it runs ends it: the loop and its listeners go, then `onLost` is called once. The returned
 * function ends it for good; a second call does nothing.
 */
function runLoop(stage: FigureStage, canvas: HTMLCanvasElement, onLost: () => void): () => void {
	const motion = createIdleMotion(Math.random);
	const reducedMotion = matchMedia(reducedMotionQuery);
	let previousTime = performance.now();
	const drawAt = (time: number) => {
		const elapsedSeconds = (time - previousTime) / 1000;
		previousTime = time;
		stage.draw(motion.advance(elapsedSeconds, reducedMotion.matches), elapsedSeconds);
	};
	let pendingFrame: number | undefined;
	let stopped = false;
	let inViewport = false;
	const onFrame = (time: number) => {
		drawAt(time);
		pendingFrame = requestAnimationFrame(onFrame);
	};
	/** Runs the loop while it may, stops a frame it has requested while it may not; a resumed loop draws at once, with no time counted for the pause. */
	const syncWithPage = () => {
		const mayRun = !stopped && inViewport && document.visibilityState === 'visible';
		if (mayRun && pendingFrame === undefined) {
			previousTime = performance.now();
			drawAt(previousTime);
			pendingFrame = requestAnimationFrame(onFrame);
		} else if (!mayRun && pendingFrame !== undefined) {
			cancelAnimationFrame(pendingFrame);
			pendingFrame = undefined;
		}
	};
	const viewport = new IntersectionObserver((entries) => {
		inViewport = entries.at(-1)?.isIntersecting === true;
		syncWithPage();
	});
	const onContextLost = () => {
		stop();
		onLost();
	};
	const stop = () => {
		stopped = true;
		syncWithPage();
		document.removeEventListener('visibilitychange', syncWithPage);
		viewport.disconnect();
		canvas.removeEventListener('webglcontextlost', onContextLost);
	};
	drawAt(previousTime);
	document.addEventListener('visibilitychange', syncWithPage);
	canvas.addEventListener('webglcontextlost', onContextLost);
	viewport.observe(canvas);
	return stop;
}

async function start(canvas: HTMLCanvasElement, bytes: Uint8Array, give: (signal: FigureSignal) => void): Promise<Outcome> {
	if (checkFigure(bytes).length > 0) return ended(figureSignal.refused);
	const opened = openRenderer(canvas);
	if (typeof opened === 'string') return ended(opened);
	const renderer = opened;
	let vrm: VRM | undefined;
	let stopLoop = () => {};
	const release = () => {
		stopLoop();
		if (vrm !== undefined) VRMUtils.deepDispose(vrm.scene);
		renderer.dispose();
		renderer.forceContextLoss();
	};
	try {
		vrm = await loadFigure(bytes);
		const figure = vrm;
		stopLoop = runLoop(createFigureStage(renderer, canvas, figure), canvas, () => give(figureSignal.lost));
		return { signal: figureSignal.drawn, release };
	} catch {
		release();
		return ended(figureSignal.refused);
	}
}

/**
 * Draws the VRM in `bytes` into `canvas`, whose CSS size the host owns, and keeps it alive: the figure breathes, sways, blinks and
 * glances, or only blinks while the page asks for reduced motion, and is drawn each animation frame at the canvas's size and the
 * device pixel ratio, until `dispose`. While the page is hidden or the canvas is out of the viewport it is not drawn, and it goes on
 * without a jump when both are back. A context lost while it lives gives `lost` and ends it for good, with no restore: a remount needs a fresh canvas.
 * It resolves to a handle holding the first signal, which `onSignal` has had by then. It never rejects: an error `onSignal` throws is reported to the window's error handlers.
 */
export async function mount(canvas: HTMLCanvasElement, bytes: Uint8Array, options?: MountOptions): Promise<FigureHandle> {
	let current: FigureSignal = figureSignal.refused;
	const give = (signal: FigureSignal) => {
		current = signal;
		try {
			options?.onSignal?.(signal);
		} catch (error) {
			reportError(error);
		}
	};
	const { signal, release } = await start(canvas, bytes, give).catch(() => ended(figureSignal.refused));
	give(signal);
	let disposed = false;
	return {
		get signal() {
			return current;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			release();
		}
	};
}
