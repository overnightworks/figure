import { AmbientLight, DirectionalLight, MathUtils, PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from 'three';
import type { VRM } from '@pixiv/three-vrm';

/** The picture's camera, lights and clear colour are the values of hopin's docs/mockups/agent-tile-figure/agent-tile-figure.html. */
const camera = { fieldOfView: 22, near: 0.05, far: 20 };
/** The distances, in metres from the eyes, the picture shows above the head, below it and to either side. */
const framing = { above: 0.25, below: 0.4, halfWidth: 0.31 };
/** The most drawing-buffer pixels per CSS pixel: a denser screen gets this ratio, not its own. */
const maximumPixelRatio = 2;

/** The drawing buffer's pixels per CSS pixel: the window's device pixel ratio, capped. */
export function drawingPixelRatio(): number {
	return Math.min(window.devicePixelRatio, maximumPixelRatio);
}

function lightedScene(vrm: VRM): Scene {
	const key = new DirectionalLight(0xffffff, Math.PI);
	key.position.set(0.7, 1, 1.3);
	const scene = new Scene();
	scene.add(key, new AmbientLight(0xffffff, 0.55), vrm.scene);
	return scene;
}

/** A camera looking at the figure's head and shoulders, centred on the eyes, wide enough for the canvas's aspect. */
function headAndShouldersCamera(vrm: VRM, aspect: number): PerspectiveCamera {
	vrm.scene.updateMatrixWorld(true);
	const eyes = vrm.lookAt!.getLookAtWorldPosition(new Vector3());
	const tangent = Math.tan(MathUtils.degToRad(camera.fieldOfView / 2));
	const centreHeight = eyes.y + (framing.above - framing.below) / 2;
	const distance = Math.max((framing.above + framing.below) / 2 / tangent, framing.halfWidth / (tangent * aspect));
	const view = new PerspectiveCamera(camera.fieldOfView, aspect, camera.near, camera.far);
	view.position.set(eyes.x, centreHeight, eyes.z + distance);
	view.lookAt(eyes.x, centreHeight, eyes.z);
	return view;
}

/** Draws the figure into the renderer's canvas: the drawing buffer is the canvas's client size at the drawing pixel ratio. */
export function drawFigureFrame(renderer: WebGLRenderer, canvas: HTMLCanvasElement, vrm: VRM): void {
	const width = Math.max(2, canvas.clientWidth);
	const height = Math.max(2, canvas.clientHeight);
	renderer.setClearColor(0, 0);
	renderer.setPixelRatio(drawingPixelRatio());
	renderer.setSize(width, height, false);
	vrm.scene.traverse((node) => {
		node.frustumCulled = false;
	});
	vrm.update(0);
	renderer.render(lightedScene(vrm), headAndShouldersCamera(vrm, width / height));
}
