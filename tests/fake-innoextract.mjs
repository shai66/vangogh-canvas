#!/usr/bin/env node
// innoextract for the tests: no Inno Setup installer can be made for them (spec 0.12.0, section 17).
// Called as innoextract is: --silent --exclude-temp --output-dir <out> <installer>. The installer is
// JSON: { "files": { "<path>": "<content>" } } writes those files under <out>; "delayMs" waits that
// long first; { "fail": "<message>" } says the message and exits 1, as innoextract does.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const at = args.indexOf('--output-dir');
const out = at >= 0 ? args[at + 1] : '.';
const installer = args.at(-1);

let setup;
try {
	setup = JSON.parse(await readFile(installer, 'utf8'));
} catch {
	process.stderr.write(`Not a supported Inno Setup installer: ${installer}\n`);
	process.exit(1);
}
if (typeof setup.fail === 'string') {
	process.stderr.write(`Error: ${setup.fail}\n`);
	process.exit(1);
}
if (typeof setup.delayMs === 'number') await new Promise((resolve) => setTimeout(resolve, setup.delayMs));
for (const [path, content] of Object.entries(setup.files ?? {})) {
	const file = join(out, ...path.split('/'));
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, content);
}
