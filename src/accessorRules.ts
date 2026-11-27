import { isJsonObject, unreadable, type JsonObject } from './json.js';

/** The component types glTF 2.0 defines, as the integers it requires. The loader also reads a number as text such as "5126", but that is no glTF value and is refused with the rest. */
export const componentType = {
	byte: 5120,
	unsignedByte: 5121,
	short: 5122,
	unsignedShort: 5123,
	unsignedInt: 5125,
	float: 5126
} as const;
const COMPONENT_TYPES: ReadonlySet<unknown> = new Set(Object.values(componentType));

/**
 * Unreadable when an accessor that `primitive` names as its `indices` or one of its attributes, and that exists, has no glTF component type:
 * the loader reads such an accessor through the typed array of its component type, and throws when the component type is absent or is no key of its table.
 * An accessor that is not there, and an index that is none, are for the rule that owns the reference; an accessor no primitive names is never read.
 */
export function mustNameAccessorsOfGltfComponentType(json: JsonObject, primitive: JsonObject): void {
	const attributes = isJsonObject(primitive['attributes']) ? Object.values(primitive['attributes']) : [];
	const accessors: unknown = json['accessors'];
	for (const index of [primitive['indices'], ...attributes]) {
		const accessor = Array.isArray(accessors) && Number.isInteger(index) ? (accessors[index as number] as unknown) : undefined;
		if (isJsonObject(accessor) && !COMPONENT_TYPES.has(accessor['componentType'])) {
			unreadable("names an accessor whose componentType is none of glTF's");
		}
	}
}
