import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	isOwnId,
	ownName,
	parseMember,
	sameMember,
	sameName,
	type CreateBody,
	type OwnCollection,
	type OwnMember,
	type PatchBody
} from '../own';
import type { Logger } from './log';

export const OWN_FILE = 'collections.json';

/** The version of the file's shape, written into it. */
const FILE_VERSION = 1;

/** What the file holds: the number of the next id, and the collections. */
interface OwnState {
	next: number;
	collections: OwnCollection[];
}

const NO_OWN: OwnState = { next: 1, collections: [] };

function isRecord(x: unknown): x is Record<string, unknown> {
	return x !== null && typeof x === 'object' && !Array.isArray(x);
}

const isNext = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 1;
/** An own id whose number is a safe integer, so that the next one counts exactly. */
const isStoredId = (x: unknown): x is string => typeof x === 'string' && isOwnId(x) && Number.isSafeInteger(Number(x.slice(1)));

/**
 * The own collections read from a file. A collection that is not an object, or whose id or name is not valid or
 * repeats one before it (the name with letter case ignored), is left out, as is one whose id's number is not a safe
 * integer; a member that is not valid, or repeats one before it, is dropped; `warn` is given the place of each. `next`
 * is never below one more than the highest id's number, so that no number is used twice. Spec of own collections,
 * sections 3 and 4.
 */
export function mendOwn(raw: unknown, warn: (what: string) => void): OwnState {
	if (!isRecord(raw)) {
		warn('file');
		return NO_OWN;
	}
	if (!isNext(raw.next)) warn('next');
	if (!Array.isArray(raw.collections)) warn('collections');
	const collections: OwnCollection[] = [];
	(Array.isArray(raw.collections) ? raw.collections : []).forEach((item: unknown, i) => {
		const place = `collections[${i}]`;
		const id = isRecord(item) && isStoredId(item.id) ? item.id : null;
		const name = isRecord(item) ? ownName(item.name) : null;
		if (
			!isRecord(item) ||
			id === null ||
			name === null ||
			collections.some((c) => c.id === id || sameName(c.name, name))
		) {
			warn(place);
			return;
		}
		if (!Array.isArray(item.members)) warn(`${place}.members`);
		const members: OwnMember[] = [];
		(Array.isArray(item.members) ? item.members : []).forEach((rawMember: unknown, j) => {
			const member = parseMember(rawMember);
			if (member === null || members.some((m) => sameMember(m, member))) warn(`${place}.members[${j}]`);
			else members.push(member);
		});
		collections.push({ id, name, members });
	});
	const highest = Math.max(0, ...collections.map((c) => Number(c.id.slice(1))));
	return { next: Math.max(isNext(raw.next) ? raw.next : 1, highest + 1), collections };
}

export type OwnError = 'name-taken' | 'no-collection' | 'unwritable';
export type OwnChange = { ok: true; collection: OwnCollection } | { ok: false; error: OwnError };

const NAME_TAKEN = { ok: false, error: 'name-taken' } as const;
const NO_COLLECTION = { ok: false, error: 'no-collection' } as const;
const UNWRITABLE = { ok: false, error: 'unwritable' } as const;

/** What a change makes of the collections as the changes before it left them: a refusal, or what to write. */
type Plan<A> = { refuse: A } | { write: OwnState; answer: A };

function errorCode(error: unknown): string | null {
	return error instanceof Error ? ((error as NodeJS.ErrnoException).code ?? null) : null;
}

/**
 * The own collections, in memory and in `<dir>/collections.json`. When the folder cannot be written, or a newer
 * Canvas wrote the file, the collections stay as they were and a change answers `unwritable`. No method throws.
 */
export class OwnStore {
	readonly #dir: string;
	readonly #file: string;
	readonly #log: Logger;
	#state: OwnState = NO_OWN;
	/** True when a newer Canvas wrote the file: every change is refused as `unwritable` for this run, so it is not written over. */
	#frozen = false;
	/** The change under way, or the last one: the next waits for it. */
	#last: Promise<unknown> = Promise.resolve();

	constructor(o: { dir: string; log: Logger }) {
		this.#dir = o.dir;
		this.#file = join(o.dir, OWN_FILE);
		this.#log = o.log;
	}

	all(): OwnCollection[] {
		return this.#state.collections;
	}

	get(id: string): OwnCollection | null {
		return this.#state.collections.find((c) => c.id === id) ?? null;
	}

	/** Reads the file, then checks that the folder can be written: a warn line says when it cannot. */
	async load(): Promise<void> {
		this.#state = await this.#read();
		const probe = join(this.#dir, `${OWN_FILE}.probe`);
		try {
			await mkdir(this.#dir, { recursive: true });
			await writeFile(probe, '');
			await rm(probe);
		} catch (error) {
			this.#cannotWrite(error);
		}
	}

	async #read(): Promise<OwnState> {
		let text: string;
		try {
			text = await readFile(this.#file, 'utf8');
		} catch (error) {
			const code = errorCode(error);
			// No file, or a part of its path is a file: nothing was saved yet.
			if (code === 'ENOENT' || code === 'ENOTDIR') return NO_OWN;
			return this.#setAside('cannot be read', { code });
		}
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch {
			return this.#setAside('is not JSON');
		}
		if (!isRecord(raw)) return this.#setAside('is not an object');
		if (typeof raw.version === 'number' && raw.version > FILE_VERSION) {
			this.#frozen = true;
			this.#log.warn('the collections file was written by a newer Canvas: it is read as far as it can be, and changes are refused', {
				file: this.#file,
				version: raw.version
			});
		}
		return mendOwn(raw, (what) =>
			this.#log.warn('a part of the collections file is not valid and is left out', { file: this.#file, part: what })
		);
	}

	/**
	 * A file that cannot be used is renamed to `collections.json.unreadable-<time>`, so that the first change does not
	 * write over what it holds, and there are no collections. When it cannot be renamed, a change cannot rename its
	 * own file onto it either, and fails as `unwritable`.
	 */
	async #setAside(why: string, fields: Record<string, unknown> = {}): Promise<OwnState> {
		const aside = `${this.#file}.unreadable-${new Date().toISOString().replace(/:/g, '-')}`;
		try {
			await rename(this.#file, aside);
			this.#log.warn(`the collections file ${why} and is set aside`, { file: this.#file, aside, ...fields });
		} catch (error) {
			this.#log.warn(`the collections file ${why} and cannot be set aside`, {
				file: this.#file,
				aside,
				...fields,
				renameCode: errorCode(error)
			});
		}
		return NO_OWN;
	}

	/** Makes a collection with the next id. Refused when another has its name, letter case ignored. */
	create(body: CreateBody): Promise<OwnChange> {
		return this.#queue((current): Plan<OwnChange> => {
			if (current.collections.some((c) => sameName(c.name, body.name))) return { refuse: NAME_TAKEN };
			const collection: OwnCollection = { id: `h${current.next}`, name: body.name, members: [...body.members] };
			return {
				write: { next: current.next + 1, collections: [...current.collections, collection] },
				answer: { ok: true, collection }
			};
		});
	}

	/** Renames a collection, adds the members not in it yet, or removes the ones given. */
	change(id: string, body: PatchBody): Promise<OwnChange> {
		return this.#queue((current): Plan<OwnChange> => {
			const old = current.collections.find((c) => c.id === id);
			if (old === undefined) return { refuse: NO_COLLECTION };
			let collection: OwnCollection;
			if ('name' in body) {
				if (current.collections.some((c) => c.id !== id && sameName(c.name, body.name))) return { refuse: NAME_TAKEN };
				collection = { ...old, name: body.name };
			} else if ('add' in body) {
				const members = [...old.members];
				for (const member of body.add) if (!members.some((m) => sameMember(m, member))) members.push(member);
				collection = { ...old, members };
			} else {
				collection = { ...old, members: old.members.filter((m) => !body.remove.some((r) => sameMember(m, r))) };
			}
			return {
				write: { next: current.next, collections: current.collections.map((c) => (c.id === id ? collection : c)) },
				answer: { ok: true, collection }
			};
		});
	}

	/** Deletes a collection. Its number is not used again. */
	remove(id: string): Promise<{ ok: true } | { ok: false; error: 'no-collection' | 'unwritable' }> {
		return this.#queue((current): Plan<{ ok: true } | typeof NO_COLLECTION> => {
			if (!current.collections.some((c) => c.id === id)) return { refuse: NO_COLLECTION };
			return {
				write: { next: current.next, collections: current.collections.filter((c) => c.id !== id) },
				answer: { ok: true }
			};
		});
	}

	/**
	 * Plans a change from the collections as the changes before it left them, writes what it planned and keeps it.
	 * `unwritable` when the write failed, or when every change is refused. Changes that overlap run one after the other,
	 * since they share the temporary file and each must see the one before.
	 */
	#queue<A>(plan: (current: OwnState) => Plan<A>): Promise<A | typeof UNWRITABLE> {
		const run = this.#last.then(async () => {
			if (this.#frozen) return UNWRITABLE;
			const planned = plan(this.#state);
			if ('refuse' in planned) return planned.refuse;
			return (await this.#write(planned.write)) ? planned.answer : UNWRITABLE;
		});
		// A plan that throws fails its own change only.
		this.#last = run.catch(() => {});
		return run;
	}

	async #write(next: OwnState): Promise<boolean> {
		const temporary = `${this.#file}.tmp`;
		try {
			await mkdir(this.#dir, { recursive: true });
			await writeFile(temporary, JSON.stringify({ version: FILE_VERSION, next: next.next, collections: next.collections }));
			await rename(temporary, this.#file);
		} catch (error) {
			await rm(temporary, { force: true }).catch(() => {});
			this.#cannotWrite(error);
			return false;
		}
		this.#state = next;
		return true;
	}

	#cannotWrite(error: unknown): void {
		this.#log.warn('collections folder cannot be written', { file: this.#file, code: errorCode(error) });
	}
}
