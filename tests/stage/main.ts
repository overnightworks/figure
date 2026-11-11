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
const picker = document.querySelector<HTMLInputElement>('#picker')!;
const slots = cssWidths.map((cssWidth) => createSlot(cssWidth, stage));

picker.addEventListener('change', async () => {
	const picked = picker.files?.[0];
	if (picked === undefined) return;
	figureBytes = new Uint8Array(await picked.arrayBuffer());
	await Promise.all(slots.map((slot) => mountSlot(slot)));
});

void Promise.all(slots.map((slot) => mountSlot(slot)));
