import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Sort } from '../search/state';
import { NO_SETTINGS, SORTS, type Settings } from '../settings';
import { ALL_OS, type Os } from '../types';
import type { Logger } from './log';

export const SETTINGS_FILE = 'settings.json';

/** The version of the file's shape, written into it. */
const FILE_VERSION = 1;

function isRecord(x: unknown): x is Record<string, unknown> {
	return x !== null && typeof x === 'object' && !Array.isArray(x);
}

const isBoolean = (x: unknown): x is boolean => typeof x === 'boolean';
const isSort = (x: unknown): x is Sort => SORTS.includes(x as Sort);
const isOsList = (x: unknown): x is Os[] =>
	Array.isArray(x) && x.every((name) => (ALL_OS as readonly unknown[]).includes(name));

/**
 * The settings read from a file. Each part is taken on its own: one that is missing or not
 * valid takes its value from `NO_SETTINGS`, and `warn` is given its name. Spec 0.11.0, section 3.2.
 */
export function mendSettings(raw: unknown, warn: (part: string) => void): Settings {
	if (!isRecord(raw)) {
		warn('file');
		return NO_SETTINGS;
	}
	const mend = <T>(part: string, value: unknown, valid: (x: unknown) => x is T, fallback: T): T => {
		if (valid(value)) return value;
		warn(part);
		return fallback;
	};
	const defaults = isRecord(raw.defaults) ? raw.defaults : {};
	const os = mend('defaults.os', defaults.os, isOsList, NO_SETTINGS.defaults.os);
	return {
		defaults: {
			// In the fixed order, each once.
			os: ALL_OS.filter((name) => os.includes(name)),
			sort: mend('defaults.sort', defaults.sort, isSort, NO_SETTINGS.defaults.sort),
			grouped: mend('defaults.grouped', defaults.grouped, isBoolean, NO_SETTINGS.defaults.grouped),
			hide18: mend('defaults.hide18', defaults.hide18, isBoolean, NO_SETTINGS.defaults.hide18)
		},
		theo: mend('theo', raw.theo, isBoolean, NO_SETTINGS.theo)
	};
}

function errorCode(error: unknown): string | null {
	return error instanceof Error ? ((error as NodeJS.ErrnoException).code ?? null) : null;
}

/**
 * The settings, in memory and in `<dir>/settings.json`. When the folder cannot be written, the
 * settings stay as they were and `writable` says so. Neither method throws.
 */
export class SettingsStore {
	readonly #dir: string;
	readonly #file: string;
	readonly #log: Logger;
	#settings: Settings = NO_SETTINGS;
	#writable = true;
	/** The save under way, or the last one: the next waits for it. */
	#last: Promise<boolean> = Promise.resolve(true);

	constructor(o: { dir: string; log: Logger }) {
		this.#dir = o.dir;
		this.#file = join(o.dir, SETTINGS_FILE);
		this.#log = o.log;
	}

	get(): Settings {
		return this.#settings;
	}

	/** How the check at start, or the last save after it, went. */
	get writable(): boolean {
		return this.#writable;
	}

	/** Reads the file, then checks that the folder can be written. */
	async load(): Promise<void> {
		this.#settings = await this.#read();
		const probe = join(this.#dir, '.probe');
		try {
			await mkdir(this.#dir, { recursive: true });
			await writeFile(probe, '');
			await rm(probe);
			this.#writable = true;
		} catch (error) {
			this.#cannotWrite(error);
		}
	}

	async #read(): Promise<Settings> {
		let text: string;
		try {
			text = await readFile(this.#file, 'utf8');
		} catch (error) {
			const code = errorCode(error);
			// No file, or a part of its path is a file: nothing was saved yet.
			if (code !== 'ENOENT' && code !== 'ENOTDIR') {
				this.#log.warn('the settings file cannot be read and is ignored', { file: this.#file, code });
			}
			return NO_SETTINGS;
		}
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch {
			this.#log.warn('the settings file is not JSON and is ignored', { file: this.#file });
			return NO_SETTINGS;
		}
		return mendSettings(raw, (part) =>
			this.#log.warn('a part of the settings file is not valid and takes its default', { file: this.#file, part })
		);
	}

	/**
	 * Writes the whole settings through a temporary file, then keeps them. False when that failed. Saves that overlap
	 * are written one after the other, since they share the temporary file.
	 */
	save(next: Settings): Promise<boolean> {
		const write = this.#last.then(() => this.#write(next));
		this.#last = write;
		return write;
	}

	async #write(next: Settings): Promise<boolean> {
		const temporary = `${this.#file}.tmp`;
		try {
			await mkdir(this.#dir, { recursive: true });
			await writeFile(temporary, JSON.stringify({ version: FILE_VERSION, ...next }));
			await rename(temporary, this.#file);
		} catch (error) {
			await rm(temporary, { force: true }).catch(() => {});
			this.#cannotWrite(error);
			return false;
		}
		this.#settings = next;
		this.#writable = true;
		return true;
	}

	#cannotWrite(error: unknown): void {
		this.#writable = false;
		this.#log.warn('settings folder cannot be written', { code: errorCode(error) });
	}
}
