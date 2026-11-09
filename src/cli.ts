import { readFileSync } from 'node:fs';
import { checkFigure } from './check.js';
import { refusalDescriptions } from './codes.js';

/** The exit codes are quality's: 0 yes, 1 no, 2 could not answer. */
export const EXIT_PASSED = 0;
export const EXIT_REFUSED = 1;
export const EXIT_UNJUDGED = 2;

export interface Output {
	readonly stdout: (line: string) => void;
	readonly stderr: (line: string) => void;
}

/** The package's one output owner and its one filesystem boundary. */
export function runCommand(argv: readonly string[], output: Output): number {
	const [command, file] = argv;
	if (command !== 'check') {
		output.stderr(`unknown command: ${command ?? '(none)'}; usage: figure check <file>`);
		return EXIT_UNJUDGED;
	}
	if (file === undefined || argv.length > 2) {
		output.stderr('usage: figure check <file>');
		return EXIT_UNJUDGED;
	}
	let bytes: Uint8Array;
	try {
		bytes = readFileSync(file);
	} catch (error) {
		output.stderr(`cannot read ${file}: ${String(error)}`);
		return EXIT_UNJUDGED;
	}
	const refusals = checkFigure(bytes);
	if (refusals.length === 0) {
		output.stdout(`${file}: passes every rule`);
		return EXIT_PASSED;
	}
	for (const { code } of refusals) {
		output.stdout(`${code}: ${refusalDescriptions[code]}`);
	}
	return EXIT_REFUSED;
}
