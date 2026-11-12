import { figureSignal, mount, type FigureHandle, type FigureSignal } from '../../src/draw.js';
import type { MouthShape } from '../../src/expressions.js';
import { buildConformantVrm } from '../figureFixtures.js';
import { syntheticVoice } from '../syntheticVoice.js';

/** The CSS widths the stage mounts at, in pixels: a phone and a desktop. */
const cssWidths = [390, 1280];
/** The canvas is four units wide and five high: a portrait frame for the head and shoulders. */
const heightPerWidth = 1.25;

/** One drawing of the stage: its canvas sits in `mountPoint`, its signal is written beside it. */
interface Slot {
	readonly cssWidth: number;
	readonly mountPoint: HTMLElement;
	readonly signalText: HTMLElement;
	readonly mountAgain: HTMLButtonElement;
	handle: FigureHandle | undefined;
}

/** The figure every drawing mounts: the synthetic one until the visitor picks a file. */
let figureBytes: Uint8Array = buildConformantVrm();

/** Whether the stage reports its agent as thinking: a freshly mounted figure is told at once. */
let thinking = false;

/** Whom the stage reports as speaking: nobody, an element at the left edge, one at the right edge, or one the visitor drags. */
type SpeakerChoice = 'nobody' | 'left' | 'right' | 'drag';

/** The element each choice but nobody names, a small marker that sits in the viewport while its choice is the speaker. */
const speakerMarkers = new Map<SpeakerChoice, HTMLElement>();

/** The speaker the stage reports: a freshly mounted figure is told at once. */
let speaker: HTMLElement | null = null;

/** What the stage reports its agent as saying: nothing until the visitor starts a sentence. A freshly mounted figure is told at once. */
type Sentence = { readonly voice?: AudioNode } | null;

let sentence: Sentence = null;

/** The share of the voices' level the visitor hears. */
const heardGain = 0.3;

/** The stage's one audio context, made on the first click that needs one, and the node that carries the voices to the speakers. */
interface Audio {
	readonly context: AudioContext;
	readonly speakers: GainNode;
}

let audio: Audio | undefined;

/** Ends the sound of the sentence that plays, if any. */
let silence = () => {};

/** Writes a signal beside the slot only while its canvas is the one shown: a replaced canvas still records its own signal. */
function showSignal(slot: Slot, canvas: HTMLCanvasElement, signal: FigureSignal): void {
	canvas.dataset.signal = signal;
	if (!slot.mountPoint.contains(canvas)) return;
	slot.signalText.textContent = signal;
	slot.mountAgain.hidden = signal === figureSignal.drawn;
}

/** Mounts `figureBytes` on a fresh canvas: a freed canvas gives no new context, so a drawing never reuses one. */
async function mountSlot(slot: Slot): Promise<void> {
	slot.handle?.dispose();
	const canvas = document.createElement('canvas');
	canvas.style.width = `${slot.cssWidth}px`;
	canvas.style.height = `${Math.round(slot.cssWidth * heightPerWidth)}px`;
	slot.mountPoint.replaceChildren(canvas);
	slot.signalText.textContent = 'mounting';
	slot.mountAgain.hidden = true;
	const handle = await mount(canvas, figureBytes, { onSignal: (signal) => showSignal(slot, canvas, signal) });
	// A mount that resolves after a newer one replaced its canvas is released here, so its context and loop do not leak.
	if (!slot.mountPoint.contains(canvas)) {
		handle.dispose();
		return;
	}
	slot.handle = handle;
	handle.think(thinking);
	handle.listen(speaker);
	handle.speak(sentence);
}

function createSlot(cssWidth: number, stage: HTMLElement): Slot {
	const section = document.createElement('section');
	const heading = document.createElement('h2');
	heading.textContent = `${cssWidth} px`;
	const mountPoint = document.createElement('div');
	const signalText = document.createElement('p');
	const mountAgain = document.createElement('button');
	mountAgain.type = 'button';
	mountAgain.textContent = 'mount again';
	mountAgain.hidden = true;
	section.append(heading, mountPoint, signalText, mountAgain);
	stage.append(section);
	const slot: Slot = { cssWidth, mountPoint, signalText, mountAgain, handle: undefined };
	mountAgain.addEventListener('click', () => void mountSlot(slot));
	return slot;
}

const stage = document.querySelector<HTMLElement>('#stage')!;
const thinkButton = document.querySelector<HTMLButtonElement>('#think')!;
const picker = document.querySelector<HTMLInputElement>('#picker')!;
const voiceStatus = document.querySelector<HTMLElement>('#voice-status')!;
const voicePicker = document.querySelector<HTMLInputElement>('#voice-picker')!;
const slots = cssWidths.map((cssWidth) => createSlot(cssWidth, stage));

/** A marker the visitor can see and, for the dragged one, move with a pointer. */
function createSpeakerMarker(choice: SpeakerChoice, position: Partial<CSSStyleDeclaration>): HTMLElement {
	const marker = document.createElement('div');
	marker.dataset.speaker = choice;
	marker.textContent = 'speaker';
	marker.hidden = true;
	Object.assign(marker.style, { position: 'fixed', padding: '8px', background: 'gold', touchAction: 'none', ...position });
	document.body.append(marker);
	return marker;
}

/** Moves `marker` with the pointer while it is held on it. */
function makeDraggable(marker: HTMLElement): void {
	marker.style.cursor = 'grab';
	marker.addEventListener('pointerdown', (event) => marker.setPointerCapture(event.pointerId));
	marker.addEventListener('pointermove', (event) => {
		if (!marker.hasPointerCapture(event.pointerId)) return;
		marker.style.left = `${event.clientX - marker.offsetWidth / 2}px`;
		marker.style.top = `${event.clientY - marker.offsetHeight / 2}px`;
	});
}

speakerMarkers.set('left', createSpeakerMarker('left', { left: '8px', top: '40%' }));
speakerMarkers.set('right', createSpeakerMarker('right', { right: '8px', top: '40%' }));
speakerMarkers.set('drag', createSpeakerMarker('drag', { left: '50%', top: '60%' }));
makeDraggable(speakerMarkers.get('drag')!);

document.querySelector<HTMLFieldSetElement>('#speaker')!.addEventListener('change', (event) => {
	const choice = (event.target as HTMLInputElement).value as SpeakerChoice;
	speakerMarkers.forEach((marker, name) => {
		marker.hidden = name !== choice;
	});
	speaker = speakerMarkers.get(choice) ?? null;
	slots.forEach((slot) => slot.handle?.listen(speaker));
});

thinkButton.addEventListener('click', () => {
	thinking = !thinking;
	thinkButton.setAttribute('aria-pressed', String(thinking));
	slots.forEach((slot) => slot.handle?.think(thinking));
});

/** Reports the sentence to every figure and shows it. */
function tell(next: Sentence, status: string): void {
	sentence = next;
	voiceStatus.textContent = status;
	slots.forEach((slot) => slot.handle?.speak(sentence));
}

/** The number of the control that took the stage last. */
let lastControl = 0;

/** Takes the stage for a control and returns whether it still holds it: a control that waits checks after each wait before it starts audio. */
function takeControl(): () => boolean {
	const mine = ++lastControl;
	return () => mine === lastControl;
}

function endSentence(): void {
	silence();
	silence = () => {};
}

/** The audio context, made at the first call and running by the time it returns; a click is the user activation the browser asks for. */
async function runningAudio(): Promise<Audio> {
	if (audio === undefined) {
		const context = new AudioContext();
		const speakers = context.createGain();
		speakers.gain.value = heardGain;
		speakers.connect(context.destination);
		audio = { context, speakers };
	}
	await audio.context.resume();
	return audio;
}

function pickedVowel(): MouthShape {
	return document.querySelector<HTMLInputElement>('input[name="vowel"]:checked')!.value as MouthShape;
}

document.querySelector<HTMLButtonElement>('#speak')!.addEventListener('click', async () => {
	const stillMine = takeControl();
	const { context, speakers } = await runningAudio();
	if (!stillMine()) return;
	endSentence();
	const vowel = pickedVowel();
	const voice = syntheticVoice(context, vowel);
	voice.output.connect(speakers);
	silence = () => {
		voice.stop();
		voice.output.disconnect();
	};
	tell({ voice: voice.output }, `speaking ${vowel} (audio ${context.state})`);
});

voicePicker.addEventListener('change', async () => {
	const picked = voicePicker.files?.[0];
	if (picked === undefined) return;
	const stillMine = takeControl();
	const bytes = await picked.arrayBuffer();
	voicePicker.value = '';
	const { context, speakers } = await runningAudio();
	if (!stillMine()) return;
	endSentence();
	let recording: AudioBuffer | undefined;
	try {
		recording = await context.decodeAudioData(bytes);
	} catch {
		recording = undefined;
	}
	if (!stillMine()) return;
	if (recording === undefined) {
		tell(null, 'not audio');
		return;
	}
	const source = context.createBufferSource();
	source.buffer = recording;
	const player = context.createGain();
	source.connect(player);
	player.connect(speakers);
	silence = () => {
		source.onended = null;
		source.stop();
		player.disconnect();
	};
	source.onended = () => {
		endSentence();
		tell(null, 'quiet');
	};
	source.start();
	tell({ voice: player }, `speaking ${picked.name} (audio ${context.state})`);
});

document.querySelector<HTMLButtonElement>('#speak-without-voice')!.addEventListener('click', () => {
	takeControl();
	endSentence();
	tell({}, 'speaking without a voice');
});

document.querySelector<HTMLButtonElement>('#stop')!.addEventListener('click', () => {
	takeControl();
	endSentence();
	tell(null, 'quiet');
});

picker.addEventListener('change', async () => {
	const picked = picker.files?.[0];
	if (picked === undefined) return;
	figureBytes = new Uint8Array(await picked.arrayBuffer());
	await Promise.all(slots.map((slot) => mountSlot(slot)));
});

void Promise.all(slots.map((slot) => mountSlot(slot)));
