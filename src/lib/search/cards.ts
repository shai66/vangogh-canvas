import { ownNamesByEntry, type ShownOwn } from '$lib/own';
import type { Collection, ListEntry } from '$lib/types';
import { matchEntry, query, sortBy, type MatchReason } from './query';
import type { ViewState } from './state';
import { normalize, words } from './text';

/** A game's card in the list. */
export interface GameCard {
	kind: 'game';
	/** The game's id. */
	key: string;
	entry: ListEntry;
	reason: MatchReason | null;
}

/** A collection's card in the list, in place of its games. */
export interface CollectionCard {
	kind: 'collection';
	/** The collection's id. */
	key: string;
	collection: Collection;
	/** The games it stands for: those of the collection that pass the filters, oldest first. */
	games: ListEntry[];
	/** The game the search found when the collection's name did not hold every word, or null. */
	found: ListEntry | null;
}

/** An own collection's card in the list, in place of its games and its GOG collections. */
export interface OwnCard {
	kind: 'own';
	/** The own collection's id. */
	key: string;
	own: ShownOwn;
	/** The games it stands for: those of the own collection that pass the filters, oldest first. */
	games: ListEntry[];
	/** The game the search found when the own collection's name did not hold every word, or null. */
	found: ListEntry | null;
}

export type ListCard = GameCard | CollectionCard | OwnCard;

/**
 * The cards of the list. Without the toggle: every entry that answers the view, also by the name of an own
 * collection that holds it. With it (spec, section 5.2): each collection that has a game passing the filters is one
 * card, shown when the search finds its name or one of those games; the other entries are their own cards. An own
 * collection is such a card too, and the games and the GOG collections in it are not cards of their own (spec of own
 * collections, section 6). A collection is sorted by its name, its latest purchase and its newest game.
 */
export function cards(entries: ListEntry[], collections: Collection[], state: ViewState, own: ShownOwn[] = []): ListCard[] {
	const game = (m: { entry: ListEntry; reason: MatchReason | null }): GameCard => ({ kind: 'game', key: m.entry.id, entry: m.entry, reason: m.reason });
	if (!state.grouped) return query(entries, state, true, ownNamesByEntry(own)).map(game);

	const wanted = words(state.q);
	const byId = new Map(collections.map((c) => [c.id, c]));
	const inOwn = new Set(own.flatMap((o) => o.games.map((e) => e.id)));
	const inside = new Set(own.flatMap((o) => o.members.flatMap((m) => (m.kind === 'collection' ? [m.collection.id] : []))));
	const passing = new Set<string>();
	const out: ListCard[] = [];
	const homes = new Map<string, ListEntry[]>();
	// The filters first, the search after: a collection stands for its games that pass the filters.
	for (const { entry } of query(entries, { ...state, q: '' }, false)) {
		passing.add(entry.id);
		const home = entry.collection !== null && byId.has(entry.collection) ? entry.collection : null;
		if (home === null) {
			if (inOwn.has(entry.id)) continue;
			const match = matchEntry(entry, wanted);
			if (match) out.push(game(match));
			continue;
		}
		if (inside.has(home)) continue;
		const members = homes.get(home);
		if (members) members.push(entry);
		else homes.set(home, [entry]);
	}
	for (const [id, members] of homes) {
		const collection = byId.get(id)!;
		const place = new Map(collection.games.map((gameId, position) => [gameId, position]));
		const games = members.sort((a, b) => (place.get(a.id) ?? 0) - (place.get(b.id) ?? 0));
		const name = normalize(collection.name);
		const named = wanted.every((word) => name.includes(word));
		const found = named ? null : (games.find((entry) => matchEntry(entry, wanted) !== null) ?? null);
		if (named || found) out.push({ kind: 'collection', key: id, collection, games, found });
	}
	for (const shown of own) {
		const games = shown.games.filter((entry) => passing.has(entry.id));
		if (games.length === 0) continue;
		const name = normalize(shown.name);
		const named = wanted.every((word) => name.includes(word));
		// Its name counts as a field of its games, as a series or a pack does for a GOG card's.
		const found = named ? null : (games.find((entry) => matchEntry(entry, wanted, [shown.name]) !== null) ?? null);
		if (named || found) out.push({ kind: 'own', key: shown.id, own: shown, games, found });
	}
	return sortBy(out, state.sort, (card) => {
		if (card.kind === 'game') return card.entry;
		const years = card.games.map((e) => e.releaseYear).filter((y): y is number => y !== null);
		return {
			title: card.kind === 'own' ? card.own.name : card.collection.name,
			order: Math.min(...card.games.map((e) => e.order)),
			releaseYear: years.length > 0 ? Math.max(...years) : null
		};
	});
}
