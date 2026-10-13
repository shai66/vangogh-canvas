import { describe, expect, it } from 'vitest';
import type { Collection, ListEntry } from '$lib/types';
import { cards } from './cards';
import { query } from './query';
import { DEFAULT_STATE, type ViewState } from './state';

function entry(over: Partial<ListEntry> & { id: string; title: string }): ListEntry {
	return {
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
		order: 0,
		complete: true,
		hasFiles: true,
		collection: null,
		series: null,
		packs: [],
		adult: false,
		...over
	};
}

const thornwick: Collection = {
	id: 's500',
	kind: 'series',
	name: 'Thornwick Mysteries',
	poster: null,
	total: null,
	storeUrl: null,
	joined: [],
	games: ['1', '2', '3']
};
const parallax: Collection = {
	id: 'p800',
	kind: 'pack',
	name: 'Parallax Racing Trilogy',
	poster: null,
	total: 3,
	storeUrl: null,
	joined: [],
	games: ['5', '4']
};
const library = [
	entry({ id: '1', title: 'Thornwick Mysteries', os: ['windows', 'linux'], releaseYear: 1996, order: 6, collection: 's500', series: 'Thornwick Mysteries' }),
	entry({ id: '2', title: 'Thornwick Mysteries 2', releaseYear: 1998, order: 7, collection: 's500', series: 'Thornwick Mysteries', tags: ['Noir'] }),
	entry({ id: '3', title: 'Saltwater Detectives', os: ['windows', 'macos'], releaseYear: 2001, order: 1, collection: 's500', series: 'Thornwick Mysteries', tags: ['Noir'] }),
	entry({ id: '4', title: 'Helix Drift', releaseYear: 2004, order: 4, collection: 'p800', packs: ['Parallax Racing Trilogy'] }),
	entry({ id: '5', title: 'Copper Rally 88', releaseYear: 1988, order: 5, collection: 'p800', packs: ['Parallax Racing Trilogy'] }),
	entry({ id: '6', title: 'Night Ferry', releaseYear: 2015, order: 0 }),
	entry({ id: '7', title: 'Quiet Harbour', os: ['linux'], releaseYear: 2012, order: 3 })
];
const collections = [parallax, thornwick];
const grouped = (state: Partial<ViewState> = {}) => cards(library, collections, { ...DEFAULT_STATE, grouped: true, ...state });
const keys = (state: Partial<ViewState> = {}) => grouped(state).map((c) => c.key);

describe('cards', () => {
	it('gives every match as a game card while the toggle is off', () => {
		const list = cards(library, collections, DEFAULT_STATE);
		expect(list.every((c) => c.kind === 'game')).toBe(true);
		expect(list.map((c) => c.key)).toEqual(['5', '4', '6', '7', '3', '1', '2']);
	});

	it('shows each collection as one card in place of its games, oldest first, and keeps the other games', () => {
		const list = grouped();
		expect(list.map((c) => c.key)).toEqual(['6', 'p800', '7', 's500']);
		const series = list.find((c) => c.key === 's500');
		expect(series?.kind === 'collection' && series.games.map((g) => g.id)).toEqual(['1', '2', '3']);
		expect(series?.kind === 'collection' && series.found).toBeNull();
	});

	it('lets the filters work on games: a collection stands for those that pass, and goes when none does', () => {
		const list = grouped({ os: ['linux'] });
		expect(list.map((c) => c.key)).toEqual(['7', 's500']);
		const series = list.find((c) => c.key === 's500');
		expect(series?.kind === 'collection' && series.games.map((g) => g.id)).toEqual(['1']);
	});

	it('finds a collection by its name, or by a game, and then says which game', () => {
		expect(keys({ q: 'parallax' })).toEqual(['p800']);
		const byGame = grouped({ q: 'saltwater' });
		expect(byGame.map((c) => c.key)).toEqual(['s500']);
		const card = byGame[0];
		expect(card.kind === 'collection' && card.found?.id).toBe('3');
		// It still stands for all its games that pass the filters.
		expect(card.kind === 'collection' && card.games).toHaveLength(3);
		expect(keys({ q: 'nothing like it' })).toEqual([]);
	});

	it('names the oldest game it found, whatever the order of the list', () => {
		for (const sort of ['title', 'recent', 'year'] as const) {
			const card = grouped({ q: 'noir', sort })[0];
			expect(card.kind === 'collection' && card.found?.id).toBe('2');
		}
	});

	it('sorts a collection by its name, its latest purchase and its newest game', () => {
		expect(keys({ sort: 'title' })).toEqual(['6', 'p800', '7', 's500']);
		// The library list is newest first: Night Ferry 0, Saltwater of Thornwick 1, Quiet Harbour 3, Helix of Parallax 4.
		expect(keys({ sort: 'recent' })).toEqual(['6', 's500', '7', 'p800']);
		// Night Ferry 2015, Quiet Harbour 2012, Parallax up to 2004, Thornwick up to 2001.
		expect(keys({ sort: 'year' })).toEqual(['6', '7', 'p800', 's500']);
	});

	it('leaves an entry whose collection is not among the collections as a game card', () => {
		const list = cards(library, [parallax], { ...DEFAULT_STATE, grouped: true });
		expect(list.map((c) => c.key)).toEqual(['6', 'p800', '7', '3', '1', '2']);
	});
});

describe('speed with the toggle on', () => {
	const library: ListEntry[] = Array.from({ length: 5000 }, (_, i) =>
		entry({ id: String(i), title: `Game ${i} ${i % 3 === 0 ? 'Harbour' : 'Meadow'}`, order: i, collection: i % 8 === 0 ? `c${i / 8}` : null })
	);
	const many: Collection[] = Array.from({ length: 625 }, (_, k) => ({
		id: `c${k}`,
		kind: 'series' as const,
		name: `Series ${k}`,
		poster: null,
		total: null,
		storeUrl: null,
		joined: [],
		games: [String(k * 8)]
	}));
	const average = (grouped: boolean) => {
		const words = ['harbour', 'game 12', 'meadow', 'series 4'];
		const start = performance.now();
		for (const q of words) cards(library, many, { ...DEFAULT_STATE, grouped, q });
		return (performance.now() - start) / words.length;
	};

	it('groups a large library about as fast as it lists it', () => {
		average(true);
		average(false);
		expect(average(true)).toBeLessThan(average(false) * 3);
	});

	it('returns the matches in the order of the entries when it is told not to sort', () => {
		const given = [entry({ id: 'z', title: 'Zeta', order: 2 }), entry({ id: 'a', title: 'Alpha', order: 1 })];
		expect(query(given, DEFAULT_STATE, false).map((m) => m.entry.id)).toEqual(['z', 'a']);
		expect(query(given, DEFAULT_STATE).map((m) => m.entry.id)).toEqual(['a', 'z']);
	});
});
