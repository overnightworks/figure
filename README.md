# figure

The fleet's VRM 1.0 profile as a check: the framework-free TypeScript ESM package `overnightworks-figure`.

Today figure ships two things: the check, `figure check <file>` and `checkFigure(bytes)`, which tell whether a figure
file meets the profile's container, VRM and budget rules, and its siblings for a gesture clip, `figure check --as clip <file>` and
`checkClip(bytes)`, and for a persona's room (one static GLB, unlit materials only), `figure check --as room <file>` and `checkRoom(bytes)`; and the drawing, `mount` from `overnightworks-figure/draw`,
which draws a figure that passes into an app's canvas, rests it with its arms lowered, keeps it alive with its idle motion, shows it thinking or listening when the app reports so,
waves when the app asks (with a persona's own `.vrma` clip in place of figure's wave when the app hands one through `gestures`), and lets it speak with the app's voice, its mouth following the voice, its head nodding with it and its face showing the
mood of the sentence, until the app disposes it.
Why figure exists and what it is not: [docs/VISION.md](docs/VISION.md). Its parts: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

Needs Node 24 or 26 and pnpm (the versions `package.json` pins).

```sh
pnpm install --frozen-lockfile
pnpm run build
node dist/bin.js check path/to/figure.vrm
node dist/bin.js check --as clip path/to/gesture.vrma
node dist/bin.js check --as room path/to/room.glb
```

In an app or a release check, `checkFigure(bytes)` from the package root returns the list of refusals for a file's
bytes; it runs in a browser and in Node. `checkClip(bytes)` does the same for a `.vrma` gesture clip, against the clip profile below,
and `checkRoom(bytes)` for a room, against the room profile below.

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
signal given. `handle.think(working)` tells the figure whether the agent's model is working: the app reports only the fact,
and the figure decides its motion, so it looks up and aside and raises its right hand to its chin while `working` is true, and goes back to its idle motion
with its arm lowered when it is false. The same value again changes nothing, and on a figure that ended or was disposed the call does nothing.
`handle.listen(speaker)` hands the figure the element of the page at which someone speaks, or `null` when nobody does: the figure
turns toward the element's centre, its eyes first and its head a moment later, with a blink when the turn is large, leans in a little,
nods now and then, lets its eyes jump a little and follows the element as it moves, with no further call, unless it is thinking. Anything that is not an element, and an element that is not connected, belongs to another document or has no box (its bounding
rectangle has neither width nor height, as under `display: none`), counts as nobody until it returns; the package only reads the element's bounding rectangle each frame and lets it go on `listen(null)`, on another element, on
`dispose` and when the figure ends.
`handle.speak(sentence)` tells the figure that the agent speaks, with `{ voice, mood }` where `voice` is the audio node that carries the agent's
voice in the app's Web Audio graph (the output of the player) and `mood` is one of `happy`, `angry`, `sad`, `relaxed` and `surprised` (the type
`FigureMood`), and `null` when it stops. While the agent speaks the figure neither thinks nor
listens and its gaze is the idle glance; when it stops, thinking shows before listening. The figure only taps the voice: it makes one analyser
with the voice's own context, connects the voice to it and nothing else, and disconnects that analyser and only it when another voice, `speak({})`,
`speak(null)`, `dispose` or the figure's end releases it; the same node again keeps its tap. It creates no `AudioContext`, plays nothing and
fetches nothing, so the app's sound is its own. No `mood` is the neutral face; a mood shows only while the agent speaks, eased in and out, and
the mouth is a little smaller while it shows, so `speak({ mood })` shows it with a still mouth and `speak(null)` lets it fade. Each call
replaces the sentence: another mood replaces the last, a sentence without one fades it, and the same voice with another mood keeps its tap. A `mood` that is none of the five shows none and
throws nothing. `speak({})` is a speaking figure with a still mouth, what an app calls for a person who muted the
agent. A voice the figure cannot tap speaks with a still mouth and throws nothing: a value that is no audio node, a closed context, a `connect` or
`createAnalyser` that throws; a suspended context reads silence, and the mouth follows once the context runs. A field of the sentence the package
does not know is ignored, and on a figure that ended or was disposed the call does nothing. The mouth has five vowel shapes (`aa`, `ih`, `ou`, `ee`,
`oh`) chosen from the voice's first two formants and opened by its loudness; consonants show only as dips in loudness, and it lags the sound by 30
to 40 ms.
`handle.gesture(name)` asks the figure for one of its own gestures, which the package plays on the figure: the host hands no bytes and nothing is fetched. `name` is a
key of `figureGesture`, exported from the package root `overnightworks-figure` with the type `FigureGesture`; today it is `wave`, a neutral wave of the right arm that eases in and out, with the lower arm and the hand trailing the upper arm.
The call starts the gesture at the next drawn frame, returns nothing, gives no signal and never throws, and the figure's breath, moods, gaze, blink and mouth go on under it; while the figure thinks, the wave lifts the hand from the chin and gives it back.
A persona may play its own motion for a base name: `mount(canvas, bytes, { gestures: { wave: clipBytes } })` takes the bytes of a `.vrma` file for a key of `figureGesture`. After `drawn`, each clip is judged by `checkClip`, the check `figure check --as clip` runs, and only a clip that passes is parsed; `mount` does not wait for it. A gesture started before the clip has parsed plays figure's own clip to its end, and the next one plays the persona's. A clip turns the arms, hands, fingers, shoulders, spine, chest and upper chest it keys, with linear, step or cubic-spline tracks, on figure's own fades and over the base pose; the lower arm, the hand and the fingers trail the upper arm by a small lag that figure adds, so an author writes the pose. Every other track is dropped. A key that is no `FigureGesture`, a clip that is refused or fails to load, and one that finishes parsing after `dispose` are dropped: nothing is signalled and nothing throws. The option is read once, at mount.
One gesture shows at a time and calls never queue: a call for the gesture that plays does nothing, and neither does a value that is no `FigureGesture`, a call made while the page is hidden (it does not play when the page shows again), and a call on a figure that ended or was disposed. Under reduced motion no gesture plays, and one that runs ends at the next frame.
`mount` never rejects, and the first signal has reached `onSignal` before it resolves.

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
so a resized canvas is followed with no call; it poses the figure at rest with its arms lowered at its sides, and gives the figure its idle
motion (breathing, blinking, glancing), its thinking look, its look toward a speaker (the eyes first) and the nods it makes while one speaks, the small jumps of its eyes (smaller while the agent speaks, none while it thinks), and the mouth and the nod of the head that follow the agent's voice and the mood of the sentence; while the page asks for reduced motion it blinks, slower, keeps the arms
down at rest with no idle motion (the hand rises to the chin at once while the figure thinks), takes and leaves those looks and the mouth's shape at once, does not jump its eyes, does not nod and plays no gesture; and it draws only
while the page is visible and the canvas is in the viewport. It never writes the canvas's `style` and adds no element to the page.

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
pnpm add https://github.com/overnightworks/figure/releases/download/v0.6.0/overnightworks-figure-0.6.0.tgz
```

pnpm writes the tarball's `sha512-` integrity into `pnpm-lock.yaml` when it downloads the tarball. The value to compare stands
at the top of the release's notes, below it the gzip size of a bundle that only checks and of one that also mounts.
npm takes the same URL and records the same integrity.

The package brings `three`, `@pixiv/three-vrm` and `@pixiv/three-vrm-animation` as dependencies, so the lockfile gains them with their own
dependencies. Only `overnightworks-figure/draw` imports them: a consumer that only checks (the package root,
`overnightworks-figure/codes`, `overnightworks-figure/profile` or the command) loads nothing of three.

`overnightworks-figure/vocabulary.json` is the one list of the names an agent's figure tools offer, for a consumer that does not run the package's TypeScript (a Python service that generates its enums, say): `{"version": 1, "gestures": [...], "moods": [...]}`, the keys of `figureGesture` and the values of `figureMood` in their declared order. The build writes it from those sets (`dist/figure-vocabulary.json`), so a token added or removed is a figure release; `version` is the file's shape and changes only with the shape. Read it from the installed release tarball through the export, for example `import vocabulary from 'overnightworks-figure/vocabulary.json' with { type: 'json' }`, or at `node_modules/overnightworks-figure/dist/figure-vocabulary.json`.

Then `pnpm exec figure check path/to/figure.vrm`, or `import { checkFigure } from 'overnightworks-figure'` in code; `pnpm exec figure check --as clip path/to/gesture.vrma` and `checkClip` judge a clip, `pnpm exec figure check --as room path/to/room.glb` and `checkRoom` a room.

## Exit codes

| Exit | Meaning | Output |
|---|---|---|
| 0 | the file passes every rule | one line on stdout |
| 1 | the file is refused | one line per refusal on stdout, starting with its code |
| 2 | no verdict: no file named, a file that cannot be read, an unknown command, an `--as` that is neither `clip` nor `room` | the reason, or the usage line `usage: figure check [--as clip\|room] <file>`, on stderr |

`--as` sits between `check` and the file and its value is `clip` or `room`; without it the file is a figure. The codes and the exit codes are the contract; the wording of a line is not.

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
| `too_many_triangles` | the drawn meshes hold more triangles together than the profile's budget (a figure counts each mesh once, a room each node that draws a mesh) |
| `too_many_morph_targets` | a primitive has more morph targets than the profile's budget |
| `texture_too_large` | an embedded image is wider or taller than the profile's side budget; one refusal per image, naming it |
| `too_many_texels` | the embedded images' widths times heights, added up (each image once), are over the profile's texel budget |
| `image_invalid` | an embedded image's bytes reach past the binary chunk, or are not a PNG, JPEG or WebP (lossy, lossless or extended) whose header the check can size (zero sides included) |
| `not_vrm_animation` | a clip has no `extensions.VRMC_vrm_animation` object, or its `specVersion` is not `1.0` |
| `clip_content_not_allowed` | a clip holds `meshes`, `skins`, `materials`, `textures`, `images`, `samplers` or `cameras`, or a node holds a `mesh`, `camera` or `skin`; one refusal per property, naming it |
| `clip_scene_missing` | a clip's `scenes` is absent or empty |
| `clip_animation_missing` | a clip has no animation |
| `clip_track_not_allowed` | a channel has no target node, animates `weights`, or takes a path its node does not (a humanoid bone takes rotation, the hips also translation, an expression node translation, the look-at node rotation); or its key data is sparse, has no buffer view, or holds rotations that are not float |
| `clip_keys_invalid` | a channel's keys reach past their buffer view or the binary chunk, its times are not finite, 0 or later and strictly ascending, or a rotation is not finite or not of unit length within the profile's tolerance |
| `clip_too_long` | a clip's first animation has a key later than the profile's seconds budget |
| `room_content_not_allowed` | a room holds `skins`, `animations` or `cameras`, a node with a `skin` or a `camera`, a primitive with `targets` or a mesh with `weights`; one refusal per property, naming it |
| `room_scene_missing` | a room's `scenes` is absent or empty |
| `room_material_not_unlit` | a room's material has no `KHR_materials_unlit` object, or a primitive names no material (the default material is lit) |
| `too_many_primitives` | the nodes of a room draw more primitives together than the profile's budget, each primitive being one draw call |
| `gltf_invalid` | a mesh, primitive, accessor, index, image, buffer view, buffer, scene, sampler, channel or node a rule must read does not have glTF's shape, so it cannot judge |

The container codes (`not_glb` to `buffer_outside_glb`, `too_large`), `humanoid_bone_missing` and `gltf_invalid` apply to a figure
and to a clip, the container, texture, `too_many_triangles` and `gltf_invalid` codes also to a room; the seven clip codes to a clip alone; the four
room codes to a room alone; the other VRM, budget and texture codes to a figure alone.

### The clip profile

A clip is a `.vrma` file: a GLB of `VRMC_vrm_animation` 1.0 with a humanoid of the 15 required bones, a scene, at least one animation
and nothing else, no mesh or image. It accepts LINEAR, STEP and CUBICSPLINE tracks and several animations (the first plays), and
channels on other nodes, which are never played. It is narrower than the specification in two places: the humanoid is required, and
key data is float and not sparse. The profile's values (extension, version, file budget, seconds budget, rotation length tolerance)
live in `src/profile.ts` as `clipProfile`; the budgets stand on a measurement in headless Chromium (`scripts/measure_budget_figure.mjs`). A track for
the head, neck, eyes, jaw, legs, expressions, look-at or hips passes the check and is dropped when a clip plays.

### The room profile

A room is one static GLB that a persona's figure stands in: the check's third kind, `--as room`. It holds a scene and meshes under nodes, and no skin,
animation, camera, morph target or mesh weights. Every material carries `KHR_materials_unlit` and every primitive names a material: the room
carries its own light, painted into its vertex colours and textures, so it looks the same on every device and nothing lights it. The
extensions it may use are `KHR_materials_unlit`, `KHR_texture_transform` and `EXT_texture_webp`; every byte sits in the GLB, as for a figure. A
node under the root may draw a mesh, and a mesh may be drawn by many nodes. The budgets are provisional until a room is drawn on a phone:
4 MiB, 20 000 triangles, 32 primitives (draw calls), 4 000 000 texels and 2048 px a side, the triangles and primitives counted for each node that draws
a mesh, reached from the scene or not. The loader's own throws are refused as `gltf_invalid`: a scene or node shape it cannot walk, a node's mesh, a primitive's material, indices or
attribute, a base colour texture, a texture's image or WebP image that names no entry, an unlit material that `extensionsUsed` does not name, and a Draco object it does not name. An unlit material draws only its base colour
texture, so a room's other textures are not followed.

A room follows a convention that the check does not judge: metres, +Y up, the floor at y = 0, the figure at the origin facing +Z, and the
side toward the camera open or back-face culled. A room that breaks it shows wrongly on the stage and in a persona's review and corrupts nothing.

A refusal may also carry a text naming what it found (the extension, the place of the URI); the command prints it
after the code. The profile's values (allowed extensions, file budget, presets, licence values, triangle, morph-target, primitive, texture-side and texel budgets) live in `src/profile.ts` as `figureProfile`, `clipProfile` and `roomProfile` and are exported as
`overnightworks-figure/profile`.

The closed set lives in `src/codes.ts` and is exported as `overnightworks-figure/codes`.

## Develop

`pnpm run check` type-checks, `pnpm exec vitest run --coverage` runs the tests (build first), and `quality check` runs
the shared static check. `pnpm run stage` serves a demo page on localhost, where a figure mounts at 390 and 1280 px, waves on a button and plays a clip picked from a file for the wave.
[AGENTS.md](AGENTS.md) lists the commands and rules for agents.
