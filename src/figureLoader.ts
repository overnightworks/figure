import { FileLoader, Texture, TextureLoader, type LoadingManager } from 'three';
import { GLTFLoader, type GLTFLoaderPlugin, type GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import { VRMExpressionOverrideType, VRMLoaderPlugin, VRMMetaLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { figureMood } from './expressions.js';

/** A texture loader that reads an image through an `<img>` element, which the script policy allows, and tells when an image fails. */
class ImageElementTextureLoader extends TextureLoader {
	constructor(
		manager: LoadingManager,
		private readonly onFailure: () => void
	) {
		super(manager);
	}

	/** GLTFLoader always passes its rejection as `onError`. */
	override load(
		url: string,
		onLoad: (texture: ReturnType<TextureLoader['load']>) => void,
		onProgress: undefined,
		onError: (error: unknown) => void
	) {
		if (!url.startsWith('blob:')) {
			this.onFailure();
			onError(new Error('a figure file may only read an image from its own bytes'));
			return new Texture<HTMLImageElement>();
		}
		return super.load(url, onLoad, onProgress, (error) => {
			// three revokes the object URL it made only when the image loads.
			URL.revokeObjectURL(url);
			this.onFailure();
			onError(error);
		});
	}
}

/** Gives the parser the `<img>` texture loader; three's default fetches a `blob:` URL, which the script policy refuses. */
class ImageElementTexturesPlugin implements GLTFLoaderPlugin {
	readonly name = 'figure_image_element_textures';

	constructor(parser: GLTFParser, onTextureFailure: () => void) {
		parser.textureLoader = new ImageElementTextureLoader(parser.options.manager, onTextureFailure);
	}
}

/** A file loader that always fails; three reads a buffer outside the GLB with a request, which nothing in a figure file may cause. */
class RefusingFileLoader extends FileLoader {
	override load(_url: string, _onLoad: unknown, _onProgress: unknown, onError: (error: unknown) => void): void {
		onError(new Error('a figure file may not read a file'));
	}
}

/** Gives the parser the refusing file loader, so a buffer outside the GLB fails the load whatever the check said. */
class NoFileReadsPlugin implements GLTFLoaderPlugin {
	readonly name = 'figure_no_file_reads';

	constructor(parser: GLTFParser) {
		parser.fileLoader = new RefusingFileLoader(parser.options.manager);
	}
}

/** The check holds the licence to the profile, so the loader accepts the licence URL the file names instead of three-vrm's one default. */
function loaderPluginFor(parser: GLTFParser): VRMLoaderPlugin {
	const acceptLicenseUrls = [parser.json.extensions.VRMC_vrm.meta.licenseUrl];
	return new VRMLoaderPlugin(parser, { metaPlugin: new VRMMetaLoaderPlugin(parser, { acceptLicenseUrls }) });
}

/** A mood never silences the mouth, whatever its author wrote: the five moods' `overrideMouth` is none, while their blink and look-at overrides stay. */
function letMoodsKeepTheMouth(vrm: VRM): void {
	// The check holds the five mood presets, so each expression exists.
	for (const mood of Object.values(figureMood)) vrm.expressionManager!.getExpression(mood)!.overrideMouth = VRMExpressionOverrideType.None;
}

/** Parses the bytes into a VRM, its moods letting the mouth move; rejects when the loader refuses them or any texture fails, which three itself swallows. */
export async function loadFigure(bytes: Uint8Array): Promise<VRM> {
	let textureFailed = false;
	const loader = new GLTFLoader();
	loader.register((parser) => new ImageElementTexturesPlugin(parser, () => (textureFailed = true)));
	loader.register((parser) => new NoFileReadsPlugin(parser));
	loader.register(loaderPluginFor);
	const gltf = await loader.parseAsync(bytes.slice().buffer, '');
	const vrm = gltf.userData.vrm as VRM;
	if (textureFailed) {
		VRMUtils.deepDispose(vrm.scene);
		throw new Error('a texture failed to load');
	}
	letMoodsKeepTheMouth(vrm);
	return vrm;
}
