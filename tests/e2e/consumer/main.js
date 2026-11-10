import { checkFigure } from 'overnightworks-figure';
import { mount } from 'overnightworks-figure/draw';

const fileNames = ['figure.vrm', 'not-glb.txt'];
const refusalsByFile = {};
for (const fileName of fileNames) {
	const response = await fetch(`/${fileName}`);
	refusalsByFile[fileName] = checkFigure(new Uint8Array(await response.arrayBuffer()));
}
const output = document.getElementById('refusals');
output.textContent = JSON.stringify(refusalsByFile);
output.dataset.done = 'true';

const figureResponse = await fetch('/figure.vrm');
const canvas = document.getElementById('figure');
const signals = [];
await mount(canvas, new Uint8Array(await figureResponse.arrayBuffer()), { onSignal: (signal) => signals.push(signal) });
canvas.dataset.signals = signals.join(' ');
