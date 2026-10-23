import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OnBox } from '../../batocera';
import type { Logger } from '../log';
import type { Box } from './box';
import { SYSTEM_DIR } from './commands';
import { MARKER, parseMarker, type Marker } from './folder';

type System = keyof typeof SYSTEM_DIR;
const SYSTEMS = Object.keys(SYSTEM_DIR) as System[];

/** A marker as a look found it, with the name of its `.pc` folder, such as "Night Harbour.pc". */
export interface SeenMarker extends Marker {
	folder: string;
}

/** What Canvas last saw on the box. Spec 0.12.0, sections 4.2 and 10.2. */
export interface Look {
	at: string;
	/** False when the box did not answer at `at`: then the rest is what the look before saw. */
	up: boolean;
	/** The markers of the `.pc` folders, each in its own system's folder. */
	markers: SeenMarker[];
	/** The names of the `.pc` folders in each system's folder. */
	folders: Record<System, string[]>;
	/** Canvas's leftovers: the paths of `.pc.part` and `.pc.old` folders that hold its marker (section 3.5). */
	leftovers: string[];
}

export const LOOK_FILE = 'batocera.json';
const FILE_VERSION = 1;
const FOLDER = '.pc';
const LEFTOVER = ['.pc.part', '.pc.old'];

const endsIn = (name: string, suffix: string) => name.endsWith(suffix) && name.length > suffix.length;

/** The marker in a folder; null when there is none, it is damaged, or it names the other system. */
export async function markerIn(box: Box, dir: string, system: System): Promise<Marker | null> {
	let data: Buffer | null;
	try {
		data = await box.read(`${dir}/${MARKER}`);
	} catch (error) {
		// The box's own refusal, such as a file where a folder was expected, is no marker; a lost connection is not.
		if (typeof (error as { code?: unknown })?.code === 'number') return null;
		throw error;
	}
	const marker = data === null ? null : parseMarker(data.toString('utf8'));
	return marker?.system === system ? marker : null;
}

/** Lists both systems' folders and reads the marker of every `.pc`, `.pc.part` and `.pc.old` folder. */
export async function readLook(box: Box): Promise<Omit<Look, 'at' | 'up'>> {
	const markers: SeenMarker[] = [];
	const folders: Record<System, string[]> = { windows: [], dos: [] };
	const leftovers: string[] = [];
	for (const system of SYSTEMS) {
		const dir = SYSTEM_DIR[system];
		for (const name of await box.list(dir)) {
			const leftover = LEFTOVER.some((suffix) => endsIn(name, suffix));
			if (!leftover && !endsIn(name, FOLDER)) continue;
			if (!leftover) folders[system].push(name);
			const marker = await markerIn(box, `${dir}/${name}`, system);
			if (!marker) continue;
			if (leftover) leftovers.push(`${dir}/${name}`);
			else markers.push({ ...marker, folder: name });
		}
	}
	return { markers, folders, leftovers };
}

function sameFiles(a: string[], b: string[]): boolean {
	const one = new Set(a);
	const other = new Set(b);
	return one.size === other.size && [...one].every((file) => other.has(file));
}

/**
 * A game's place on the box by the last look (section 4.2). `name` is the folder name Canvas would give
 * the game, without `.pc`; `archiveFiles` are the names of vangogh's installer files that would be sent.
 */
export function onBoxOf(
	look: Look | null,
	game: { id: string; name: string; system: System },
	archiveFiles: string[]
): { onBox: OnBox; marker: SeenMarker | null; newer: boolean } {
	const marker = look?.markers.find((m) => m.gameId === game.id) ?? null;
	if (marker) return { onBox: 'canvas', marker, newer: archiveFiles.length > 0 && !sameFiles(archiveFiles, marker.files) };
	const folder = `${game.name}${FOLDER}`;
	// The folder of another game of the same title is not this one's, nor put there by hand: a send fails as in the way.
	const another = look?.markers.some((m) => m.system === game.system && m.folder === folder) ?? false;
	const hand = !another && (look?.folders[game.system].includes(folder) ?? false);
	return { onBox: hand ? 'hand' : 'no', marker: null, newer: false };
}

function isRecord(x: unknown): x is Record<string, unknown> {
	return x !== null && typeof x === 'object' && !Array.isArray(x);
}

const isNames = (x: unknown): x is string[] => Array.isArray(x) && x.every((name) => typeof name === 'string');

/** The look of the file; null when it is not one. */
function lookOf(raw: unknown): Look | null {
	if (!isRecord(raw) || raw.version !== FILE_VERSION) return null;
	const { at, up, markers, folders, leftovers } = raw;
	if (typeof at !== 'string' || Number.isNaN(Date.parse(at)) || typeof up !== 'boolean') return null;
	if (!isRecord(folders) || !isNames(folders.windows) || !isNames(folders.dos) || !isNames(leftovers) || !Array.isArray(markers)) return null;
	const seen: SeenMarker[] = [];
	for (const m of markers) {
		// Checked as a marker on the box is.
		const marker = isRecord(m) && typeof m.folder === 'string' ? parseMarker(JSON.stringify(m)) : null;
		if (!marker) return null;
		seen.push({ ...marker, folder: m.folder as string });
	}
	return { at, up, markers: seen, folders: { windows: folders.windows, dos: folders.dos }, leftovers };
}

function errorCode(error: unknown): string | null {
	return error instanceof Error ? ((error as NodeJS.ErrnoException).code ?? null) : null;
}

/** The last look, in memory and in `<dir>/batocera.json`, so that a restart starts from it. No method throws. */
export class LookStore {
	readonly #dir: string;
	readonly #file: string;
	readonly #log: Logger;
	#look: Look | null = null;
	/** The write under way, or the last one: the next waits for it, since they share the temporary file. */
	#last: Promise<void> = Promise.resolve();

	constructor(o: { dir: string; log: Logger }) {
		this.#dir = o.dir;
		this.#file = join(o.dir, LOOK_FILE);
		this.#log = o.log;
	}

	get(): Look | null {
		return this.#look;
	}

	/** Reads the file; missing or not valid, there is no last look. */
	async load(): Promise<void> {
		let text: string;
		try {
			text = await readFile(this.#file, 'utf8');
		} catch (error) {
			const code = errorCode(error);
			if (code !== 'ENOENT' && code !== 'ENOTDIR') this.#log.warn('the last look at batocera cannot be read and is ignored', { file: this.#file, code });
			this.#look = null;
			return;
		}
		let raw: unknown = null;
		try {
			raw = JSON.parse(text);
		} catch {
			// Not JSON: not a look either.
		}
		this.#look = lookOf(raw);
		if (!this.#look) this.#log.warn('the last look at batocera is not valid and is ignored', { file: this.#file });
	}

	/** Keeps the look, then writes it whole through a temporary file; one that cannot be written stays in memory. */
	set(look: Look): Promise<void> {
		this.#look = look;
		const write = this.#last.then(() => this.#write(look));
		this.#last = write;
		return write;
	}

	/** A look at `at` that did not reach the box: what the last look saw stays. */
	markDown(at: string): Promise<void> {
		const last = this.#look ?? { markers: [], folders: { windows: [], dos: [] }, leftovers: [] };
		return this.set({ ...last, at, up: false });
	}

	async #write(look: Look): Promise<void> {
		const temporary = `${this.#file}.tmp`;
		try {
			await mkdir(this.#dir, { recursive: true });
			await writeFile(temporary, JSON.stringify({ version: FILE_VERSION, ...look }));
			await rename(temporary, this.#file);
		} catch (error) {
			await rm(temporary, { force: true }).catch(() => {});
			this.#log.warn('the last look at batocera could not be written', { file: this.#file, code: errorCode(error) });
		}
	}
}
