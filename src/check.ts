import { budgetRefusals, roomBudgetRefusals } from './budgetRules.js';
import { clipRefusals } from './clipRules.js';
import { textureRefusals } from './textureRules.js';
import type { Refusal } from './codes.js';
import { type JsonObject, isJsonObject } from './json.js';
import { clipProfile, figureProfile, roomProfile } from './profile.js';
import { roomRefusals } from './roomRules.js';
import { vrmRefusals } from './vrmRules.js';

const GLB_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const GLB_MAGIC = [0x67, 0x6c, 0x54, 0x46];
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BINARY_CHUNK_TYPE = 0x004e4942;

interface Chunk {
	readonly type: number;
	readonly content: Uint8Array;
}

/** What the container step needs of a profile: the file budget and the extensions the file may name. */
interface ContainerProfile {
	readonly fileBudgetBytes: number;
	readonly allowedExtensions: readonly string[];
}

/** Judges a figure file from its raw bytes; the file is untrusted input and nothing in it runs. */
export function checkFigure(bytes: Uint8Array): Refusal[] {
	return checkContainer(bytes, figureProfile, (json, binaryChunk) => [
		...vrmRefusals(json),
		...budgetRefusals(json),
		...textureRefusals(json, binaryChunk, figureProfile)
	]);
}

/** Judges a clip file (a `.vrma`) from its raw bytes against the clip profile; the file is untrusted input and nothing in it runs. */
export function checkClip(bytes: Uint8Array): Refusal[] {
	return checkContainer(bytes, clipProfile, clipRefusals);
}

/** Judges a room file (a static GLB of unlit materials) from its raw bytes against the room profile; the file is untrusted input and nothing in it runs. */
export function checkRoom(bytes: Uint8Array): Refusal[] {
	return checkContainer(bytes, roomProfile, (json, binaryChunk) => [
		...roomRefusals(json),
		...roomBudgetRefusals(json),
		...textureRefusals(json, binaryChunk, roomProfile)
	]);
}

/** The GLB container rules against `profile`, then the rules of the file's kind, which read the JSON and the binary chunk. */
function checkContainer(
	bytes: Uint8Array,
	profile: ContainerProfile,
	kindRefusals: (json: JsonObject, binaryChunk: Uint8Array | undefined) => Refusal[]
): Refusal[] {
	const refusals: Refusal[] = [];
	if (bytes.length > profile.fileBudgetBytes) {
		refusals.push({ code: 'too_large' });
	}
	const hasGlbHeader =
		bytes.length >= GLB_HEADER_BYTES && GLB_MAGIC.every((magicByte, index) => bytes[index] === magicByte);
	if (!hasGlbHeader) {
		return [...refusals, { code: 'not_glb' }];
	}
	const header = new DataView(bytes.buffer, bytes.byteOffset, GLB_HEADER_BYTES);
	if (header.getUint32(4, true) !== GLB_VERSION) {
		refusals.push({ code: 'glb_version' });
	}
	if (header.getUint32(8, true) !== bytes.length) {
		refusals.push({ code: 'glb_length' });
	}
	const chunks = readChunks(bytes);
	if (chunks?.[0]?.type !== JSON_CHUNK_TYPE) {
		return [...refusals, { code: 'glb_chunk' }];
	}
	const json = parseJsonObject(chunks[0].content);
	if (json === undefined) {
		return [...refusals, { code: 'glb_json' }];
	}
	const binaryChunk = chunks[1]?.type === BINARY_CHUNK_TYPE ? chunks[1].content : undefined;
	return [
		...refusals,
		...extensionRefusals(json, profile),
		...uriRefusals(json),
		...bufferRefusals(json),
		...kindRefusals(json, binaryChunk)
	];
}

/** Walks the chunks against the bytes that are there; undefined when one reaches past the end. */
function readChunks(bytes: Uint8Array): Chunk[] | undefined {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
	const chunks: Chunk[] = [];
	let offset = GLB_HEADER_BYTES;
	while (offset < bytes.length) {
		if (bytes.length - offset < CHUNK_HEADER_BYTES) {
			return undefined;
		}
		const contentStart = offset + CHUNK_HEADER_BYTES;
		const contentLength = view.getUint32(offset, true);
		if (contentLength > bytes.length - contentStart) {
			return undefined;
		}
		chunks.push({
			type: view.getUint32(offset + 4, true),
			content: bytes.subarray(contentStart, contentStart + contentLength)
		});
		offset = contentStart + contentLength;
	}
	return chunks;
}

function parseJsonObject(content: Uint8Array): JsonObject | undefined {
	try {
		const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content));
		return isJsonObject(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function namesIn(value: unknown): unknown[] {
	if (value === undefined) {
		return [];
	}
	return Array.isArray(value) ? value : [value];
}

function extensionRefusals(json: JsonObject, profile: ContainerProfile): Refusal[] {
	const refusals: Refusal[] = [];
	for (const key of ['extensionsUsed', 'extensionsRequired']) {
		for (const name of namesIn(json[key])) {
			if (!(profile.allowedExtensions as readonly unknown[]).includes(name)) {
				refusals.push({ code: 'extension_not_allowed', detail: `${key} names ${JSON.stringify(name)}` });
			}
		}
	}
	return refusals;
}

/** The GLB body is the only buffer a loader can read without a request, so a second buffer, or a view in one, is refused. */
function bufferRefusals(json: JsonObject): Refusal[] {
	const refusals: Refusal[] = [];
	if (Array.isArray(json['buffers']) && json['buffers'].length > 1) {
		refusals.push({ code: 'buffer_outside_glb', detail: `buffers holds ${json['buffers'].length} entries` });
	}
	if (Array.isArray(json['bufferViews'])) {
		json['bufferViews'].forEach((entry: unknown, index) => {
			if (isJsonObject(entry) && entry['buffer'] !== 0) {
				refusals.push({ code: 'buffer_outside_glb', detail: `bufferViews[${index}] is not in buffer 0` });
			}
		});
	}
	return refusals;
}

function uriRefusals(json: JsonObject): Refusal[] {
	const refusals: Refusal[] = [];
	for (const key of ['buffers', 'images']) {
		const entries = json[key];
		if (!Array.isArray(entries)) {
			continue;
		}
		entries.forEach((entry: unknown, index) => {
			if (typeof entry === 'object' && entry !== null && Object.hasOwn(entry, 'uri')) {
				refusals.push({ code: 'uri_not_allowed', detail: `${key}[${index}] names a uri` });
			}
		});
	}
	return refusals;
}
