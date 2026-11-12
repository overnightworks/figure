import { figureSignal, mount, type FigureHandle, type FigureSignal } from '../../src/draw.js';
import { buildConformantVrm } from '../figureFixtures.js';

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

picker.addEventListener('change', async () => {
	const picked = picker.files?.[0];
	if (picked === undefined) return;
	figureBytes = new Uint8Array(await picked.arrayBuffer());
	await Promise.all(slots.map((slot) => mountSlot(slot)));
});

void Promise.all(slots.map((slot) => mountSlot(slot)));
