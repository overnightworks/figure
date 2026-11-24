# figure

The fleet's VRM 1.0 profile as a check: the framework-free TypeScript ESM package `overnightworks-figure`.

figure ships three things. The check, `figure check <file>` and `checkFigure(bytes)`, tells whether a figure file meets the
profile's container, VRM and budget rules; its siblings judge a gesture clip (`--as clip`, `checkClip`) and a persona's room,
one static GLB of unlit materials (`--as room`, `checkRoom`). The drawing, `mount` from `overnightworks-figure/draw`, draws a
figure that passes into an app's canvas and lets the app drive it: idle motion, thinking, listening, waving and speaking, and the agent's own room behind it.
`overnightworks-figure/vocabulary.json` lists the gesture, framing and mood names for a consumer that does not run TypeScript.
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

In an app or a release check, `checkFigure(bytes)` from the package root returns the list of refusals for a file's bytes;
it runs in a browser and in Node. `checkClip(bytes)` and `checkRoom(bytes)` do the same for a clip and a room.

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

`mount` never rejects, and the first signal has reached `onSignal` before it resolves. The returned `FigureHandle` has
`signal`, `dispose()`, `think(working)`, `listen(speaker)`, `speak(sentence)`, `gesture(name)`, `frame(name)` and `room(bytes)`; the app reports facts
and the figure decides its motion. A sentence's mouth follows the loudness of its voice, or, where the app also passes the sounds the speech service timed for
the answer and the player's played position (`speak({ voice, sounds })`), the sound itself: the lips close on m, b and p, and the voice's own mouth goes on wherever no known sound covers the moment. Each method's behaviour, including its edge cases, is the doc comment of
`FigureHandle` in `src/mountOptions.ts`, which ships in the package's types, as does `MountOptions`, whose `gestures`
option takes a persona's own `.vrma` clip for a key of `figureGesture` (`wave` today). The gesture names are the keys of
`figureGesture`, exported from the package root; the `framing` option and `frame(name)` take a key of `figureFraming`
(`face`, `shoulders`, `upperBody`, `fullBody`; `shoulders` is the default), which the figure eases to during a call and cuts to under
reduced motion; the `room` option and `room(bytes)` take a room's bytes, or null to remove it (see below); the moods are the `FigureMood` type from `overnightworks-figure/draw` and the `moods` of `vocabulary.json`.

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
poses and animates the figure, honours the page's reduced-motion setting, and draws only while the page is visible and the
canvas is in the viewport. It never writes the canvas's `style` and adds no element to the page.

The page may run under a strict script policy (no inline script, no `eval`, no network beyond its own origin); under it
the app sizes its canvas through `canvas.style` from script, and `img-src` needs `blob:`. The exact policy the package is
tested under and why it holds are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Install

A consumer pins a release's tarball by URL. Every release is on the repository's
[releases page](https://github.com/overnightworks/figure/releases), immutable, and holds one tarball:

```
https://github.com/overnightworks/figure/releases/download/v<version>/overnightworks-figure-<version>.tgz
```

```sh
pnpm add https://github.com/overnightworks/figure/releases/download/v0.11.0/overnightworks-figure-0.11.0.tgz
```

pnpm writes the tarball's `sha512-` integrity into `pnpm-lock.yaml` when it downloads the tarball. The value to compare
stands at the top of the release's notes, below it the gzip size of a bundle that only checks and of one that also mounts.
npm takes the same URL and records the same integrity.

The package brings `three`, `@pixiv/three-vrm` and `@pixiv/three-vrm-animation` as dependencies. Only
`overnightworks-figure/draw` imports them: a consumer that only checks (the package root, `overnightworks-figure/codes`,
`overnightworks-figure/profile` or the command) loads nothing of three.

`overnightworks-figure/vocabulary.json` is `{"version": 1, "gestures": [...], "framings": [...], "moods": [...]}`, the keys of `figureGesture`
and `figureFraming` and the values of `figureMood` in their declared order; the build writes it from those sets. `version` rises only on a
breaking change, a new key is additive, so read the keys you know and ignore the others. Import it with
`import vocabulary from 'overnightworks-figure/vocabulary.json' with { type: 'json' }`.

## Exit codes

| Exit | Meaning | Output |
|---|---|---|
| 0 | the file passes every rule | one line on stdout |
| 1 | the file is refused | one line per refusal on stdout, starting with its code |
| 2 | no verdict: no file named, a file that cannot be read, an unknown command, an `--as` that is neither `clip` nor `room` | the reason, or the usage line `usage: figure check [--as clip\|room] <file>`, on stderr |

`--as` sits between `check` and the file and its value is `clip` or `room`; without it the file is a figure. The codes and
the exit codes are the contract; the wording of a line is not.

## Refusal codes and profiles

The closed set of refusal codes, each with its description, is `refusalDescriptions` in `src/codes.ts`, exported as
`overnightworks-figure/codes`. A refusal may also carry a text naming what it found, which the command prints after the
code. The profile's values (allowed extensions, budgets, presets, licence values) are `figureProfile`, `clipProfile` and
`roomProfile` in `src/profile.ts`, exported as `overnightworks-figure/profile`; the budgets stand on a measurement in
headless Chromium (`scripts/measure_budget_figure.mjs`).

- A clip is a `.vrma` file: a GLB of `VRMC_vrm_animation` 1.0 with a humanoid of the 15 required bones, a scene, at least
  one animation and no mesh or image. Tracks are float and not sparse; the first animation plays. A track for the head,
  neck, eyes, jaw, legs, expressions, look-at or hips passes the check and is dropped when a clip plays.
- A room is one static GLB with a scene and meshes under nodes, and no skin, animation, camera or morph target. Every
  material carries `KHR_materials_unlit` and every primitive names a material, because the room carries its own light.
  Its budgets are provisional until a room is drawn on a phone.
- A room follows a convention the check does not judge: metres, +Y up, the floor at y = 0, the figure at the origin facing
  +Z, and the side toward the camera open or back-face culled. A room that breaks it shows wrongly and corrupts nothing.
  The camera stands in front of the figure and sees 20 m at most, so nothing of a room deeper than that shows.
- A room is drawn behind the figure in all four framings and does not change them. `mount` does not wait for it: the
  figure is `drawn` first, and the room is judged by `checkRoom`, parsed and shown in the frame after. `room(bytes)` replaces
  it during a call, as a cut once the new one has parsed, and `room(null)` removes it. A room that is refused or fails to load
  leaves the transparent canvas and gives no signal; the last call wins. A room is static and stays under reduced motion.

## Develop

`pnpm run check` type-checks, `pnpm exec vitest run <file>` runs one test file (build first), and `quality check` runs the
shared static check. `pnpm run stage` serves a demo page on localhost, where a figure mounts at 390 and 1280 px, waves on
a button, plays a clip picked from a file for the wave and shows a room, a synthetic one or one picked from a file. [AGENTS.md](AGENTS.md) lists the commands and rules for agents.
