import { readFileSync } from 'node:fs';
import { checkClip, checkFigure } from './check.js';
import { refusalDescriptions } from './codes.js';

/** The exit codes are quality's: 0 yes, 1 no, 2 could not answer. */
export const EXIT_PASSED = 0;
export const EXIT_REFUSED = 1;
export const EXIT_UNJUDGED = 2;

export interface Output {
	readonly stdout: (line: string) => void;
	readonly stderr: (line: string) => void;
}

const USAGE = 'usage: figure check [--as clip] <file>';

/** The package's one output owner and its one filesystem boundary. */
export function runCommand(argv: readonly string[], output: Output): number {
	const [command, ...checkArguments] = argv;
	if (command !== 'check') {
		output.stderr(`unknown command: ${command ?? '(none)'}; ${USAGE}`);
		return EXIT_UNJUDGED;
	}
	// `--as` comes right after `check`, `clip` is its only value, and a file without it is a figure.
	const isClip = checkArguments[0] === '--as';
	const files = checkArguments.slice(isClip ? 2 : 0);
	if ((isClip && checkArguments[1] !== 'clip') || files.length !== 1) {
		output.stderr(USAGE);
		return EXIT_UNJUDGED;
	}
	const [file] = files as [string];
	let bytes: Uint8Array;
	try {
		bytes = readFileSync(file);
	} catch (error) {
		output.stderr(`cannot read ${file}: ${String(error)}`);
		return EXIT_UNJUDGED;
	}
	const refusals = isClip ? checkClip(bytes) : checkFigure(bytes);
	if (refusals.length === 0) {
		output.stdout(`${file}: passes every rule`);
		return EXIT_PASSED;
	}
	for (const { code, detail } of refusals) {
		const suffix = detail === undefined ? '' : ` (${detail})`;
		output.stdout(`${code}: ${refusalDescriptions[code]}${suffix}`);
	}
	return EXIT_REFUSED;
}
