import { WebGLRenderer } from 'three';
import { VRMUtils, type VRM } from '@pixiv/three-vrm';
import { checkClip, checkFigure } from './check.js';
import { loadClip } from './clipLoader.js';
import { createFigureStage, type FigureStage } from './figureFrame.js';
import { loadFigure } from './figureLoader.js';
import type { FigureMood } from './expressions.js';
import { createFigureMotion, type FigureFacts, type SpeakerOffset } from './figureMotion.js';
import { isSlow, recordFrameInterval } from './frameTimeGuard.js';
import type { LoadedClip } from './gestureLayer.js';
import { isFigureGesture, type FigureGesture } from './gestures.js';
import { figureSignal, type FigureSignal } from './signals.js';
import { createVoiceTap } from './voiceTap.js';

export { figureSignal, type FigureSignal } from './signals.js';
export type { FigureMood } from './expressions.js';
export type { FigureGesture } from './gestures.js';

export interface MountOptions {
	/** Called with every signal the figure gives, the first one before `mount` resolves. */
	readonly onSignal?: (signal: FigureSignal) => void;
	/**
	 * A persona's own clips: the bytes of a `.vrma` file (`VRMC_vrm_animation` 1.0) for the base gesture a clip replaces. After the figure is drawn, each clip is judged by `checkClip`, the same check as `figure check --as clip`, and only then parsed, with no wait: `mount` resolves and the signal comes first, and a gesture that starts before a clip has parsed plays figure's own clip to its end. A clip plays the arms, hands, fingers, shoulders, spine, chest and upper chest it keys, trailing down each limb by a small lag the author does not write, on figure's fades; every other track is dropped. A key that is no `FigureGesture`, a clip that is refused or fails to load, and a clip that finishes parsing after `dispose` are dropped with no signal and nothing thrown. The option is read once, at mount.
	 */
	readonly gestures?: Readonly<Partial<Record<FigureGesture, Uint8Array>>>;
}

export interface FigureHandle {
	/** The last signal the figure gave: `drawn` while it lives, then the signal that ended it, `lost` and `slow` included; never empty. */
	readonly signal: FigureSignal;
	/** Frees the scene, the renderer and the canvas's context; a second call does nothing. */
	dispose(): void;
	/** Whether the agent's model is working. The host reports the fact and the figure decides its motion; the same value again changes nothing, and a figure that ended or was disposed ignores it. */
	think(working: boolean): void;
	/** Someone speaks at `speaker`, an element of the page; null: nobody does. The figure turns toward the element's centre and follows it as it moves, while it does not think. Each call replaces the last value and the same element again changes nothing. Anything that is not an element counts as nobody, and so does an element that is not connected, that belongs to another document or that has no box (a bounding rectangle with neither width nor height, as under `display: none`), until it returns. The figure reads the element's bounding rectangle each frame and holds it no longer than until `listen(null)`, another element, `dispose` or the figure's end; a figure that ended or was disposed ignores the call. */
	listen(speaker: Element | null): void;
	/**
	 * The agent speaks a sentence: the mouth follows `voice`, an audio node of the host's graph, and the face shows `mood`; null: it stopped. An object means the agent speaks, with a still mouth when it has no `voice` and a neutral face when it has no `mood`; a field the figure does not know is ignored. Each call replaces the sentence: another mood replaces the last one and a sentence without a mood lets it fade, as does `speak(null)`. A mood shows only while the agent speaks, with the mouth a little smaller, and a value that is no `FigureMood` shows no mood and throws nothing. While the agent speaks the figure neither thinks nor listens: the gaze is the idle glance, and when it stops the state the other facts name shows, thinking before listening. The figure taps a voice with one analyser of the voice's own context, which it connects to the voice and nothing else, and disconnects, and only it, when another voice, `speak({})`, `speak(null)`, `dispose` or the figure's end releases it; the same node again keeps its tap. It plays nothing and creates no context. A voice it cannot tap (a value that is no audio node, a closed context, a `connect` or `createAnalyser` that throws) speaks with a still mouth and nothing is thrown, and a suspended context reads silence until it runs. A figure that ended or was disposed ignores the call and taps nothing.
	 */
	speak(sentence: { readonly voice?: AudioNode; readonly mood?: FigureMood } | null): void;
	/**
	 * The agent waves, or does whatever else `name` names: the figure plays its motion from the next drawn frame, its own on the right arm or the persona's clip that `MountOptions.gestures` gave for that name once it has parsed, with no bytes from this call, and the other motions, the moods and the voice go on under it. It returns nothing, gives no signal and reports no completion, and it never throws. One gesture shows at a time and calls never queue: a call for the gesture that plays is dropped. A value that is no `FigureGesture` is dropped, and so is a call made while the page is hidden: a gesture is a moment, not a state, and none starts when the page shows again. A figure that ended or was disposed ignores the call, and so does a page that asks for reduced motion, which also ends a gesture that runs, at once. While the figure thinks, the wave lifts the hand from the chin and gives it back.
	 */
	gesture(name: FigureGesture): void;
}

/** What the agent speaks: the voice its mouth follows and the mood its face shows. */
type Sentence = { readonly voice?: AudioNode; readonly mood?: FigureMood } | null;

/** What the mount's work gave: the signal, what to free when the app is done with it, and how the facts the host reports reach the figure. */
interface Outcome {
	readonly signal: FigureSignal;
	readonly release: () => void;
	readonly think: (working: boolean) => void;
	readonly listen: (speaker: Element | null) => void;
	readonly speak: (sentence: Sentence) => void;
	readonly gesture: (name: unknown) => void;
	readonly replaceClip: (name: FigureGesture, clip: LoadedClip) => void;
}

/** The facts of a figure that is not drawn: nothing reads them. */
const ignoreFacts = () => {};

const endedFacts = { think: ignoreFacts, listen: ignoreFacts, speak: ignoreFacts, gesture: ignoreFacts, replaceClip: ignoreFacts };

function ended(signal: FigureSignal): Outcome {
	return { signal, release: () => {}, ...endedFacts };
}

/** A loop's stop, and the way to give it the facts it draws from. */
interface Loop {
	readonly stop: () => void;
	readonly think: (working: boolean) => void;
	readonly listen: (speaker: Element | null) => void;
	readonly speak: (sentence: Sentence) => void;
	readonly gesture: (name: unknown) => void;
}

/** The browser's own rectangle read: it throws for anything that is not an element, whatever properties that value supplies, of any realm. */
const elementRectangle = Element.prototype.getBoundingClientRect;

/**
 * Where the speaker's centre lies from the canvas's centre, in shares of half the viewport's width and height, or null when nobody counts
 * as speaking: no element, one that is not connected, one of another document than the canvas's, one without a box (neither width nor
 * height), or one whose rectangle gives no finite share. The viewport is the canvas's document's, at least a pixel wide and high. Whatever `listen` was given is judged here, each frame,
 * by what it answers, not by the realm it was made in; a value whose reads throw counts as nobody, so a frame never fails for it.
 */
function speakerOffset(canvas: HTMLCanvasElement, speaker: Element | null): SpeakerOffset | null {
	try {
		if (speaker === null) return null;
		const to = elementRectangle.call(speaker);
		if (!speaker.isConnected || speaker.ownerDocument !== canvas.ownerDocument || (to.width <= 0 && to.height <= 0)) return null;
		const viewport = canvas.ownerDocument.documentElement;
		const from = canvas.getBoundingClientRect();
		const across = (to.left + to.width / 2 - (from.left + from.width / 2)) / (Math.max(1, viewport.clientWidth) / 2);
		const down = (to.top + to.height / 2 - (from.top + from.height / 2)) / (Math.max(1, viewport.clientHeight) / 2);
		return Number.isFinite(across) && Number.isFinite(down) ? { across, down } : null;
	} catch {
		return null;
	}
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

/** The signals that end a drawn figure from inside its loop. */
type LoopEnding = typeof figureSignal.lost | typeof figureSignal.slow;

/**
 * Draws the stage now, then each animation frame while the page is visible and the canvas is in the viewport: the loop is the one
 * place that draws. A context lost while it runs, or a frame-time guard that finds the figure slow, ends it: the loop and its
 * listeners go, then `onEnd` is called once with the reason. Its `stop` ends it for good; a second call does nothing. Each frame draws
 * the pose the motion gives for the facts the host reported by then.
 */
function runLoop(stage: FigureStage, canvas: HTMLCanvasElement, onEnd: (ending: LoopEnding) => void): Loop {
	const motion = createFigureMotion(Math.random, stage.gestures.clipOf);
	const voiceTap = createVoiceTap();
	let facts: FigureFacts = { thinking: false, speaking: false };
	let speaker: Element | null = null;
	const reducedMotion = matchMedia(reducedMotionQuery);
	let previousTime = performance.now();
	/** The last frame intervals the guard judges, in milliseconds; a pause starts them anew. */
	let recentIntervals: readonly number[] = [];
	const drawAt = (time: number) => {
		const elapsedSeconds = (time - previousTime) / 1000;
		previousTime = time;
		stage.draw(motion.advance(facts, elapsedSeconds, reducedMotion.matches, speakerOffset(canvas, speaker), voiceTap.weights()), elapsedSeconds);
	};
	let pendingFrame: number | undefined;
	let stopped = false;
	let inViewport = false;
	const onFrame = (time: number) => {
		const intervalMilliseconds = time - previousTime;
		drawAt(time);
		recentIntervals = recordFrameInterval(recentIntervals, intervalMilliseconds);
		if (isSlow(recentIntervals)) end(figureSignal.slow);
		else pendingFrame = requestAnimationFrame(onFrame);
	};
	/** Runs the loop while it may, stops a frame it has requested while it may not; a resumed loop draws at once, with no time counted for the pause. */
	const syncWithPage = () => {
		const mayRun = !stopped && inViewport && document.visibilityState === 'visible';
		if (mayRun && pendingFrame === undefined) {
			previousTime = performance.now();
			recentIntervals = [];
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
	const end = (ending: LoopEnding) => {
		stop();
		onEnd(ending);
	};
	const onContextLost = () => end(figureSignal.lost);
	const stop = () => {
		stopped = true;
		speaker = null;
		voiceTap.follow(undefined);
		syncWithPage();
		document.removeEventListener('visibilitychange', syncWithPage);
		viewport.disconnect();
		canvas.removeEventListener('webglcontextlost', onContextLost);
	};
	drawAt(previousTime);
	document.addEventListener('visibilitychange', syncWithPage);
	canvas.addEventListener('webglcontextlost', onContextLost);
	viewport.observe(canvas);
	const think = (working: boolean) => {
		facts = { ...facts, thinking: working === true };
	};
	const listen = (element: Element | null) => {
		if (!stopped) speaker = element;
	};
	const speak = (sentence: Sentence) => {
		if (stopped) return;
		const speaking = typeof sentence === 'object' && sentence !== null;
		facts = { ...facts, speaking, mood: speaking ? sentence.mood : undefined };
		voiceTap.follow(speaking ? sentence.voice : undefined);
	};
	const gesture = (name: unknown) => {
		if (!stopped && document.visibilityState === 'visible' && !reducedMotion.matches && isFigureGesture(name)) motion.gesture(name);
	};
	return { stop, think, listen, speak, gesture };
}

async function start(canvas: HTMLCanvasElement, bytes: Uint8Array, give: (signal: FigureSignal) => void): Promise<Outcome> {
	if (checkFigure(bytes).length > 0) return ended(figureSignal.refused);
	const opened = openRenderer(canvas);
	if (typeof opened === 'string') return ended(opened);
	const renderer = opened;
	let vrm: VRM | undefined;
	let loop: Loop | undefined;
	const release = () => {
		loop?.stop();
		if (vrm !== undefined) VRMUtils.deepDispose(vrm.scene);
		renderer.dispose();
		renderer.forceContextLoss();
	};
	try {
		vrm = await loadFigure(bytes);
		const figure = vrm;
		// A loss during the load fired its event before the loop listens for it, so the state is read here.
		if (renderer.getContext().isContextLost()) return { signal: figureSignal.lost, release, ...endedFacts };
		const stage = createFigureStage(renderer, canvas, figure);
		loop = runLoop(stage, canvas, give);
		return { signal: figureSignal.drawn, release, think: loop.think, listen: loop.listen, speak: loop.speak, gesture: loop.gesture, replaceClip: stage.gestures.replace };
	} catch {
		release();
		return ended(figureSignal.refused);
	}
}

/**
 * Judges each clip of `gestures` under a key that names a gesture with `checkClip`, parses what passes, and hands the parsed clip to
 * `replaceClip` unless `isDisposed` by then. Whatever goes wrong with a clip, or with the option itself, drops it: nothing is signalled
 * and nothing rejects.
 */
async function adoptClips(gestures: MountOptions['gestures'], replaceClip: Outcome['replaceClip'], isDisposed: () => boolean): Promise<void> {
	try {
		await Promise.all(
			Object.entries(gestures ?? {}).map(async ([name, bytes]) => {
				try {
					if (!isFigureGesture(name) || checkClip(bytes).length > 0) return;
					const clip = await loadClip(bytes);
					if (!isDisposed()) replaceClip(name, clip);
				} catch {
					// A clip that cannot be judged or loaded leaves figure's own clip playing.
				}
			})
		);
	} catch {
		// An option that cannot be read as a map of clips drops them all.
	}
}

/**
 * Draws the VRM in `bytes` into `canvas`, whose CSS size the host owns, and keeps it alive: the figure breathes, sways, blinks and
 * glances, or only blinks while the page asks for reduced motion, shows that its agent thinks while the host reports it through
 * `think`, turns toward whoever speaks and nods now and then while the host names the speaker's element through `listen`, moves its mouth and nods with the agent's voice and shows its mood while the host passes them through `speak`, and is drawn each animation frame at the canvas's size and the device pixel ratio, until `dispose`. While the page is hidden or the canvas is out of the viewport it is not drawn, and it goes on
 * without a jump when both are back. A context lost while the figure loads or lives gives `lost`, and a figure its frame-time guard finds too
 * slow to keep gives `slow`; either ends it for good, with no restore: a remount needs a fresh canvas.
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
	const { signal, release, think, listen, speak, gesture, replaceClip } = await start(canvas, bytes, give).catch(() => ended(figureSignal.refused));
	give(signal);
	let disposed = false;
	if (signal === figureSignal.drawn) void adoptClips(options?.gestures, replaceClip, () => disposed);
	return {
		get signal() {
			return current;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			release();
		},
		think,
		listen,
		speak,
		gesture
	};
}
