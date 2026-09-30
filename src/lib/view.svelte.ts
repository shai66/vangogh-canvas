import { query, type Match } from './search/query';
import type { Sort, Together, ViewState } from './search/state';
import type { ListEntry, Os } from './types';

/** Cards are drawn in batches of this many while scrolling. */
export const BATCH = 42;

function toggled<T>(list: T[], value: T): T[] {
	return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function same(a: ViewState, b: ViewState): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * What the visitor asked the list to show, and the entries that answer it.
 * Every change made through a method is reported to `changed`, with the view
 * as it was before, so that it can be written into the address and remembered.
 * `read` takes a view from the address and reports nothing.
 */
export class View {
	q = $state('');
	os = $state<Os[]>([]);
	genres = $state<string[]>([]);
	together = $state<Together[]>([]);
	sort = $state<Sort>('title');
	/** How many cards are drawn. */
	limit = $state(BATCH);

	/** The entries that answer the view, in its order. */
	readonly matches: Match[];
	/** The matches that are drawn. */
	readonly shown: Match[];
	/** The size of the whole library. */
	readonly total: number;
	/** How many filter values are switched on. The search is not a filter. */
	readonly filterCount: number;
	/** True when the list shows less than the whole library could. */
	readonly narrowed: boolean;

	#changed: (state: ViewState, before: ViewState) => void;

	/** `entries` is a function, so that a newer list is picked up when the page data changes. */
	constructor(
		entries: () => ListEntry[],
		initial: ViewState,
		changed: (state: ViewState, before: ViewState) => void = () => {}
	) {
		this.#changed = changed;
		this.#set(initial);
		this.matches = $derived(query(entries(), this.state));
		this.shown = $derived(this.matches.slice(0, this.limit));
		this.total = $derived(entries().length);
		this.filterCount = $derived(this.os.length + this.genres.length + this.together.length);
		this.narrowed = $derived(this.filterCount > 0 || this.q.trim() !== '');
	}

	get state(): ViewState {
		return { q: this.q, os: this.os, genres: this.genres, together: this.together, sort: this.sort };
	}

	#set(state: ViewState): void {
		this.q = state.q;
		this.os = [...state.os];
		this.genres = [...state.genres];
		this.together = [...state.together];
		this.sort = state.sort;
		this.limit = BATCH;
	}

	#apply(change: Partial<ViewState>): void {
		const before = this.state;
		this.#set({ ...before, ...change });
		this.#changed(this.state, before);
	}

	/** Takes the view of an address. A view that is already shown is left alone, its drawn cards too. */
	read(state: ViewState): void {
		if (!same(state, this.state)) this.#set(state);
	}

	more(): void {
		if (this.limit < this.matches.length) this.limit += BATCH;
	}

	setQuery(q: string): void {
		this.#apply({ q });
	}
	toggleOs(os: Os): void {
		this.#apply({ os: toggled(this.os, os) });
	}
	toggleGenre(genre: string): void {
		this.#apply({ genres: toggled(this.genres, genre) });
	}
	toggleTogether(flag: Together): void {
		this.#apply({ together: toggled(this.together, flag) });
	}
	setSort(sort: Sort): void {
		this.#apply({ sort });
	}
	/** Leaves the search alone. */
	clearFilters(): void {
		this.#apply({ os: [], genres: [], together: [] });
	}
	clearAll(): void {
		this.#apply({ q: '', os: [], genres: [], together: [] });
	}
}
