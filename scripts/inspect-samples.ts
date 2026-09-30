// Prints what the samples say about assumptions A1 to A10. Run with:
//   node scripts/inspect-samples.ts
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const dir = 'samples';

async function read(path: string): Promise<any> {
	return JSON.parse(await readFile(join(dir, path), 'utf8'));
}
async function readOrNull(path: string): Promise<any> {
	try {
		return await read(path);
	} catch {
		return null;
	}
}
function heading(text: string): void {
	console.log(`\n== ${text}`);
}
function tally(values: string[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
	return counts;
}

const list: any[] = await read('available-products.json');
const status: Record<string, Record<string, number>> = await read('status.json');

heading('A1 library list');
console.log('entries:', list.length);
console.log('keys seen:', tally(list.flatMap((p) => Object.keys(p))));
console.log('id types:', tally(list.map((p) => typeof p.id)));
console.log('os values:', tally(list.flatMap((p) => (p.os ?? []).map(String))));
console.log('first entry:', JSON.stringify(list[0]));

heading('A2 order of the list');
console.log('first three:', list.slice(0, 3).map((p) => p.tt));
console.log('last three:', list.slice(-3).map((p) => p.tt));
console.log('Ask the user which end holds the most recent purchases.');

heading('status of the three calls per product');
for (const call of ['gog-api-products', 'gog-details', 'filenames']) {
	console.log(call, tally(Object.values(status).map((s) => String(s[call]))));
}

heading('A3, A10 product types');
const types: Record<string, string[]> = {};
const records: Record<string, any> = {};
for (const p of list) {
	const record = await readOrNull(`metadata/gog-api-products/${p.id}.json`);
	records[p.id] = record;
	const type = record?._embedded?.productType ?? '(no record)';
	(types[type] ??= []).push(`${p.id} ${p.tt}`);
}
for (const [type, items] of Object.entries(types)) {
	console.log(`${type}: ${items.length}`);
	if (type !== 'GAME') for (const item of items) console.log('   ', item);
}
const sample = Object.values(records).find((r) => r);
console.log('top-level keys of a record:', Object.keys(sample ?? {}));
console.log('_embedded keys:', Object.keys(sample?._embedded ?? {}));
console.log('_links keys:', Object.keys(sample?._links ?? {}));

heading('A4 relation links');
for (const key of ['requiresGames', 'isRequiredByGames', 'includesGames', 'isIncludedInGames']) {
	const found = Object.values(records).find((r) => r?._links?.[key]);
	console.log(key, '=>', JSON.stringify(found?._links?.[key])?.slice(0, 300) ?? '(never present)');
}

heading('A10 owned ids');
const topIds = new Set(list.map((p) => String(p.id)));
const dlcIds = new Set(list.flatMap((p) => Object.keys(p.dlc ?? {})));
console.log('top-level ids that are also nested DLC ids:', [...topIds].filter((id) => dlcIds.has(id)));

heading('A5 downloads');
let mostFiles = { title: '', count: 0 };
let mostDlc = { title: '', count: 0 };
const languages: string[] = [];
const osKeys: string[] = [];
const fileKeys: string[] = [];
const dlcKeys: string[] = [];
for (const p of list) {
	const details = await readOrNull(`metadata/gog-details/${p.id}.json`);
	if (!details) continue;
	const dlcs = details.dlcs ?? [];
	if (dlcs.length > mostDlc.count) mostDlc = { title: p.tt, count: dlcs.length };
	for (const d of dlcs) dlcKeys.push(...Object.keys(d));
	for (const pair of details.downloads ?? []) {
		languages.push(String(pair[0]));
		for (const [os, files] of Object.entries(pair[1] ?? {})) {
			osKeys.push(os);
			const items = files as any[];
			if (items.length > mostFiles.count) mostFiles = { title: `${p.tt} (${os})`, count: items.length };
			for (const f of items) fileKeys.push(...Object.keys(f));
		}
	}
}
console.log('languages:', tally(languages));
console.log('os keys:', tally(osKeys));
console.log('file keys:', tally(fileKeys));
console.log('dlc keys:', tally(dlcKeys));
console.log('most files for one OS:', mostFiles);
console.log('most DLC:', mostDlc);

heading('A6 file names against the download list');
let listed = 0;
let present = 0;
const absent: string[] = [];
for (const p of list) {
	const details = await readOrNull(`metadata/gog-details/${p.id}.json`);
	const names = await readOrNull(`filenames/${p.id}.json`);
	if (!details || !names) continue;
	const all = [details, ...(details.dlcs ?? [])].flatMap((d: any) => d.downloads ?? []);
	for (const pair of all) {
		if (pair[0] !== 'English') continue;
		for (const files of Object.values(pair[1] ?? {})) {
			for (const f of files as any[]) {
				listed++;
				if (names[f.manualUrl]) present++;
				else if (absent.length < 10) absent.push(f.manualUrl);
			}
		}
	}
}
console.log(`English files listed: ${listed}, with a file name: ${present}`);
console.log('examples without a file name:', absent);

heading('A8 the file to run');
for (const file of (await readdir(join(dir, 'filenames'))).slice(0, 200)) {
	const names = await read(`filenames/${file}`);
	const entries = Object.entries(names);
	if (entries.length >= 4) {
		console.log(file, entries.slice(0, 6));
		break;
	}
}

heading('A7, A9 probes');
for (const p of await read('probes.json')) {
	console.log(p.what, '=>', p.status, p.imageId ?? '', p.headers?.['content-range'] ?? '', p.headers?.['content-disposition'] ?? '');
}

heading('longest title');
console.log([...list].sort((a, b) => (b.tt ?? '').length - (a.tt ?? '').length)[0]?.tt);
