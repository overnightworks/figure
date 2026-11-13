import { AmbientLight, DirectionalLight, MathUtils, PerspectiveCamera, Quaternion, Scene, Vector3, type Object3D, type WebGLRenderer } from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { figureMood } from './expressions.js';
import { createGestureLayer, quaternionOfTurn } from './gestureLayer.js';
import { spreadPosture, type FigurePose, type Turn } from './figureMotion.js';

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

/** Sets a bone's rotation to `turn`. */
function turnBone(bone: Object3D, turn: Turn): void {
	bone.rotation.set(turn.pitch, turn.yaw, turn.roll);
}

const turnAsQuaternion = new Quaternion();

/** Returns a bone to its rest, the identity of a normalized humanoid bone; a bone the model lacks is skipped. */
function restBone(bone: Object3D | null): void {
	bone?.quaternion.identity();
}

/** Adds `turn` to the rotation the bone holds, in its parent's frame; a bone the model lacks is skipped. */
function addTurn(bone: Object3D | null, turn: Turn): void {
	bone?.quaternion.premultiply(quaternionOfTurn(turn, turnAsQuaternion));
}

/**
 * Starts the spring bones from the posture the figure is set to now. A loader records their start in the file's bind pose, so without
 * this the sleeves and the hair would swing from that pose to the posture over the first frames. `reset()` runs before the first
 * `vrm.update`, which poses the humanoid only as its first step, so the humanoid is posed here first.
 */
function startSpringBonesAtPose(vrm: VRM): void {
	vrm.humanoid.update();
	vrm.springBoneManager?.reset();
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
	const leftShoulder = vrm.humanoid.getNormalizedBoneNode('leftShoulder');
	const rightShoulder = vrm.humanoid.getNormalizedBoneNode('rightShoulder');
	const leftUpperArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm')!;
	const rightUpperArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm')!;
	const rightLowerArm = vrm.humanoid.getNormalizedBoneNode('rightLowerArm')!;
	const rightHand = vrm.humanoid.getNormalizedBoneNode('rightHand')!;
	const gestures = createGestureLayer(vrm.humanoid);
	const restedBones = [spine, chest, leftShoulder, rightShoulder];
	renderer.setClearColor(0, 0);
	let drawn: DrawingSize | undefined;
	let view: PerspectiveCamera;
	let posed = false;
	return {
		draw(pose, elapsedSeconds) {
			const size = currentSize(canvas);
			if (drawn === undefined || !isSameSize(drawn, size)) {
				renderer.setPixelRatio(size.pixelRatio);
				renderer.setSize(size.width, size.height, false);
				view = headAndShouldersCamera(eyes, size.width / size.height);
				drawn = size;
			}
			turnBone(leftUpperArm, pose.arms.leftUpperArm);
			turnBone(rightUpperArm, pose.arms.rightUpperArm);
			turnBone(rightLowerArm, pose.arms.rightLowerArm);
			restBone(rightHand);
			if (pose.gesture !== null) gestures.apply(pose.gesture);
			restedBones.forEach(restBone);
			const spread = spreadPosture(pose.posture, bones);
			addTurn(spine, { pitch: pose.breath + pose.trunkLean + pose.moodTrunk.spine, yaw: 0, roll: 0 });
			addTurn(chest, { pitch: spread.chest.pitch + pose.trunkLean + pose.moodTrunk.chest, yaw: spread.chest.yaw, roll: spread.chest.roll });
			addTurn(leftShoulder, pose.shoulders.left);
			addTurn(rightShoulder, pose.shoulders.right);
			head.rotation.set(pose.head.pitch + spread.head.pitch, pose.head.yaw + spread.head.yaw, pose.head.roll + spread.head.roll);
			neck?.rotation.set(spread.neck.pitch, spread.neck.yaw, spread.neck.roll);
			vrm.expressionManager!.setValue('blink', pose.blink);
			for (const [shape, weight] of Object.entries(pose.mouth)) vrm.expressionManager!.setValue(shape, weight);
			for (const mood of Object.values(figureMood)) vrm.expressionManager!.setValue(mood, pose.mood[mood]);
			vrm.lookAt!.yaw = pose.look.yaw;
			vrm.lookAt!.pitch = pose.look.pitch;
			if (!posed) {
				startSpringBonesAtPose(vrm);
				posed = true;
			}
			vrm.update(elapsedSeconds);
			renderer.render(scene, view);
		}
	};
}
