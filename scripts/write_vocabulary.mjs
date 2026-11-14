// Writes figure's vocabulary to `dist/figure-vocabulary.json`: the gesture names (the keys of `figureGesture`) and the moods (the values
// of `figureMood`), each in its declared order, read from the built modules so no token is written twice. `version` is the file's shape
// version: a token added or removed is a release, only a changed shape raises it.
// Run it from the repository after `tsc`; `package.json`'s `build` does.
import { writeFileSync } from 'node:fs';
import { figureMood } from '../dist/expressions.js';
import { figureGesture } from '../dist/gestures.js';

const vocabulary = { version: 1, gestures: Object.keys(figureGesture), moods: Object.values(figureMood) };
writeFileSync(new URL('../dist/figure-vocabulary.json', import.meta.url), `${JSON.stringify(vocabulary, null, 2)}\n`);
