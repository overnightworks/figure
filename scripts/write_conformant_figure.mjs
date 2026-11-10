// Writes the test builder's conformant synthetic VRM to the path given as the only argument.
// Run it from the repository after `pnpm run build`; Node strips the types of the builder.
import { writeFileSync } from 'node:fs';
import { buildConformantVrmJson, buildGlb } from '../tests/glbBuilder.ts';
import { figureProfile } from '../dist/profile.js';

const [outputPath] = process.argv.slice(2);
if (outputPath === undefined) {
	console.error('usage: node scripts/write_conformant_figure.mjs <output-path>');
	process.exit(2);
}
writeFileSync(outputPath, buildGlb({ json: buildConformantVrmJson(figureProfile) }));
