import { sortKey } from '../search/text';
import type { Collection, CollectionKind, JoinedGroup } from '../types';

/** A list entry, as the rules of collections see it. */
export interface Member {
	id: string;
	title: string;
	releaseYear: number | null;
	/** The game's page on GOG.com, or null. */
	storeUrl: string | null;
	/** GOG's series of the game. */
	series: { id: string; name: string } | null;
}

/** The record of a pack, as the indexer read it. */
export interface PackRecord {
	id: string;
	name: string;
	poster: string | null;
	storeUrl: string | null;
	/** GOG's series of the pack, which a pack of one game lends to its game (rule 4). */
	series: { id: string; name: string } | null;
	/** Product ids of everything the pack includes: games, and perhaps packs. */
	includes: string[];
}

/** What the rules say of one entry. */
export interface MemberGroups {
	/** The id of the collection the entry is in. */
	collection: string | null;
	/** The name of its series, also a series of one. */
	series: string | null;
	/** The names of the packs that count and hold it, A to Z. */
	packs: string[];
}

export interface Collected {
	/** Every collection, by name A to Z. */
	collections: Collection[];
	/** By entry id. Every member has an answer. */
	of: Map<string, MemberGroups>;
}

/** A series or a pack that holds games of the library. */
interface Group {
	key: string;
	kind: 'series' | 'pack';
	name: string;
	poster: string | null;
	total: number | null;
	storeUrl: string | null;
	/** True for a pack GOG sells the games as: one of them has the pack's page. */
	soldAs: boolean;
	members: Set<string>;
}

const byName = (a: string, b: string): number => sortKey(a).localeCompare(sortKey(b), 'en', { numeric: true });
const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Rule 1: the games of a pack, those of packs inside it included, each pack once. A link to a
 * product that is no known pack counts as one game.
 */
function gamesOf(pack: PackRecord, known: Map<string, PackRecord>, seen: Set<string> = new Set()): Set<string> {
	seen.add(pack.id);
	const games = new Set<string>();
	for (const id of pack.includes) {
		const inner = known.get(id);
		if (!inner) games.add(id);
		else if (!seen.has(id)) for (const game of gamesOf(inner, known, seen)) games.add(game);
	}
	return games;
}

/** Rule 3: the page of a game or a pack on GOG.com is the part after /game/, so that a language part such as /en/ does not count. */
function page(url: string | null): string | null {
	const slug = url?.match(/\/game\/([^/?#]+)/)?.[1];
	return slug ? slug.toLowerCase() : null;
}

/** Rule 6, on a tie of size: a pack GOG sells the games as, then a series, then another pack. */
function rank(group: Group): number {
	if (group.kind === 'series') return 1;
	return group.soldAs ? 0 : 2;
}

/**
 * Works out the collections of the library by the rules of the spec, section 3: series and packs
 * that share a game join into one, led by the one that holds the most games of the library.
 * Never throws.
 */
export function collect(members: Member[], packs: PackRecord[]): Collected {
	const byId = new Map(members.map((m) => [m.id, m]));
	const known = new Map(packs.map((p) => [p.id, p]));
	const groups = new Map<string, Group>();
	const groupsOf = new Map<string, string[]>(members.map((m) => [m.id, []]));
	const add = (id: string, group: Group) => {
		group.members.add(id);
		groupsOf.get(id)?.push(group.key);
	};

	// Rule 4: a game without a series takes the series of a pack that holds only that game. Two
	// such packs with different series: the first in the indexer's order wins; none at home has two.
	const gamesOfPack = new Map([...known.values()].map((pack) => [pack, gamesOf(pack, known)]));
	const seriesOf = new Map(members.map((m) => [m.id, m.series]));
	for (const [pack, games] of gamesOfPack) {
		if (!pack.series || games.size !== 1) continue;
		const [id] = games;
		if (seriesOf.get(id) === null) seriesOf.set(id, pack.series);
	}

	for (const member of members) {
		const series = seriesOf.get(member.id);
		if (!series) continue;
		const key = `s${series.id}`;
		let group = groups.get(key);
		if (!group) {
			group = { key, kind: 'series', name: series.name, poster: null, total: null, storeUrl: null, soldAs: false, members: new Set() };
			groups.set(key, group);
		}
		add(member.id, group);
	}
	for (const [pack, games] of gamesOfPack) {
		const held = [...games].filter((id) => byId.has(id));
		// Rule 2: the library holds at least half of its games. Shop bundles stay out.
		if (held.length === 0 || held.length * 2 < games.size) continue;
		const own = page(pack.storeUrl);
		const soldAs = own !== null && held.some((id) => page(byId.get(id)?.storeUrl ?? null) === own);
		const group: Group = {
			key: `p${pack.id}`,
			kind: 'pack',
			name: pack.name,
			poster: pack.poster,
			total: games.size,
			storeUrl: pack.storeUrl,
			soldAs,
			members: new Set()
		};
		groups.set(group.key, group);
		for (const id of held) add(id, group);
	}

	// Rule 5: groups that share a game join, and joining runs on.
	const parent = new Map([...groups.keys()].map((key) => [key, key]));
	const root = (key: string): string => {
		let at = key;
		while (parent.get(at) !== at) at = parent.get(at) ?? at;
		parent.set(key, at);
		return at;
	};
	for (const keys of groupsOf.values()) {
		for (const key of keys.slice(1)) parent.set(root(key), root(keys[0]));
	}
	const joined = new Map<string, { inside: Group[]; games: Set<string> }>();
	for (const group of groups.values()) {
		const at = root(group.key);
		const one = joined.get(at) ?? { inside: [], games: new Set<string>() };
		one.inside.push(group);
		for (const id of group.members) one.games.add(id);
		joined.set(at, one);
	}

	// Rule 9: oldest first, a game without a year last, the games of a year by title.
	const oldestFirst = (a: string, b: string): number => {
		const ya = byId.get(a)?.releaseYear ?? null;
		const yb = byId.get(b)?.releaseYear ?? null;
		if (ya !== yb) {
			if (ya === null) return 1;
			if (yb === null) return -1;
			return ya - yb;
		}
		return byName(byId.get(a)?.title ?? '', byId.get(b)?.title ?? '');
	};

	const collections: Collection[] = [];
	const collectionOf = new Map<string, string>();
	for (const { inside, games } of joined.values()) {
		// Rule 8: a collection of one is none.
		if (games.size < 2) continue;
		// Rule 6: the lead.
		inside.sort((a, b) => b.members.size - a.members.size || rank(a) - rank(b) || byName(a.name, b.name) || byKey(a.key, b.key));
		const [lead, ...rest] = inside;
		// Rule 7: the kind.
		const kind: CollectionKind = lead.members.size === games.size ? lead.kind : 'collection';
		const collection: Collection = {
			id: lead.key,
			kind,
			name: lead.name,
			poster: lead.poster,
			total: lead.total,
			storeUrl: lead.soldAs ? lead.storeUrl : null,
			// Rule 10: what was joined, in the order of rule 6.
			joined: rest.map((g): JoinedGroup => ({ kind: g.kind, name: g.name })),
			games: [...games].sort(oldestFirst)
		};
		collections.push(collection);
		for (const id of games) collectionOf.set(id, collection.id);
	}
	collections.sort((a, b) => byName(a.name, b.name) || byKey(a.id, b.id));

	const of = new Map<string, MemberGroups>();
	for (const member of members) {
		const names = (groupsOf.get(member.id) ?? []).filter((key) => key.startsWith('p')).map((key) => groups.get(key)?.name ?? '');
		of.set(member.id, {
			collection: collectionOf.get(member.id) ?? null,
			series: seriesOf.get(member.id)?.name ?? null,
			packs: [...new Set(names)].sort(byName)
		});
	}
	return { collections, of };
}
