import { vangoghDownloads } from '../../extras';
import { ALL_OS, type Os } from '../../types';
import { arr, obj, str } from './raw';
import { parseSize } from './size';

export interface MappedFile {
	manualUrl: string;
	name: string;
	version: string;
	sizeText: string;
	sizeBytes: number;
}

export type MappedByOs = Partial<Record<Os, MappedFile[]>>;

export interface MappedDownloads {
	/** Null for English, otherwise the language that was used. */
	language: string | null;
	byOs: MappedByOs;
}

export interface MappedDlc {
	title: string;
	downloads: MappedDownloads;
}

export interface MappedExtra {
	manualUrl: string;
	name: string;
	/** GOG's word for its kind, in lower case, such as "manuals". */
	kind: string;
	sizeText: string;
	sizeBytes: number;
}

export interface MappedDetails {
	downloads: MappedDownloads;
	dlcs: MappedDlc[];
	/** The extras of the product and of its DLC, nested ones included, once per address, only those vangogh downloads. */
	extras: MappedExtra[];
	/**
	 * True when the record lists at least one installer file of a known system,
	 * in any language, of the product or of any of its DLC. Extras do not count.
	 */
	offersInstallers: boolean;
}

const OS_BY_KEY = new Map<string, Os>([
	['windows', 'windows'],
	['mac', 'macos'],
	['osx', 'macos'],
	['linux', 'linux']
]);

const MAX_DEPTH = 5;

function mapFiles(x: unknown): MappedFile[] {
	const files: MappedFile[] = [];
	for (const item of arr(x)) {
		const entry = obj(item);
		const manualUrl = str(entry.manualUrl);
		if (!manualUrl || files.some((f) => f.manualUrl === manualUrl)) continue;
		files.push({
			manualUrl,
			name: str(entry.name),
			version: str(entry.version),
			sizeText: str(entry.size),
			sizeBytes: parseSize(entry.size)
		});
	}
	return files;
}

/** The files of one language entry, by system, in the order windows, macos, linux. */
function mapByOs(x: Record<string, unknown>): MappedByOs {
	const found: MappedByOs = {};
	for (const [key, files] of Object.entries(x)) {
		const os = OS_BY_KEY.get(key.toLowerCase());
		if (!os) continue;
		const mapped = mapFiles(files);
		if (mapped.length > 0) found[os] = [...(found[os] ?? []), ...mapped];
	}
	const byOs: MappedByOs = {};
	for (const os of ALL_OS) if (found[os]) byOs[os] = found[os];
	return byOs;
}

/** English when it has files, otherwise the first language that has some. */
function mapDownloads(x: unknown): MappedDownloads {
	const entries = arr(x)
		.filter((pair): pair is unknown[] => Array.isArray(pair))
		.map((pair) => ({ language: str(pair[0]), byOs: mapByOs(obj(pair[1])) }))
		.filter((entry) => Object.keys(entry.byOs).length > 0);
	const isEnglish = (language: string) => language.toLowerCase() === 'english';
	const chosen = entries.find((entry) => isEnglish(entry.language)) ?? entries[0];
	if (!chosen) return { language: null, byOs: {} };
	return {
		language: isEnglish(chosen.language) ? null : chosen.language || null,
		byOs: chosen.byOs
	};
}

/** True when a download list names a file with an address, for a known system, in any language. */
function listsFiles(x: unknown): boolean {
	return arr(x).some(
		(pair) =>
			Array.isArray(pair) &&
			Object.entries(obj(pair[1])).some(
				([key, files]) => OS_BY_KEY.has(key.toLowerCase()) && mapFiles(files).length > 0
			)
	);
}

/** True when the record or one of its DLC, nested ones included, lists an installer. */
function offers(x: unknown, depth: number): boolean {
	if (depth > MAX_DEPTH) return false;
	const record = obj(x);
	return listsFiles(record.downloads) || arr(record.dlcs).some((dlc) => offers(dlc, depth + 1));
}

function collectDlcs(x: unknown, out: MappedDlc[], depth: number): void {
	if (depth > MAX_DEPTH) return;
	for (const item of arr(x)) {
		const dlc = obj(item);
		const title = str(dlc.title);
		if (title) out.push({ title, downloads: mapDownloads(dlc.downloads) });
		collectDlcs(dlc.dlcs, out, depth + 1);
	}
}

function collectExtras(x: unknown, out: MappedExtra[], depth: number): void {
	if (depth > MAX_DEPTH) return;
	const record = obj(x);
	for (const item of arr(record.extras)) {
		const entry = obj(item);
		const manualUrl = str(entry.manualUrl);
		const sizeText = str(entry.size);
		if (manualUrl === '' || !vangoghDownloads(sizeText) || out.some((e) => e.manualUrl === manualUrl)) continue;
		out.push({ manualUrl, name: str(entry.name), kind: str(entry.type).toLowerCase(), sizeText, sizeBytes: parseSize(sizeText) });
	}
	for (const dlc of arr(record.dlcs)) collectExtras(dlc, out, depth + 1);
}

/** Maps a `gog-details` record. Never throws, whatever it is given. */
export function mapDetails(raw: unknown): MappedDetails {
	const root = obj(raw);
	const dlcs: MappedDlc[] = [];
	collectDlcs(root.dlcs, dlcs, 0);
	const extras: MappedExtra[] = [];
	// The record itself is one level above the DLC, which start at depth 0.
	collectExtras(root, extras, -1);
	return {
		downloads: mapDownloads(root.downloads),
		dlcs,
		extras,
		offersInstallers: offers(root, -1)
	};
}
