import type { FigureMood } from './expressions.js';
import type { FigureGesture } from './gestures.js';
import type { FigureSignal } from './signals.js';

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
