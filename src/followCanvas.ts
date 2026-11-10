import { drawingPixelRatio } from './figureFrame.js';

/** What the drawing buffer depends on: the canvas's client size and the pixel ratio it is drawn at. */
interface DrawingSize {
	readonly width: number;
	readonly height: number;
	readonly pixelRatio: number;
}

function currentSize(canvas: HTMLCanvasElement): DrawingSize {
	return { width: canvas.clientWidth, height: canvas.clientHeight, pixelRatio: drawingPixelRatio() };
}

function isSameSize(first: DrawingSize, second: DrawingSize): boolean {
	return first.width === second.width && first.height === second.height && first.pixelRatio === second.pixelRatio;
}

/**
 * Calls `redraw` each time the canvas's client size or the drawing pixel ratio differs from the size it was last drawn at,
 * which the caller has just drawn. A change of the ratio alone (a zoom, a move to another screen) is seen through a media
 * query on the ratio, which a change re-arms. Returns the function that stops following: it removes both observers.
 */
export function followCanvas(canvas: HTMLCanvasElement, redraw: () => void): () => void {
	let drawn = currentSize(canvas);
	const redrawIfChanged = () => {
		const now = currentSize(canvas);
		if (isSameSize(now, drawn)) return;
		drawn = now;
		redraw();
	};
	const resizeObserver = new ResizeObserver(redrawIfChanged);
	resizeObserver.observe(canvas);
	let ratioQuery: MediaQueryList;
	const onRatioChange = () => {
		redrawIfChanged();
		watchRatio();
	};
	const watchRatio = () => {
		ratioQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
		ratioQuery.addEventListener('change', onRatioChange, { once: true });
	};
	watchRatio();
	return () => {
		resizeObserver.disconnect();
		ratioQuery.removeEventListener('change', onRatioChange);
	};
}
