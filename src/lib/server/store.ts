import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { INDEX_SCHEMA, type Index } from './index-types';
import type { Logger } from './log';

export type CacheState = 'never' | 'written' | 'failed';

function isRecord(x: unknown): x is Record<string, unknown> {
	return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function isIndex(x: unknown): x is Index {
	return (
		isRecord(x) &&
		x.schema === INDEX_SCHEMA &&
		typeof x.version === 'string' &&
		typeof x.builtAt === 'string' &&
		Array.isArray(x.entries) &&
		isRecord(x.details) &&
		isRecord(x.files)
	);
}

/**
 * The current index, in memory and as a file. The file is a cache: losing
 * it costs one rebuild.
 */
export class IndexStore {
	readonly file: string;
	readonly #dir: string;
	readonly #log: Logger;
	#index: Index | null = null;
	#cacheState: CacheState = 'never';

	constructor(dir: string, log: Logger) {
		this.#dir = dir;
		this.#log = log;
		this.file = join(dir, 'index.json');
	}

	get(): Index | null {
		return this.#index;
	}

	/** How the last write of the file went. */
	cacheState(): CacheState {
		return this.#cacheState;
	}

	/** Reads the file. False when there is none or it cannot be used. */
	async load(): Promise<boolean> {
		let text: string;
		try {
			text = await readFile(this.file, 'utf8');
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== 'ENOENT') {
				this.#log.warn('the cached index cannot be read and is ignored', {
					file: this.file,
					code: code ?? null
				});
			}
			return false;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			this.#log.warn('the cached index cannot be read and is ignored', { file: this.file });
			return false;
		}
		if (!isIndex(parsed)) {
			this.#log.warn('the cached index has another format and is ignored', { file: this.file });
			return false;
		}
		this.#index = parsed;
		return true;
	}

	/** Swaps the index in, then writes the file through a temporary one. */
	async set(index: Index): Promise<void> {
		this.#index = index;
		const temporary = `${this.file}.${process.pid}.tmp`;
		try {
			await mkdir(this.#dir, { recursive: true });
			await writeFile(temporary, JSON.stringify(index));
			await rename(temporary, this.file);
			this.#cacheState = 'written';
		} catch (error) {
			this.#cacheState = 'failed';
			await rm(temporary, { force: true }).catch(() => {});
			this.#log.error('the index could not be written to the cache', {
				file: this.file,
				reason: error instanceof Error ? error.message : String(error)
			});
		}
	}
}
