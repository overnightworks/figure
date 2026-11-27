import { WebGLRenderer, type Object3D } from 'three';
import { VRMUtils, type VRM } from '@pixiv/three-vrm';
import { checkClip, checkFigure, checkRoom } from './check.js';
import { createFigureStage, type FigureStage } from './figureFrame.js';
import { loadFigure } from './figureLoader.js';
import type { FigureMood } from './expressions.js';
import { createFigureMotion, type FigureFacts, type FigureMotion, type SpeakerOffset } from './figureMotion.js';
import { isSlow, recordFrameInterval } from './frameTimeGuard.js';
import type { LoadedClip } from './gestureLayer.js';
import { defaultFraming, isFigureFraming, type FigureFraming } from './framings.js';
import { isFigureGesture, type FigureGesture } from './gestures.js';
import type { FigureHandle, MountOptions, SpokenSounds } from './mountOptions.js';
import { figureSignal, type FigureSignal } from './signals.js';
import { createSoundMouth, type SoundMouth } from './soundMouth.js';
import { createVoiceTap, type VoiceTap } from './voiceTap.js';

/** What the agent speaks: the voice its mouth follows, the sounds that time the voice's mouth and the mood its face shows. */
type Sentence = { readonly voice?: AudioNode; readonly mood?: FigureMood; readonly sounds?: SpokenSounds } | null;

/** The sounds of a sentence, or undefined where reading them throws: the host's own getter is judged like the value it gives. */
function soundsOf(sentence: NonNullable<Sentence>): unknown {
	try {
		return sentence.sounds;
	} catch {
		return undefined;
	}
}

/** Parses the bytes of a clip that passed `checkClip`. */
export type ClipLoad = (bytes: Uint8Array) => Promise<LoadedClip>;

/** Parses the bytes of a room that passed `checkRoom`. */
export type RoomLoad = (bytes: Uint8Array) => Promise<Object3D>;

/** The parses a mount hands bytes to. */
export interface Loads {
	readonly clip: ClipLoad;
	readonly room: RoomLoad;
}

/** What the mount's work gave: the signal, what to free when the app is done with it, and how the facts the host reports reach the figure. */
interface Outcome {
	readonly signal: FigureSignal;
	readonly release: () => void;
	readonly think: (working: boolean) => void;
	readonly listen: (speaker: Element | null) => void;
	readonly speak: (sentence: Sentence) => void;
	readonly gesture: (name: unknown) => void;
	readonly frame: (name: unknown) => void;
	readonly replaceClip: (name: FigureGesture, clip: LoadedClip) => void;
	readonly showRoom: (room: Object3D | null) => void;
}

/** The facts of a figure that is not drawn: nothing reads them. */
const ignoreFacts = () => {};

const endedFacts = { think: ignoreFacts, listen: ignoreFacts, speak: ignoreFacts, gesture: ignoreFacts, frame: ignoreFacts, replaceClip: ignoreFacts, showRoom: ignoreFacts };

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
	readonly frame: (name: unknown) => void;
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

/** What the loop's frames and the handle's verbs share: the facts the host reported, the speaker the camera follows and what turns them into a pose. */
type LoopState = {
	facts: FigureFacts;
	speaker: Element | null;
	stopped: boolean;
	readonly motion: FigureMotion;
	readonly voiceTap: VoiceTap;
	readonly soundMouth: SoundMouth;
	readonly reducedMotion: MediaQueryList;
};

/** The frames of one stage: each draws the pose the motion gives for the facts reported by then, and `next` returns the interval since the previous one. */
function createFrameDrawer(stage: FigureStage, canvas: HTMLCanvasElement, state: LoopState) {
	let previousTime = performance.now();
	/** Draws the frame at `time`; the camera glides to a new framing unless the page asks for reduced motion or `resuming` a pause, which shows the framing as it is now. */
	const drawAt = (time: number, resuming = false) => {
		const elapsedSeconds = (time - previousTime) / 1000;
		previousTime = time;
		const { motion, voiceTap, soundMouth, reducedMotion } = state;
		stage.draw(
			motion.advance(state.facts, elapsedSeconds, reducedMotion.matches, speakerOffset(canvas, state.speaker), soundMouth.goal(voiceTap.clock()) ?? voiceTap.weights()),
			elapsedSeconds,
			!resuming && !reducedMotion.matches
		);
	};
	return {
		first: () => drawAt(previousTime),
		/** Draws at once, with no time counted for the pause. */
		resume: () => {
			previousTime = performance.now();
			drawAt(previousTime, true);
		},
		next: (time: number) => {
			const intervalMilliseconds = time - previousTime;
			drawAt(time);
			return intervalMilliseconds;
		}
	};
}

/** The handle's verbs over the loop's state: each acts while the loop runs and is ignored once it has stopped. */
function createLoopVerbs(stage: FigureStage, state: LoopState): Omit<Loop, 'stop'> {
	const { motion, voiceTap, soundMouth, reducedMotion } = state;
	return {
		think: (working: boolean) => {
			state.facts = { ...state.facts, thinking: working === true };
		},
		listen: (element: Element | null) => {
			if (!state.stopped) state.speaker = element;
		},
		speak: (sentence: Sentence) => {
			if (state.stopped) return;
			const speaking = typeof sentence === 'object' && sentence !== null;
			state.facts = { ...state.facts, speaking, mood: speaking ? sentence.mood : undefined };
			voiceTap.follow(speaking ? sentence.voice : undefined);
			soundMouth.follow(speaking ? soundsOf(sentence) : undefined);
		},
		gesture: (name: unknown) => {
			if (!state.stopped && document.visibilityState === 'visible' && !reducedMotion.matches && isFigureGesture(name)) motion.gesture(name);
		},
		frame: (name: unknown) => {
			if (!state.stopped && isFigureFraming(name)) stage.frame(name);
		}
	};
}

/**
 * Draws the stage now, then each animation frame while the page is visible and the canvas is in the viewport: the loop is the one
 * place that draws. A context lost while it runs, or a frame-time guard that finds the figure slow, ends it: the loop and its
 * listeners go, then `onEnd` is called once with the reason. Its `stop` ends it for good; a second call does nothing. Each frame draws
 * the pose the motion gives for the facts the host reported by then.
 */
function runLoop(stage: FigureStage, canvas: HTMLCanvasElement, onEnd: (ending: LoopEnding) => void): Loop {
	const state: LoopState = {
		facts: { thinking: false, speaking: false },
		speaker: null,
		stopped: false,
		motion: createFigureMotion(Math.random, stage.gestures.clipOf),
		voiceTap: createVoiceTap(),
		soundMouth: createSoundMouth(),
		reducedMotion: matchMedia(reducedMotionQuery)
	};
	const frames = createFrameDrawer(stage, canvas, state);
	/** The last frame intervals the guard judges, in milliseconds; a pause starts them anew. */
	let recentIntervals: readonly number[] = [];
	let pendingFrame: number | undefined;
	let inViewport = false;
	const onFrame = (time: number) => {
		recentIntervals = recordFrameInterval(recentIntervals, frames.next(time));
		if (isSlow(recentIntervals)) end(figureSignal.slow);
		else pendingFrame = requestAnimationFrame(onFrame);
	};
	/** Runs the loop while it may, stops a frame it has requested while it may not; a resumed loop draws at once. */
	const syncWithPage = () => {
		const mayRun = !state.stopped && inViewport && document.visibilityState === 'visible';
		if (mayRun && pendingFrame === undefined) {
			recentIntervals = [];
			frames.resume();
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
		state.stopped = true;
		state.speaker = null;
		state.voiceTap.follow(undefined);
		state.soundMouth.follow(undefined);
		syncWithPage();
		document.removeEventListener('visibilitychange', syncWithPage);
		viewport.disconnect();
		canvas.removeEventListener('webglcontextlost', onContextLost);
	};
	frames.first();
	document.addEventListener('visibilitychange', syncWithPage);
	canvas.addEventListener('webglcontextlost', onContextLost);
	viewport.observe(canvas);
	return { stop, ...createLoopVerbs(stage, state) };
}

async function start(canvas: HTMLCanvasElement, bytes: Uint8Array, framing: FigureFraming, give: (signal: FigureSignal) => void): Promise<Outcome> {
	if (checkFigure(bytes).length > 0) return ended(figureSignal.refused);
	const opened = openRenderer(canvas);
	if (typeof opened === 'string') return ended(opened);
	const renderer = opened;
	let vrm: VRM | undefined;
	let loop: Loop | undefined;
	let stage: FigureStage | undefined;
	const release = () => {
		loop?.stop();
		stage?.showRoom(null);
		if (vrm !== undefined) VRMUtils.deepDispose(vrm.scene);
		renderer.dispose();
		renderer.forceContextLoss();
	};
	try {
		vrm = await loadFigure(bytes);
		const figure = vrm;
		// A loss during the load fired its event before the loop listens for it, so the state is read here.
		if (renderer.getContext().isContextLost()) return { signal: figureSignal.lost, release, ...endedFacts };
		const drawn = createFigureStage(renderer, canvas, figure, framing);
		stage = drawn;
		loop = runLoop(drawn, canvas, give);
		return {
			signal: figureSignal.drawn,
			release,
			think: loop.think,
			listen: loop.listen,
			speak: loop.speak,
			gesture: loop.gesture,
			frame: loop.frame,
			replaceClip: drawn.gestures.replace,
			showRoom: drawn.showRoom
		};
	} catch {
		release();
		return ended(figureSignal.refused);
	}
}

/**
 * Judges each clip of `gestures` under a key that names a gesture with `checkClip`, parses what passes, and hands the parsed clip to
 * `replaceClip` unless `isDisposed` by then. `load` parses the bytes of a clip that passed. Whatever goes wrong with a clip, or with the option itself, drops it: nothing is signalled
 * and nothing rejects.
 */
async function adoptClips(
	load: ClipLoad,
	options: MountOptions | undefined,
	replaceClip: Outcome['replaceClip'],
	isDisposed: () => boolean
): Promise<void> {
	try {
		await Promise.all(
			Object.entries(options?.gestures ?? {}).map(async ([name, bytes]) => {
				try {
					if (!isFigureGesture(name) || checkClip(bytes).length > 0) return;
					const clip = await load(bytes);
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
 * The room the figure shows is the result of the last call the returned function got: bytes that pass `checkRoom` and `load` shows
 * through `show` once they have parsed, none for bytes that fail the check or the load, and none for null, which also cancels a load.
 * A room stays until its replacement has parsed. A load an earlier call started, one that ends when `isOver`, and one that fails
 * show nothing, and what they parsed is freed; the stage frees a room it replaces or removes. A value that is neither bytes nor null,
 * and the bytes of the last call again, change nothing.
 */
function createRoomAdoption(load: RoomLoad, show: (room: Object3D | null) => void, isOver: () => boolean): (value: unknown) => void {
	let calls = 0;
	let latest: Uint8Array | null | undefined;
	const adopt = async (bytes: Uint8Array, call: number) => {
		let room: Object3D | null = null;
		try {
			if (checkRoom(bytes).length === 0) room = await load(bytes);
		} catch {
			// A room that cannot be judged or loaded leaves none.
		}
		if (call !== calls || isOver()) {
			if (room !== null) VRMUtils.deepDispose(room);
			return;
		}
		show(room);
	};
	return (value) => {
		if (isOver() || value === latest || !isRoomValue(value)) return;
		latest = value;
		const call = ++calls;
		if (value === null) show(null);
		else void adopt(value, call);
	};
}

/** Whether a value is a room's bytes or the none, judged without ending the figure when its reads throw, as a revoked proxy's do. */
function isRoomValue(value: unknown): value is Uint8Array | null {
	try {
		return value === null || value instanceof Uint8Array;
	} catch {
		return false;
	}
}

/** The room the mount option names, or undefined for an option that cannot be read. */
function startingRoom(options: MountOptions | undefined): unknown {
	try {
		return options?.room;
	} catch {
		return undefined;
	}
}

/** The framing the figure's first frame is drawn in: the option's, or the default for a value that is no framing or an option that cannot be read. */
function startingFraming(options: MountOptions | undefined): FigureFraming {
	try {
		const named: unknown = options?.framing;
		return isFigureFraming(named) ? named : defaultFraming;
	} catch {
		return defaultFraming;
	}
}

/** What `mount` does, with `loads` as the parse of a clip's and a room's bytes: the seam through which a test controls when a parse ends and how. */
export async function mountWithLoads(loads: Loads, canvas: HTMLCanvasElement, bytes: Uint8Array, options?: MountOptions): Promise<FigureHandle> {
	let current: FigureSignal = figureSignal.refused;
	const give = (signal: FigureSignal) => {
		current = signal;
		try {
			options?.onSignal?.(signal);
		} catch (error) {
			reportError(error);
		}
	};
	const { signal, release, think, listen, speak, gesture, frame, replaceClip, showRoom } = await start(canvas, bytes, startingFraming(options), give).catch(() => ended(figureSignal.refused));
	give(signal);
	let disposed = false;
	const adoptRoom = createRoomAdoption(loads.room, showRoom, () => disposed || current !== figureSignal.drawn);
	if (signal === figureSignal.drawn) {
		void adoptClips(loads.clip, options, replaceClip, () => disposed);
		adoptRoom(startingRoom(options));
	}
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
		gesture,
		frame,
		room: adoptRoom
	};
}
