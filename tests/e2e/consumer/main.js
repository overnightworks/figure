import { checkFigure } from 'overnightworks-figure';

const fileNames = ['figure.vrm', 'not-glb.txt'];
const refusalsByFile = {};
for (const fileName of fileNames) {
	const response = await fetch(`/${fileName}`);
	refusalsByFile[fileName] = checkFigure(new Uint8Array(await response.arrayBuffer()));
}
const output = document.getElementById('refusals');
output.textContent = JSON.stringify(refusalsByFile);
output.dataset.done = 'true';
