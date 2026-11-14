// Writes figure's base gestures to bytes: one `<name>.vrma` per gesture in the directory given as the only argument, with each bone's
// keys at their own seconds. The lag a bone trails by is the runtime's and is never written.
// Run it from the repository after `pnpm run build`; Node strips the types of the builder.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Quaternion } from 'three';
import { buildGlb } from '../tests/glbBuilder.ts';
import { clipParts, tracksOfKeys } from '../tests/clipBuilder.ts';
import { gestureClips } from '../dist/gestureClips.js';
import { quaternionOfTurn } from '../dist/gestureLayer.js';
import { clipProfile } from '../dist/profile.js';

const [outputDirectory] = process.argv.slice(2);
if (outputDirectory === undefined) {
	console.error('usage: node scripts/write_base_clips.mjs <output-directory>');
	process.exit(2);
}
mkdirSync(outputDirectory, { recursive: true });
for (const [name, clip] of Object.entries(gestureClips)) {
	const tracks = tracksOfKeys(clip.keys, (turn) => quaternionOfTurn(turn, new Quaternion()).toArray());
	writeFileSync(join(outputDirectory, `${name}.vrma`), buildGlb(clipParts(clipProfile, [tracks])));
}
