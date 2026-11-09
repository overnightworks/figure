# figure

The fleet's VRM 1.0 profile, its check command and a browser library that draws and drives a figure.

figure is the one package behind every agent's animated 3D head and shoulders. Today it ships the check:
`figure check <file>` tells whether a figure file meets the profile. The library that draws is not built yet.
Why figure exists and what it is not: [docs/VISION.md](docs/VISION.md). Its parts: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

Needs Node 24 or 26 and pnpm (the versions `package.json` pins).

```sh
pnpm install --frozen-lockfile
pnpm run build
node dist/bin.js check path/to/figure.glb
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

The closed set lives in `src/codes.ts` and is exported as `overnightworks-figure/codes`.

## Develop

`pnpm run check` type-checks, `pnpm exec vitest run --coverage` runs the tests (build first), and `quality check`
runs the shared static check. [AGENTS.md](AGENTS.md) lists the commands and rules for agents.
