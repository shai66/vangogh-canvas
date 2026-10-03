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

export type ListCard = GameCard | CollectionCard;

/**
 * The cards of the list. Without the toggle: every entry that answers the view. With it (spec,
 * section 5.2): each collection that has a game passing the filters is one card, shown when the
 * search finds its name or one of those games; the other entries are their own cards. A
 * collection is sorted by its name, its latest purchase and its newest game.
 */
export function cards(entries: ListEntry[], collections: Collection[], state: ViewState): ListCard[] {
	const game = (m: { entry: ListEntry; reason: MatchReason | null }): GameCard => ({ kind: 'game', key: m.entry.id, entry: m.entry, reason: m.reason });
	if (!state.grouped) return query(entries, state).map(game);

	const wanted = words(state.q);
	const byId = new Map(collections.map((c) => [c.id, c]));
	const out: ListCard[] = [];
	const homes = new Map<string, ListEntry[]>();
	// The filters first, the search after: a collection stands for its games that pass the filters.
	for (const { entry } of query(entries, { ...state, q: '' }, false)) {
		const home = entry.collection !== null && byId.has(entry.collection) ? entry.collection : null;
		if (home === null) {
			const match = matchEntry(entry, wanted);
			if (match) out.push(game(match));
			continue;
		}
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
	return sortBy(out, state.sort, (card) => {
		if (card.kind === 'game') return card.entry;
		const years = card.games.map((e) => e.releaseYear).filter((y): y is number => y !== null);
		return {
			title: card.collection.name,
			order: Math.min(...card.games.map((e) => e.order)),
			releaseYear: years.length > 0 ? Math.max(...years) : null
		};
	});
}
