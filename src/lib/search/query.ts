import { genreGroup, genreName, type GenreGroup } from '$lib/genres';
import type { ListEntry } from '$lib/types';
import type { Sort, ViewState } from './state';
import { normalize, sortKey, words } from './text';

export type MatchField = 'dlc' | 'series' | 'pack' | 'genre' | 'tag' | 'developer' | 'publisher';

export interface MatchReason {
	field: MatchField;
	value: string;
}

export interface Match {
	entry: ListEntry;
	/** Why the entry matched, when the title alone does not explain it. */
	reason: MatchReason | null;
}

function candidates(entry: ListEntry): MatchReason[] {
	return [
		...entry.dlc.map((value) => ({ field: 'dlc' as const, value })),
		// Spec, section 9: every series, also one of a single game, and the packs that count.
		...(entry.series ? [{ field: 'series' as const, value: entry.series }] : []),
		...entry.packs.map((value) => ({ field: 'pack' as const, value })),
		...entry.genres.map((value) => ({ field: 'genre' as const, value })),
		// A genre is also found by the name it is shown by: "first" finds FPP.
		...entry.genres
			.filter((value) => genreName(value) !== value)
			.map((value) => ({ field: 'genre' as const, value: genreName(value) })),
		...entry.tags.map((value) => ({ field: 'tag' as const, value })),
		...entry.developers.map((value) => ({ field: 'developer' as const, value })),
		...(entry.publisher ? [{ field: 'publisher' as const, value: entry.publisher }] : [])
	];
}

/**
 * Every wanted word must be found in the title or in another field.
 * `wanted` is the output of `words`.
 */
export function matchEntry(entry: ListEntry, wanted: string[]): Match | null {
	if (wanted.length === 0) return { entry, reason: null };
	const title = normalize(entry.title);
	let others: MatchReason[] | null = null;
	let reason: MatchReason | null = null;
	for (const word of wanted) {
		if (title.includes(word)) continue;
		others ??= candidates(entry);
		const hit = others.find((c) => normalize(c.value).includes(word));
		if (!hit) return null;
		reason ??= hit;
	}
	return { entry, reason };
}

/** The entries to show for a view: filtered, searched and, unless `sorted` is false, sorted. */
export function query(entries: ListEntry[], state: ViewState, sorted = true): Match[] {
	const wanted = words(state.q);
	// Genre, setting and style are three questions: any chosen value within one
	// is enough, and every one that was asked must hold.
	const byGroup = new Map<GenreGroup, string[]>();
	for (const genre of state.genres) {
		const group = genreGroup(genre);
		byGroup.set(group, [...(byGroup.get(group) ?? []), normalize(genre)]);
	}
	const groups = [...byGroup.values()];
	const matches: Match[] = [];
	for (const entry of entries) {
		if (state.os.length > 0 && !state.os.some((os) => entry.os.includes(os))) continue;
		if (groups.length > 0) {
			const own = entry.genres.map(normalize);
			if (!groups.every((chosen) => chosen.some((genre) => own.includes(genre)))) continue;
		}
		if (state.together.length > 0 && !state.together.some((flag) => entry[flag])) continue;
		// The games for adults, before the search: a hidden game is not found either.
		if (state.hide18 && entry.adult) continue;
		const match = matchEntry(entry, wanted);
		if (match) matches.push(match);
	}
	return sorted ? sortBy(matches, state.sort, (m) => m.entry) : matches;
}

/** What a card of the list is sorted by. */
export interface SortKeys {
	title: string;
	/** The position in the library list, which is newest first. */
	order: number;
	releaseYear: number | null;
}

/**
 * Sorts in place by the order of the view. "A to Z": by title, without a leading "The".
 * "Recently added": the newest purchase first. "Release year": newest first, as "Recently
 * added"; no year comes last, and equal years go by title.
 */
export function sortBy<T>(items: T[], sort: Sort, keysOf: (item: T) => SortKeys): T[] {
	const keys = new Map(items.map((item) => [item, keysOf(item)]));
	const of = (item: T) => keys.get(item)!;
	if (sort === 'recent') return items.sort((a, b) => of(a).order - of(b).order);
	const titles = new Map(items.map((item) => [item, sortKey(of(item).title)]));
	const byTitle = (a: T, b: T) => titles.get(a)!.localeCompare(titles.get(b)!, 'en', { numeric: true });
	if (sort === 'year') {
		return items.sort((a, b) => {
			const ya = of(a).releaseYear;
			const yb = of(b).releaseYear;
			if (ya === yb) return byTitle(a, b);
			if (ya == null) return 1;
			if (yb == null) return -1;
			return yb - ya;
		});
	}
	return items.sort(byTitle);
}

/** Every genre of the library, for the filter. */
export function allGenres(entries: ListEntry[]): string[] {
	return [...new Set(entries.flatMap((e) => e.genres))].sort((a, b) => a.localeCompare(b, 'en'));
}

export interface Facet {
	/** The genre as GOG names it. This is what the filter and the address hold. */
	genre: string;
	/** How many entries have it. */
	count: number;
}

/** The genres of the library by group, the most common first. For the filter panel. */
export function genreFacets(entries: ListEntry[]): Record<GenreGroup, Facet[]> {
	const counts = new Map<string, number>();
	for (const entry of entries) {
		for (const genre of new Set(entry.genres)) counts.set(genre, (counts.get(genre) ?? 0) + 1);
	}
	const out: Record<GenreGroup, Facet[]> = { genre: [], setting: [], style: [] };
	for (const [genre, count] of counts) out[genreGroup(genre)].push({ genre, count });
	for (const facets of Object.values(out)) {
		facets.sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre, 'en'));
	}
	return out;
}
