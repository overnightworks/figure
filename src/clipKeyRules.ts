import type { Refusal } from './codes.js';
import { attemptRead, indexOf, isJsonObject, objectOf, requiredListOf, unreadable, type JsonObject } from './json.js';
import { clipProfile } from './profile.js';

const FLOAT = 5126;
/** The component types glTF gives a rotation besides float; each stores a normalised integer. */
const NORMALISED_INTEGERS: ReadonlySet<unknown> = new Set([5120, 5121, 5122, 5123]);
const BYTES_PER_COMPONENT = 4;
const ALIGNMENT_BYTES = 4;
const COMPONENTS_OF_TYPE = { SCALAR: 1, VEC3: 3, VEC4: 4 } as const;
const ROTATION_COMPONENTS = COMPONENTS_OF_TYPE.VEC4;
const INTERPOLATIONS: ReadonlySet<unknown> = new Set(['LINEAR', 'STEP', 'CUBICSPLINE']);
/** A cubic spline key holds an in tangent, the value and an out tangent. */
const CUBIC_KEY_VALUES = 3;

type AccessorType = keyof typeof COMPONENTS_OF_TYPE;

/** A channel's key data: what it animates and the sampler that holds the times and the values. */
export interface KeyChannel {
	readonly path: 'rotation' | 'translation' | 'scale';
	readonly sampler: JsonObject;
}

/** An accessor whose bytes the file holds: how many elements, and where the first one starts in the binary chunk. */
interface Located {
	readonly count: number;
	readonly start: number;
}

/**
 * Judges one channel's accessors and bytes, pushing what it finds to `refusals` under `place`; returns the time of its last key, or
 * undefined when the times could not be read. Translation and scale values are shaped and bounded but never read: none plays.
 */
export function keyRefusals(
	json: JsonObject,
	binaryChunk: Uint8Array | undefined,
	place: string,
	channel: KeyChannel,
	refusals: Refusal[]
): number | undefined {
	const binary = binaryChunk ?? new Uint8Array();
	let lastSeconds: number | undefined;
	attemptRead(refusals, place, () => {
		const interpolation = channel.sampler['interpolation'] ?? 'LINEAR';
		if (!INTERPOLATIONS.has(interpolation)) {
			unreadable('the sampler names an interpolation glTF does not give');
		}
		const isRotation = channel.path === 'rotation';
		const times = locate(json, binary, channel.sampler['input'], 'SCALAR', refusals);
		const values = locate(json, binary, channel.sampler['output'], isRotation ? 'VEC4' : 'VEC3', refusals);
		if (times === undefined || values === undefined) {
			return;
		}
		const isCubic = interpolation === 'CUBICSPLINE';
		if (values.count !== times.count * (isCubic ? CUBIC_KEY_VALUES : 1)) {
			unreadable('the sampler holds a count of values that does not fit its interpolation');
		}
		const view = new DataView(binary.buffer, binary.byteOffset, binary.length);
		const seconds = floatsAt(view, times, 1);
		if (timesAreValid(seconds)) {
			lastSeconds = seconds.at(-1);
		} else {
			refusals.push({ code: 'clip_keys_invalid', detail: `${place} has times that are not finite, 0 or later and strictly ascending` });
		}
		if (isRotation && !rotationsAreValid(floatsAt(view, values, ROTATION_COMPONENTS), isCubic)) {
			refusals.push({ code: 'clip_keys_invalid', detail: `${place} has a rotation that is not finite or not of unit length` });
		}
	});
	return lastSeconds;
}

/** Reads an accessor's shape; undefined, with the refusal pushed, when the profile does not take it or its bytes lie outside the file. */
function locate(json: JsonObject, binary: Uint8Array, accessorIndex: unknown, type: AccessorType, refusals: Refusal[]): Located | undefined {
	const index = indexOf(accessorIndex);
	const accessor = objectOf(requiredListOf(json['accessors'])[index]);
	if (accessor['type'] !== type) {
		unreadable(`accessor ${index} is not ${type}`);
	}
	const componentType = accessor['componentType'];
	if (componentType !== FLOAT && !(type === 'VEC4' && NORMALISED_INTEGERS.has(componentType))) {
		unreadable(`accessor ${index} has a component type glTF does not give this data`);
	}
	if (accessor['normalized'] === true && componentType === FLOAT) {
		unreadable(`accessor ${index} is normalised, which glTF forbids for float`);
	}
	const count = accessor['count'];
	if (!Number.isInteger(count) || (count as number) < 1) {
		unreadable(`accessor ${index} has a count that is not a positive integer`);
	}
	const notAllowed = shapeNotAllowed(accessor);
	if (notAllowed !== undefined) {
		refusals.push({ code: 'clip_track_not_allowed', detail: `accessor ${index} ${notAllowed}` });
		return undefined;
	}
	const bufferView = objectOf(requiredListOf(json['bufferViews'])[indexOf(accessor['bufferView'])]);
	if (!isJsonObject(requiredListOf(json['buffers'])[indexOf(bufferView['buffer'])])) {
		unreadable(`accessor ${index} sits in a buffer view whose buffer is no entry of buffers`);
	}
	if (Object.hasOwn(bufferView, 'byteStride')) {
		unreadable(`accessor ${index} sits in a buffer view with a stride`);
	}
	const accessorOffset = offsetOf(accessor['byteOffset']);
	const start = offsetOf(bufferView['byteOffset']) + accessorOffset;
	if (start % ALIGNMENT_BYTES !== 0 || accessorOffset % ALIGNMENT_BYTES !== 0) {
		unreadable(`accessor ${index} starts at a byte, or at an offset into its buffer view, that is not a multiple of ${ALIGNMENT_BYTES}`);
	}
	const byteLength = (count as number) * COMPONENTS_OF_TYPE[type] * BYTES_PER_COMPONENT;
	if (accessorOffset + byteLength > indexOf(bufferView['byteLength']) || start + byteLength > binary.length) {
		refusals.push({ code: 'clip_keys_invalid', detail: `accessor ${index} reaches past its buffer view or the binary chunk` });
		return undefined;
	}
	return { count: count as number, start };
}

/** Why the profile does not take an accessor glTF allows, or undefined when it does. */
function shapeNotAllowed(accessor: JsonObject): string | undefined {
	if (accessor['sparse'] !== undefined) {
		return 'is sparse';
	}
	if (accessor['bufferView'] === undefined) {
		return 'has no buffer view';
	}
	return accessor['componentType'] === FLOAT ? undefined : 'holds rotations that are not float';
}

/** A byte offset the file may leave out. */
function offsetOf(value: unknown): number {
	return value === undefined ? 0 : indexOf(value);
}

function floatsAt(view: DataView, located: Located, componentsPerElement: number): number[] {
	return Array.from({ length: located.count * componentsPerElement }, (_, index) =>
		view.getFloat32(located.start + index * BYTES_PER_COMPONENT, true)
	);
}

function timesAreValid(seconds: readonly number[]): boolean {
	return seconds.every((second, index) => Number.isFinite(second) && second >= 0 && (index === 0 || second > (seconds[index - 1] as number)));
}

/** Every number is finite and every key's value (a cubic spline's middle one) is of unit length within the profile's tolerance. */
function rotationsAreValid(floats: readonly number[], isCubic: boolean): boolean {
	const valuesPerKey = isCubic ? CUBIC_KEY_VALUES : 1;
	const stride = valuesPerKey * ROTATION_COMPONENTS;
	const valueOffset = isCubic ? ROTATION_COMPONENTS : 0;
	if (!floats.every(Number.isFinite)) {
		return false;
	}
	for (let keyStart = 0; keyStart < floats.length; keyStart += stride) {
		const length = Math.hypot(...floats.slice(keyStart + valueOffset, keyStart + valueOffset + ROTATION_COMPONENTS));
		if (Math.abs(length - 1) > clipProfile.rotationLengthTolerance) {
			return false;
		}
	}
	return true;
}
