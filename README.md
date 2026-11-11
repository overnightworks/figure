# figure

The fleet's VRM 1.0 profile as a check: the framework-free TypeScript ESM package `overnightworks-figure`.

Today figure ships two things: the check, `figure check <file>` and `checkFigure(bytes)`, which tell whether a figure
file meets the profile's container, VRM and budget rules; and the drawing, `mount` from `overnightworks-figure/draw`,
which draws a figure that passes into an app's canvas and keeps it alive with its idle motion until the app disposes it.
Why figure exists and what it is not: [docs/VISION.md](docs/VISION.md). Its parts: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

Needs Node 24 or 26 and pnpm (the versions `package.json` pins).

```sh
pnpm install --frozen-lockfile
pnpm run build
node dist/bin.js check path/to/figure.vrm
```

In an app or a release check, `checkFigure(bytes)` from the package root returns the list of refusals for a file's
bytes; it runs in a browser and in Node.

## Mount a figure

An app that shows a figure hands `mount` a canvas and the file's bytes. It shows its own symbol until the figure says
`drawn`, and again for every signal that ends the figure:

```ts
import { checkFigure } from 'overnightworks-figure';
import { mount, type FigureHandle, type FigureSignal } from 'overnightworks-figure/draw';

export async function showFigure(canvas: HTMLCanvasElement, figureUrl: string, showSymbol: (shown: boolean) => void): Promise<FigureHandle> {
	showSymbol(true);
	const bytes = new Uint8Array(await (await fetch(figureUrl)).arrayBuffer());
	// Optional: `mount` runs the same check and answers `refused`; calling it first names the rules a file breaks.
	console.log(checkFigure(bytes).map((refusal) => refusal.code));
	return mount(canvas, bytes, { onSignal: (signal: FigureSignal) => showSymbol(signal !== 'drawn') });
}
```

The app calls `handle.dispose()` when it is done with the figure; a second call does nothing. `handle.signal` is the last
signal given. `mount` never rejects, and the first signal has reached `onSignal` before it resolves.

| Signal | Means | The app |
|---|---|---|
| `drawn` | the first frame is on the canvas | hides its symbol |
| `unsupported` | the canvas gives no WebGL 2 context | shows its symbol |
| `refused` | the check refused the bytes, or loading or drawing failed | shows its symbol |
| `lost` | the canvas's WebGL context was lost, while the figure loaded or after it was drawn | shows its symbol |
| `slow` | the median of the last 40 frame intervals is over 55 ms, so the figure is too heavy for this device | shows its symbol |

`unsupported`, `refused`, `lost` and `slow` end the figure for good: nothing is drawn after them and the package does
not restore. An app that wants the figure again mounts it on a fresh canvas, because a canvas whose context was lost or
freed cannot give another.

**The app owns** the canvas and its CSS size, the fetch of the bytes, its symbol and `dispose`. **The package does** the
rest: it sizes the drawing buffer to the canvas's client size times the device pixel ratio (at most 2) in every frame,
so a resized canvas is followed with no call; it gives the figure its idle motion (breathing, blinking, glancing); while
the page asks for reduced motion it only blinks, slower; and it draws only while the page is visible and the canvas is
in the viewport. It never writes the canvas's `style` and adds no element to the page.

The page may run under a strict script policy. The package's browser tests run it under
`default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' blob:; worker-src 'self'`: no inline script,
no `eval`, no network beyond the app's own origin; under it the app sizes its canvas through `canvas.style` from script, since inline styles and stylesheets are blocked. Textures are read through `<img>` elements on `blob:` URLs, so
`img-src` needs `blob:`; a figure that names a file outside its own bytes is `refused`, never fetched.

## Install

A consumer pins a release's tarball by URL. Every release is on the repository's
[releases page](https://github.com/overnightworks/figure/releases), immutable, and holds one tarball:

```
https://github.com/overnightworks/figure/releases/download/v<version>/overnightworks-figure-<version>.tgz
```

```sh
pnpm add https://github.com/overnightworks/figure/releases/download/v0.2.0/overnightworks-figure-0.2.0.tgz
```

pnpm writes the tarball's `sha512-` integrity into `pnpm-lock.yaml` when it downloads the tarball. The value to compare stands
at the top of the release's notes, below it the gzip size of a bundle that only checks and of one that also mounts.
npm takes the same URL and records the same integrity.

Release 0.2.0 brings `three` and `@pixiv/three-vrm` as dependencies, so the lockfile gains them with their own
dependencies. Only `overnightworks-figure/draw` imports them: a consumer that only checks (the package root,
`overnightworks-figure/codes`, `overnightworks-figure/profile` or the command) loads nothing of three.

Then `pnpm exec figure check path/to/figure.vrm`, or `import { checkFigure } from 'overnightworks-figure'` in code.

## Exit codes

| Exit | Meaning | Output |
|---|---|---|
| 0 | the file passes every rule | one line on stdout |
| 1 | the file is refused | one line per refusal on stdout, starting with its code |
| 2 | no verdict: no file named, a file that cannot be read, an unknown command | the reason on stderr |

The codes and the exit codes are the contract; the wording of a line is not.

## Refusal codes

| Code | Refused when |
|---|---|
| `not_glb` | the file is shorter than GLB's 12-byte header, or does not start with GLB's magic |
| `too_large` | the file is over the profile's file budget |
| `glb_version` | the GLB header's version field is not 2 |
| `glb_length` | the GLB header's length field differs from the file's length |
| `glb_chunk` | a chunk's header or content reaches past the end of the file, or the first chunk is not the JSON chunk |
| `glb_json` | the JSON chunk's content is not a JSON object |
| `extension_not_allowed` | `extensionsUsed` or `extensionsRequired` names an extension outside the profile's allowed list |
| `uri_not_allowed` | a buffer or an image names a `uri`, external or data; every byte sits in the GLB itself |
| `buffer_outside_glb` | `buffers` holds more than one entry, or a buffer view's `buffer` is not 0; every byte sits in the GLB's binary chunk |
| `not_vrm` | there is no `extensions.VRMC_vrm` object, or its `specVersion` is not `1.0`; the other VRM rules then stay silent |
| `preset_missing` | `expressions.preset` lacks one of the profile's presets; one refusal per missing preset, naming it |
| `humanoid_bone_missing` | `humanoid.humanBones` lacks a bone VRM 1.0 requires, or its entry is not an object with a `node`; one refusal per bone, naming it |
| `look_at_missing` | `VRMC_vrm.lookAt` is not an object |
| `licence_redistribution` | `meta.allowRedistribution` is not `true` |
| `licence_avatar_permission` | `meta.avatarPermission` is not `everyone` |
| `licence_credit` | `meta.creditNotation` is not `unnecessary` |
| `too_many_triangles` | the meshes hold more triangles together than the profile's budget (each mesh counted once) |
| `too_many_morph_targets` | a primitive has more morph targets than the profile's budget |
| `texture_too_large` | an embedded image is wider or taller than the profile's side budget; one refusal per image, naming it |
| `too_many_texels` | the embedded images' widths times heights, added up (each image once), are over the profile's texel budget |
| `image_invalid` | an embedded image's bytes reach past the binary chunk, or are not a PNG, JPEG or WebP (lossy, lossless or extended) whose header the check can size (zero sides included) |
| `gltf_invalid` | a mesh, primitive, accessor, index, image or buffer view a rule must read does not have glTF's shape, so it cannot judge |

A refusal may also carry a text naming what it found (the extension, the place of the URI); the command prints it
after the code. The profile's values (allowed extensions, file budget, presets, licence values, triangle, morph-target, texture-side and texel budgets) live in `src/profile.ts` and are exported as
`overnightworks-figure/profile`.

The closed set lives in `src/codes.ts` and is exported as `overnightworks-figure/codes`.

## Develop

`pnpm run check` type-checks, `pnpm exec vitest run --coverage` runs the tests (build first), and `quality check`
runs the shared static check. [AGENTS.md](AGENTS.md) lists the commands and rules for agents.
