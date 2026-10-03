import { t } from './strings';
import { ALL_OS, type Collection, type ListEntry, type Os } from './types';

/** The years of some games, "1991–1997" or one year, or '' when GOG gives none of them a year. */
export function yearSpan(games: ListEntry[]): string {
	const years = games.map((g) => g.releaseYear).filter((y): y is number => y !== null);
	if (years.length === 0) return '';
	return t.collections.years(Math.min(...years), Math.max(...years));
}

/** Every system any of the games is for, in the fixed order. */
export function systemsOf(games: ListEntry[]): Os[] {
	return ALL_OS.filter((os) => games.some((g) => g.os.includes(os)));
}

/** The entries of a collection that are in the list, in the collection's order: oldest first. */
export function gamesOf(collection: Collection, entries: ListEntry[]): ListEntry[] {
	const byId = new Map(entries.map((e) => [e.id, e]));
	return collection.games.map((id) => byId.get(id)).filter((e): e is ListEntry => e !== undefined);
}
