import { AmbientLight, DirectionalLight, PerspectiveCamera, Quaternion, Scene, Vector3, type Object3D, type WebGLRenderer } from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { figureMood } from './expressions.js';
import { easeExtents, extentsOf, fieldOfViewDegrees, placeCamera, type Extents } from './framingCamera.js';
import type { FigureFraming } from './framings.js';
import { createGestureLayer, quaternionOfTurn, type GestureLayer } from './gestureLayer.js';
import { spreadPosture, type FigurePose, type Turn } from './figureMotion.js';

/** The picture's camera planes in metres: the field of view is the framing camera's. */
const camera = { near: 0.05, far: 20 };
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
	/** The layer of gestures the stage draws, whose clips a loaded clip replaces. */
	readonly gestures: GestureLayer;
	/** Sets the picture to show `framing`: the camera eases toward it in the frames `draw` is told to glide in, and is there at once in the others. */
	frame(framing: FigureFraming): void;
	/**
	 * Sets the figure to `pose` and draws it, the drawing buffer first following the canvas when its size or the pixel ratio changed.
	 * With `glides` the camera eases toward the framing the stage is set to; without it the camera is at that framing in this frame.
	 */
	draw(pose: FigurePose, elapsedSeconds: number, glides: boolean): void;
}

/** The stage for `vrm` at rest, on the renderer's canvas, first drawn in `framing`: the camera frames the eyes where they are now, so the figure moves in front of it. */
export function createFigureStage(renderer: WebGLRenderer, canvas: HTMLCanvasElement, vrm: VRM, framing: FigureFraming): FigureStage {
	vrm.scene.traverse((node) => {
		node.frustumCulled = false;
	});
	vrm.scene.updateMatrixWorld(true);
	const eyes = vrm.lookAt!.getLookAtWorldPosition(new Vector3());
	const footHeight = Math.min(...(['leftFoot', 'rightFoot'] as const).map((name) => vrm.humanoid.getNormalizedBoneNode(name)!.getWorldPosition(new Vector3()).y));
	const eyesAboveFeet = eyes.y - footHeight;
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
	const restedTrunk = [spine, chest, leftShoulder, rightShoulder];
	const armBones = new Set<Object3D>([leftUpperArm, rightUpperArm, rightLowerArm, rightHand]);
	renderer.setClearColor(0, 0);
	let drawn: DrawingSize | undefined;
	// The camera looks straight down the z axis at the plane of the eyes, so it needs no turn.
	const view = new PerspectiveCamera(fieldOfViewDegrees, 1, camera.near, camera.far);
	let target: Extents = extentsOf(framing, eyesAboveFeet);
	let shown = target;
	let posed = false;
	return {
		gestures,
		frame(next) {
			target = extentsOf(next, eyesAboveFeet);
		},
		draw(pose, elapsedSeconds, glides) {
			const size = currentSize(canvas);
			if (drawn === undefined || !isSameSize(drawn, size)) {
				renderer.setPixelRatio(size.pixelRatio);
				renderer.setSize(size.width, size.height, false);
				view.aspect = size.width / size.height;
				view.updateProjectionMatrix();
				drawn = size;
			}
			shown = glides ? easeExtents(shown, target, elapsedSeconds) : target;
			const { heightFromEyes, distance } = placeCamera(shown, view.aspect);
			view.position.set(eyes.x, eyes.y + heightFromEyes, eyes.z + distance);
			turnBone(leftUpperArm, pose.arms.leftUpperArm);
			turnBone(rightUpperArm, pose.arms.rightUpperArm);
			turnBone(rightLowerArm, pose.arms.rightLowerArm);
			restBone(rightHand);
			// The layer turns a bone from the turn it holds, so each bone it may turn starts from the base pose, the trunk's deltas coming after it.
			restedTrunk.forEach(restBone);
			for (const bone of gestures.nodes) if (!armBones.has(bone)) restBone(bone);
			if (pose.gesture !== null) gestures.apply(pose.gesture);
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
