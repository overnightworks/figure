import { jpegSize } from './jpegHeader.js';
import { pngSize, type ImageSize } from './pngHeader.js';
import { webpSize } from './webpHeader.js';

/**
 * The stated size of an image of any type the check can size, found by the image's own first bytes and never by a
 * declared MIME type; undefined for any other bytes. Each reader refuses bytes that are not its type.
 */
export function imageSize(bytes: Uint8Array): ImageSize | undefined {
	return pngSize(bytes) ?? jpegSize(bytes) ?? webpSize(bytes);
}
