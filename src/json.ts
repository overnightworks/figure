import type { Refusal } from './codes.js';

export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A part of the JSON a rule must read that does not have glTF's shape. */
class Unreadable extends Error {}

export function unreadable(message: string): never {
	throw new Unreadable(message);
}

/** Runs `read`; a part it finds unreadable becomes a `gltf_invalid` refusal in `invalid`, naming `place`. */
export function attemptRead(invalid: Refusal[], place: string, read: () => void): void {
	try {
		read();
	} catch (error_) {
		// The readers here throw nothing but Unreadable.
		invalid.push({ code: 'gltf_invalid', detail: `${place}: ${(error_ as Unreadable).message}` });
	}
}

export function objectOf(value: unknown): JsonObject {
	if (!isJsonObject(value)) {
		return unreadable('a value that must be an object is not');
	}
	return value;
}

export function requiredListOf(value: unknown): unknown[] {
	if (!Array.isArray(value)) {
		return unreadable('a value that must be a list is not');
	}
	return value;
}

/** A list the file may leave out. */
export function listOf(value: unknown): unknown[] {
	return value === undefined ? [] : requiredListOf(value);
}

export function indexOf(value: unknown): number {
	if (!Number.isInteger(value) || (value as number) < 0) {
		return unreadable('an index is not a non-negative integer');
	}
	return value as number;
}
