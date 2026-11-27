// Writes the `#!/usr/bin/env node` line as the first line of `dist/bin.js`, the target of the package's `bin`, so the installed `figure` command runs in Node.
// Run it from the repository after `tsc`; `package.json`'s `build` does.
import { readFileSync, writeFileSync } from 'node:fs';

const command = new URL('../dist/bin.js', import.meta.url);
writeFileSync(command, `#!/usr/bin/env node\n${readFileSync(command, 'utf8')}`);
