import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE, type ViewState } from './search/state';
import type { ListEntry } from './types';
import { BATCH, View } from './view.svelte';

function entry(id: number, over: Partial<ListEntry> = {}): ListEntry {
	return {
		id: String(id),
		title: `Game ${String(id).padStart(3, '0')}`,
		kind: 'game',
		os: ['windows'],
		genres: [],
		tags: [],
		developers: [],
		publisher: '',
		multiplayer: false,
		coop: false,
		poster: null,
		banner: null,
		releaseYear: null,
		dlc: [],
		extraKinds: [],
		order: id,
		complete: true,
		hasFiles: true,
		collection: null,
		series: null,
		packs: [],
		adult: false,
		...over
	};
}

const library = [
	...Array.from({ length: 100 }, (_, i) => entry(i)),
	entry(200, { title: 'Linux Strategy', os: ['linux'], genres: ['Strategy'], coop: true })
];

function view(initial: Partial<ViewState> = {}, entries: ListEntry[] = library) {
	const reported: ViewState[] = [];
	const made = new View(() => entries, { ...DEFAULT_STATE, ...initial }, (state) => reported.push(state));
	return { view: made, reported };
}

describe('View', () => {
	it('starts from the view it is given and reports nothing', () => {
		const { view: v, reported } = view({ os: ['linux'], sort: 'recent' });
		expect(v.state).toEqual({ ...DEFAULT_STATE, os: ['linux'], sort: 'recent' });
		expect(v.cards.map((c) => c.key)).toEqual(['200']);
		expect(reported).toEqual([]);
	});

	it('draws the first batch, and one more each time it is asked', () => {
		const { view: v } = view();
		expect(v.total).toBe(101);
		expect(v.shown).toHaveLength(BATCH);
		v.more();
		expect(v.shown).toHaveLength(2 * BATCH);
		v.more();
		v.more();
		v.more();
		expect(v.shown).toHaveLength(101);
		expect(v.limit).toBe(3 * BATCH);
	});

	it('reports every change, and starts again at the first batch', () => {
		const { view: v, reported } = view();
		v.more();
		v.setQuery('game 00');
		expect(v.limit).toBe(BATCH);
		expect(v.cards).toHaveLength(10);
		expect(reported.at(-1)).toMatchObject({ q: 'game 00' });
		v.toggleOs('linux');
		v.toggleGenre('Strategy');
		v.toggleTogether('coop');
		v.setSort('recent');
		expect(reported).toHaveLength(5);
		expect(reported.at(-1)).toEqual({
			q: 'game 00',
			os: ['linux'],
			genres: ['Strategy'],
			together: ['coop'],
			sort: 'recent',
			grouped: false,
			hide18: false
		});
		expect(v.cards).toEqual([]);
	});

	it('switches a filter off when it is chosen a second time', () => {
		const { view: v } = view();
		v.toggleOs('linux');
		v.toggleOs('macos');
		v.toggleOs('linux');
		expect(v.os).toEqual(['macos']);
	});

	it('switches the collections toggle, reports it, and keeps it when the filters or the search are cleared', () => {
		const { view: v, reported } = view();
		v.toggleGrouped();
		expect(v.grouped).toBe(true);
		expect(reported.at(-1)).toMatchObject({ grouped: true });
		v.toggleOs('linux');
		v.setQuery('x');
		v.clearFilters();
		v.clearAll();
		expect(v.state).toEqual({ ...DEFAULT_STATE, grouped: true });
		v.toggleGrouped();
		expect(v.grouped).toBe(false);
	});

	it('shows a collection as one card while the toggle is on, and counts the games its card stands for', () => {
		const games = [entry(1, { collection: 's1' }), entry(2, { collection: 's1' }), entry(3)];
		const dusk = { id: 's1', kind: 'series' as const, name: 'Dusk', poster: null, total: null, storeUrl: null, joined: [], games: ['1', '2'] };
		const v = new View(() => games, DEFAULT_STATE, () => {}, () => [dusk]);
		expect([v.cards.length, v.games, v.collectionCount]).toEqual([3, 3, 0]);
		v.toggleGrouped();
		expect(v.cards.map((c) => c.key)).toEqual(['s1', '3']);
		expect([v.games, v.collectionCount]).toEqual([3, 1]);
	});

	it('counts the filters, and knows when the list is narrowed', () => {
		const { view: v } = view();
		expect([v.filterCount, v.narrowed]).toEqual([0, false]);
		v.setQuery('  ');
		expect(v.narrowed).toBe(false);
		v.setQuery('x');
		expect([v.filterCount, v.narrowed]).toEqual([0, true]);
		v.toggleOs('linux');
		v.toggleGenre('Strategy');
		v.toggleTogether('coop');
		expect(v.filterCount).toBe(3);
	});

	it('counts the chip "Hide 18+" as a filter, and clears it with the filters', () => {
		const { view: v } = view();
		v.toggleHide18();
		expect(v.hide18).toBe(true);
		expect([v.filterCount, v.narrowed]).toEqual([1, true]);
		expect(v.state.hide18).toBe(true);
		v.toggleHide18();
		expect(v.hide18).toBe(false);
		v.toggleHide18();
		v.clearFilters();
		expect(v.hide18).toBe(false);
		v.toggleHide18();
		v.clearAll();
		expect(v.hide18).toBe(false);
	});

	it('leaves the games for adults out while the chip is on', () => {
		const grown = entry(300, { title: 'Grown Game', adult: true });
		const { view: v } = view({}, [...library, grown]);
		expect(v.cards.some((card) => card.kind === 'game' && card.entry.title === 'Grown Game')).toBe(true);
		v.toggleHide18();
		expect(v.cards.some((card) => card.kind === 'game' && card.entry.title === 'Grown Game')).toBe(false);
		expect(v.games).toBe(library.length);
	});

	it('clears the filters and keeps the search and the order, or clears the search too', () => {
		const { view: v } = view({ q: 'game', os: ['linux'], genres: ['Strategy'], together: ['coop'], sort: 'recent' });
		v.clearFilters();
		expect(v.state).toEqual({ ...DEFAULT_STATE, q: 'game', sort: 'recent' });
		v.toggleOs('linux');
		v.clearAll();
		expect(v.state).toEqual({ ...DEFAULT_STATE, sort: 'recent' });
	});

	it('reports the view as it was before the change, too', () => {
		const before: ViewState[] = [];
		const v = new View(() => library, { ...DEFAULT_STATE, os: ['linux'] }, (_, old) => before.push(old));
		v.setQuery('game');
		v.toggleOs('macos');
		expect(before).toEqual([
			{ ...DEFAULT_STATE, os: ['linux'] },
			{ ...DEFAULT_STATE, q: 'game', os: ['linux'] }
		]);
		// A view read from the address is what the next change starts from.
		v.read({ ...DEFAULT_STATE, sort: 'recent' });
		v.setQuery('x');
		expect(before.at(-1)).toEqual({ ...DEFAULT_STATE, sort: 'recent' });
	});

	it('takes a view from the address without reporting it', () => {
		const { view: v, reported } = view();
		v.read({ ...DEFAULT_STATE, q: 'linux' });
		expect(v.cards.map((c) => c.key)).toEqual(['200']);
		expect(reported).toEqual([]);
	});

	it('keeps the drawn cards when the address holds the view that is shown', () => {
		const { view: v } = view({ q: 'game' });
		v.more();
		v.read({ ...DEFAULT_STATE, q: 'game' });
		expect(v.limit).toBe(2 * BATCH);
		v.read({ ...DEFAULT_STATE, q: 'game 0' });
		expect(v.limit).toBe(BATCH);
	});

	it('does not share its lists with the view it was given', () => {
		const initial = { ...DEFAULT_STATE, os: ['linux' as const] };
		const v = new View(() => library, initial);
		v.toggleOs('macos');
		expect(initial.os).toEqual(['linux']);
	});
});
