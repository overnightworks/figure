# figure

The fleet's VRM 1.0 profile as a check: the framework-free TypeScript ESM package `overnightworks-figure`.

Today figure ships the check: `figure check <file>` tells whether a figure file meets the profile's container, VRM and
budget rules (the texture budgets are not judged yet).
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
| `not_vrm` | there is no `extensions.VRMC_vrm` object, or its `specVersion` is not `1.0`; the other VRM rules then stay silent |
| `preset_missing` | `expressions.preset` lacks one of the profile's presets; one refusal per missing preset, naming it |
| `look_at_missing` | `VRMC_vrm.lookAt` is not an object |
| `licence_redistribution` | `meta.allowRedistribution` is not `true` |
| `licence_avatar_permission` | `meta.avatarPermission` is not `everyone` |
| `licence_credit` | `meta.creditNotation` is not `unnecessary` |
| `too_many_triangles` | the meshes hold more triangles together than the profile's budget (each mesh counted once) |
| `too_many_morph_targets` | a primitive has more morph targets than the profile's budget |
| `gltf_invalid` | a mesh, primitive, accessor or index a budget must read does not have glTF's shape, so it cannot judge |

A refusal may also carry a text naming what it found (the extension, the place of the URI); the command prints it
after the code. The profile's values (allowed extensions, file budget, presets, licence values, triangle and morph-target budgets) live in `src/profile.ts` and are exported as
`overnightworks-figure/profile`.

The closed set lives in `src/codes.ts` and is exported as `overnightworks-figure/codes`.

## Develop

`pnpm run check` type-checks, `pnpm exec vitest run --coverage` runs the tests (build first), and `quality check`
runs the shared static check. [AGENTS.md](AGENTS.md) lists the commands and rules for agents.
