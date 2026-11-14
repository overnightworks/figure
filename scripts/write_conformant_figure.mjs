// Writes the test builder's conformant synthetic VRM, or with `--as room` its conformant room, to the path given last.
// Run it from the repository after `pnpm run build`; Node strips the types of the builders.
import { writeFileSync } from 'node:fs';
import { buildConformantVrmGlb } from '../tests/glbBuilder.ts';
import { buildRoomGlb } from '../tests/roomBuilder.ts';
import { figureProfile } from '../dist/profile.js';

const usage = 'usage: node scripts/write_conformant_figure.mjs [--as room] <output-path>';
const argumentsGiven = process.argv.slice(2);
const isRoom = argumentsGiven[0] === '--as' && argumentsGiven[1] === 'room';
const paths = argumentsGiven.slice(isRoom ? 2 : 0);
if (paths.length !== 1 || paths[0].startsWith('--')) {
	console.error(usage);
	process.exit(2);
}
writeFileSync(paths[0], isRoom ? buildRoomGlb() : buildConformantVrmGlb(figureProfile));
