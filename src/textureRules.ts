import type { Refusal } from './codes.js';
import { attemptRead, indexOf, listOf, objectOf, requiredListOf, unreadable, type JsonObject } from './json.js';
import { imageSize } from './imageSize.js';
import type { ImageSize } from './pngHeader.js';

/** The texture budgets a kind of file sets: the longest side of an image and the texels of all images together. */
export interface TextureBudgets {
	readonly maxTextureSidePixels: number;
	readonly maxTexels: number;
}

/**
 * Judges the texture budgets from each embedded image's header alone (glTF 2.0, sections 3.8 and 3.6.1.2): the images
 * sit in the binary chunk, and a PNG, JPEG or WebP header can be sized. An image with a `uri` is left to `uri_not_allowed`.
 */
export function textureRefusals(json: JsonObject, binaryChunk: Uint8Array | undefined, budgets: TextureBudgets): Refusal[] {
	const tooLarge: Refusal[] = [];
	const invalidImages: Refusal[] = [];
	const invalidJson: Refusal[] = [];
	let texels = 0;
	attemptRead(invalidJson, 'images', () => {
		for (const [index, image] of listOf(json['images']).entries()) {
			const place = `images[${index}]`;
			attemptRead(invalidJson, place, () => {
				const range = imageRange(json, objectOf(image));
				if (range === undefined) {
					return;
				}
				const size = rangeSize(binaryChunk, range);
				if (size === undefined) {
					invalidImages.push({ code: 'image_invalid', detail: `${place} is not a PNG, JPEG or WebP image whose header states a size within the binary chunk` });
					return;
				}
				texels += size.width * size.height;
				if (size.width > budgets.maxTextureSidePixels || size.height > budgets.maxTextureSidePixels) {
					tooLarge.push({ code: 'texture_too_large', detail: `${place} is ${size.width} by ${size.height} px` });
				}
			});
		}
	});
	const overTexels: Refusal[] =
		texels > budgets.maxTexels ? [{ code: 'too_many_texels', detail: `${texels} texels` }] : [];
	return [...tooLarge, ...overTexels, ...invalidImages, ...invalidJson];
}

interface ByteRange {
	readonly offset: number;
	readonly length: number;
}

/** The range of the binary chunk an image names through its buffer view; undefined for an image with a `uri`. */
function imageRange(json: JsonObject, image: JsonObject): ByteRange | undefined {
	if (Object.hasOwn(image, 'uri')) {
		return undefined;
	}
	const viewIndex = indexOf(image['bufferView']);
	const bufferViews = requiredListOf(json['bufferViews']);
	if (viewIndex >= bufferViews.length) {
		return unreadable(`buffer view ${viewIndex} does not exist`);
	}
	const bufferView = objectOf(bufferViews[viewIndex]);
	if (bufferView['buffer'] !== 0) {
		return unreadable(`buffer view ${viewIndex} is not in buffer 0`);
	}
	return {
		offset: bufferView['byteOffset'] === undefined ? 0 : indexOf(bufferView['byteOffset']),
		length: indexOf(bufferView['byteLength'])
	};
}

/** The size of the image in the range; undefined when the range reaches past the chunk or holds no header that can be sized. */
function rangeSize(binaryChunk: Uint8Array | undefined, range: ByteRange): ImageSize | undefined {
	if (binaryChunk === undefined || range.offset > binaryChunk.length || range.length > binaryChunk.length - range.offset) {
		return undefined;
	}
	return imageSize(binaryChunk.subarray(range.offset, range.offset + range.length));
}
