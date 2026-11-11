import { AmbientLight, DirectionalLight, MathUtils, PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { spreadPosture, type FigurePose } from './figureMotion.js';

/** The picture's camera, lights and clear colour are the values of hopin's docs/mockups/agent-tile-figure/agent-tile-figure.html. */
const camera = { fieldOfView: 22, near: 0.05, far: 20 };
/** The distances, in metres from the eyes, the picture shows above the head, below it and to either side. */
const framing = { above: 0.25, below: 0.4, halfWidth: 0.31 };
/** The most drawing-buffer pixels per CSS pixel: a denser screen gets this ratio, not its own. */
const maximumPixelRatio = 2;

/** The drawing buffer's pixels per CSS pixel: the window's device pixel ratio, capped. */
function drawingPixelRatio(): number {
	return Math.min(window.devicePixelRatio, maximumPixelRatio);
}

function lightedScene(vrm: VRM): Scene {
	const key = new DirectionalLight(0xffffff, Math.PI);
	key.position.set(0.7, 1, 1.3);
	const scene = new Scene();
	scene.add(key, new AmbientLight(0xffffff, 0.55), vrm.scene);
	return scene;
}

/** A camera looking at the eyes of the figure at rest, centred on them, wide enough for the canvas's aspect. */
function headAndShouldersCamera(eyes: Vector3, aspect: number): PerspectiveCamera {
	const tangent = Math.tan(MathUtils.degToRad(camera.fieldOfView / 2));
	const centreHeight = eyes.y + (framing.above - framing.below) / 2;
	const distance = Math.max((framing.above + framing.below) / 2 / tangent, framing.halfWidth / (tangent * aspect));
	const view = new PerspectiveCamera(camera.fieldOfView, aspect, camera.near, camera.far);
	view.position.set(eyes.x, centreHeight, eyes.z + distance);
	view.lookAt(eyes.x, centreHeight, eyes.z);
	return view;
}

/** What the drawing buffer depends on: the canvas's client size and the pixel ratio it is drawn at. */
interface DrawingSize {
	readonly width: number;
	readonly height: number;
	readonly pixelRatio: number;
}

function isSameSize(first: DrawingSize, second: DrawingSize): boolean {
	return first.width === second.width && first.height === second.height && first.pixelRatio === second.pixelRatio;
}

function currentSize(canvas: HTMLCanvasElement): DrawingSize {
	return { width: Math.max(2, canvas.clientWidth), height: Math.max(2, canvas.clientHeight), pixelRatio: drawingPixelRatio() };
}

/** A figure's lights and camera, built once, and the frame that draws it. */
export interface FigureStage {
	/** Sets the figure to `pose` and draws it, the drawing buffer first following the canvas when its size or the pixel ratio changed. */
	draw(pose: FigurePose, elapsedSeconds: number): void;
}

/** The stage for `vrm` at rest, on the renderer's canvas: the camera frames the eyes where they are now, so the figure moves in front of it. */
export function createFigureStage(renderer: WebGLRenderer, canvas: HTMLCanvasElement, vrm: VRM): FigureStage {
	vrm.scene.traverse((node) => {
		node.frustumCulled = false;
	});
	vrm.scene.updateMatrixWorld(true);
	const eyes = vrm.lookAt!.getLookAtWorldPosition(new Vector3());
	const scene = lightedScene(vrm);
	const spine = vrm.humanoid.getNormalizedBoneNode('spine')!;
	const head = vrm.humanoid.getNormalizedBoneNode('head')!;
	const neck = vrm.humanoid.getNormalizedBoneNode('neck');
	const chest = vrm.humanoid.getNormalizedBoneNode('chest');
	const bones = { neck: neck !== null, chest: chest !== null };
	renderer.setClearColor(0, 0);
	let drawn: DrawingSize | undefined;
	let view: PerspectiveCamera;
	return {
		draw(pose, elapsedSeconds) {
			const size = currentSize(canvas);
			if (drawn === undefined || !isSameSize(drawn, size)) {
				renderer.setPixelRatio(size.pixelRatio);
				renderer.setSize(size.width, size.height, false);
				view = headAndShouldersCamera(eyes, size.width / size.height);
				drawn = size;
			}
			spine.rotation.x = pose.breath;
			const spread = spreadPosture(pose.posture, bones);
			head.rotation.set(pose.head.pitch + spread.head.pitch, pose.head.yaw + spread.head.yaw, pose.head.roll + spread.head.roll);
			neck?.rotation.set(spread.neck.pitch, spread.neck.yaw, spread.neck.roll);
			chest?.rotation.set(spread.chest.pitch, spread.chest.yaw, spread.chest.roll);
			vrm.expressionManager!.setValue('blink', pose.blink);
			vrm.lookAt!.yaw = pose.look.yaw;
			vrm.lookAt!.pitch = pose.look.pitch;
			vrm.update(elapsedSeconds);
			renderer.render(scene, view);
		}
	};
}
