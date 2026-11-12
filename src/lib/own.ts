// Own collections: what whoever holds the PIN groups, shared by the server and the page. Spec of own collections,
// sections 3, 5 and 7.
import { sortKey } from './search/text';
import type { Collection, ListEntry } from './types';

/** A game by its id, or one of GOG's collections by the id of one of its groups ("s" or "p" and GOG's id). */
export type OwnMember = { game: string } | { collection: string };

/** As stored and as the layout's data carries it. */
export interface OwnCollection {
	/** "h" and a whole number, never used twice. */
	id: string;
	name: string;
	/** Each once, in the order they were added. */
	members: OwnMember[];
}

/** The longest name, in characters after trimming. */
export const OWN_NAME_MAX = 60;

/** The name trimmed, or null when it is not text or is empty or longer than `OWN_NAME_MAX` after trimming. */
export function ownName(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const name = raw.trim();
	return name.length >= 1 && name.length <= OWN_NAME_MAX ? name : null;
}

/** True when two names are the same once trimmed, letter case ignored: the names must differ so. */
export function sameName(a: string, b: string): boolean {
	return a.trim().toLocaleLowerCase('en') === b.trim().toLocaleLowerCase('en');
}

/** True for an own collection's id, such as "h3". */
export function isOwnId(id: string): boolean {
	return /^h\d+$/.test(id);
}

function isRecord(x: unknown): x is Record<string, unknown> {
	return x !== null && typeof x === 'object' && !Array.isArray(x);
}

/**
 * A member as a body or the file gives it, or null: exactly `{ game: "<digits>" }` or
 * `{ collection: "s<digits>" | "p<digits>" }`. An own collection is never a member. Checked for its shape, not
 * against the index, which may be rebuilding.
 */
export function parseMember(raw: unknown): OwnMember | null {
	if (!isRecord(raw) || Object.keys(raw).length !== 1) return null;
	const { game, collection } = raw;
	if (typeof game === 'string' && /^\d+$/.test(game)) return { game };
	if (typeof collection === 'string' && /^[sp]\d+$/.test(collection)) return { collection };
	return null;
}

/** True when two members name the same game, or the same group by the same id. */
export function sameMember(a: OwnMember, b: OwnMember): boolean {
	if ('game' in a) return 'game' in b && a.game === b.game;
	return 'collection' in b && a.collection === b.collection;
}

/** The members of a body, each once in the order given, or null when it is not a list or one of them is not valid. */
function parseMembers(raw: unknown): OwnMember[] | null {
	if (!Array.isArray(raw)) return null;
	const members: OwnMember[] = [];
	for (const item of raw) {
		const member = parseMember(item);
		if (member === null) return null;
		if (!members.some((m) => sameMember(m, member))) members.push(member);
	}
	return members;
}

/** The body of `POST /api/collections`. */
export type CreateBody = { name: string; members: OwnMember[] };
/** The body of `PATCH /api/collections/<id>`: one change. */
export type PatchBody = { name: string } | { add: OwnMember[] } | { remove: OwnMember[] };

/**
 * The body of a new collection, or null: a name `ownName` takes and a list of members, any of which not valid refuses
 * the body. The members each once. Keys it does not know are ignored. Spec section 13.
 */
export function parseCreateBody(raw: unknown): CreateBody | null {
	if (!isRecord(raw)) return null;
	const name = ownName(raw.name);
	const members = parseMembers(raw.members);
	return name === null || members === null ? null : { name, members };
}

/**
 * The body of a change, or null: exactly one of `name`, `add` and `remove`, checked as `parseCreateBody` checks
 * them. Keys it does not know are ignored. Spec section 13.
 */
export function parsePatchBody(raw: unknown): PatchBody | null {
	if (!isRecord(raw)) return null;
	const given = (['name', 'add', 'remove'] as const).filter((key) => raw[key] !== undefined);
	if (given.length !== 1) return null;
	const [key] = given;
	if (key === 'name') {
		const name = ownName(raw.name);
		return name === null ? null : { name };
	}
	const members = parseMembers(raw[key]);
	if (members === null) return null;
	return key === 'add' ? { add: members } : { remove: members };
}

/** A member as the page shows it; `stored` is the member of the file it comes from. */
export type ShownMember =
	| { kind: 'game'; stored: OwnMember; entry: ListEntry }
	| { kind: 'collection'; stored: OwnMember; collection: Collection; games: ListEntry[] };

/** An own collection against the index: its members in the library, oldest first, and its games, each once. */
export interface ShownOwn {
	id: string;
	name: string;
	members: ShownMember[];
	/** Every game it stands for, each once, oldest first. */
	games: ListEntry[];
}

/** "A to Z", as the list sorts. */
export const byTitle = (a: string, b: string): number => sortKey(a).localeCompare(sortKey(b), 'en', { numeric: true });

/** Sorts in place oldest first, no year last, then by title as "A to Z" sorts. */
function oldestFirst<T>(items: T[], of: (item: T) => { year: number | null; title: string }): T[] {
	const keys = new Map(items.map((item) => [item, of(item)]));
	const titles = new Map(items.map((item) => [item, sortKey(keys.get(item)!.title)]));
	return items.sort((a, b) => {
		const ya = keys.get(a)!.year;
		const yb = keys.get(b)!.year;
		if (ya !== yb) {
			if (ya === null) return 1;
			if (yb === null) return -1;
			return ya - yb;
		}
		return titles.get(a)!.localeCompare(titles.get(b)!, 'en', { numeric: true });
	});
}

/** What a member is sorted by: its oldest game's year and its title, a GOG collection's name. */
function sortKeysOf(member: ShownMember): { year: number | null; title: string } {
	if (member.kind === 'game') return { year: member.entry.releaseYear, title: member.entry.title };
	const years = member.games.map((g) => g.releaseYear).filter((y): y is number => y !== null);
	return { year: years.length > 0 ? Math.min(...years) : null, title: member.collection.name };
}

/**
 * The own collections against the index (spec sections 3 and 5). A game member is the entry of that id. A GOG member
 * is the collection whose `groups` holds its id; when none does, the entries whose `groups` hold it stand in, as
 * game members. A member not in the library is left out, and a game or a GOG collection that two members bring is
 * shown once, for the first. The members go oldest first by their oldest game, then by title, no year last (rule 7);
 * the games each once, oldest first, no year last, then by title (rule 9 of 0.9.0). An empty collection is kept.
 */
export function resolveOwn(own: OwnCollection[], entries: ListEntry[], collections: Collection[]): ShownOwn[] {
	const byId = new Map(entries.map((e) => [e.id, e]));
	const byGroup = new Map<string, Collection>();
	for (const collection of collections) for (const group of collection.groups) byGroup.set(group, collection);
	const inGroup = new Map<string, ListEntry[]>();
	for (const entry of entries) {
		for (const group of entry.groups) {
			const games = inGroup.get(group);
			if (games) games.push(entry);
			else inGroup.set(group, [entry]);
		}
	}
	return own.map(({ id, name, members: stored }) => {
		const members: ShownMember[] = [];
		const seen = new Set<string>();
		const addGame = (member: OwnMember, entry: ListEntry | undefined) => {
			if (entry === undefined || seen.has(entry.id)) return;
			seen.add(entry.id);
			members.push({ kind: 'game', stored: member, entry });
		};
		const shownCollections = new Set<string>();
		for (const member of stored) {
			if ('game' in member) {
				addGame(member, byId.get(member.game));
				continue;
			}
			const collection = byGroup.get(member.collection);
			if (collection === undefined) {
				for (const entry of inGroup.get(member.collection) ?? []) addGame(member, entry);
				continue;
			}
			if (shownCollections.has(collection.id)) continue;
			shownCollections.add(collection.id);
			const games = collection.games.map((gameId) => byId.get(gameId)).filter((e): e is ListEntry => e !== undefined);
			members.push({ kind: 'collection', stored: member, collection, games });
		}
		oldestFirst(members, sortKeysOf);
		const each = new Map(members.flatMap((m) => (m.kind === 'game' ? [m.entry] : m.games)).map((e) => [e.id, e]));
		const games = oldestFirst([...each.values()], (e) => ({ year: e.releaseYear, title: e.title }));
		return { id, name, members, games };
	});
}

/** One strip of an own collection's picture. Spec section 7. */
export interface Band {
	/** Image id of the wide image with the logo. */
	banner: string | null;
	/** Image id of the poster, cropped to the band when there is no banner. */
	poster: string | null;
	/** Shown when there is neither; a GOG collection's name. */
	title: string;
	/** For a GOG collection: the number of its games shown. Null for a game. */
	nested: number | null;
}

/** The most bands a picture has. */
const MOST_BANDS = 6;

/**
 * The strips of an own collection's picture: one per member, in the members' order, at most six. A game gives its
 * images and title; a GOG collection the images of its oldest game shown, its name and its number of games shown.
 * With "Hide 18+" on, a game for adults gives none, and a GOG collection none when all its games are.
 */
export function bandsOf(own: ShownOwn, hide18: boolean): Band[] {
	const bands: Band[] = [];
	for (const member of own.members) {
		if (bands.length === MOST_BANDS) break;
		if (member.kind === 'game') {
			const { banner, poster, title, adult } = member.entry;
			if (!(hide18 && adult)) bands.push({ banner, poster, title, nested: null });
			continue;
		}
		const games = hide18 ? member.games.filter((g) => !g.adult) : member.games;
		if (games.length === 0) continue;
		const [oldest] = games;
		bands.push({ banner: oldest.banner, poster: oldest.poster, title: member.collection.name, nested: games.length });
	}
	return bands;
}

/** For each game in an own collection, the names of the own collections that hold it, A to Z. For the search. */
export function ownNamesByEntry(own: ShownOwn[]): Map<string, string[]> {
	const names = new Map<string, string[]>();
	for (const { name, games } of own) {
		for (const { id } of games) {
			const held = names.get(id);
			if (held) held.push(name);
			else names.set(id, [name]);
		}
	}
	for (const list of names.values()) list.sort(byTitle);
	return names;
}
