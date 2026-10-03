import { describe, expect, it } from 'vitest';
import { gamesOf, systemsOf, yearSpan } from './collections';
import type { Collection, ListEntry } from './types';

const game = (id: string, over: Partial<ListEntry> = {}): ListEntry => ({
	id,
	title: `Game ${id}`,
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
	...over
});

describe('yearSpan', () => {
	it('gives the first and the last year, one year, or nothing', () => {
		expect(yearSpan([game('1', { releaseYear: 1997 }), game('2', { releaseYear: 1991 }), game('3')])).toBe('1991–1997');
		expect(yearSpan([game('1', { releaseYear: 1997 }), game('2', { releaseYear: 1997 })])).toBe('1997');
		expect(yearSpan([game('1')])).toBe('');
		expect(yearSpan([])).toBe('');
	});
});

describe('systemsOf', () => {
	it('names every system any of the games is for, in the fixed order', () => {
		expect(systemsOf([game('1', { os: ['linux'] }), game('2', { os: ['macos', 'windows'] })])).toEqual(['windows', 'macos', 'linux']);
		expect(systemsOf([game('1', { os: [] })])).toEqual([]);
	});
});

describe('gamesOf', () => {
	it("gives the collection's entries in its order, and leaves out an id that is not in the list", () => {
		const collection: Collection = { id: 's1', kind: 'series', name: 'Dusk', poster: null, total: null, storeUrl: null, joined: [], games: ['3', '9', '1'] };
		expect(gamesOf(collection, [game('1'), game('2'), game('3')]).map((g) => g.id)).toEqual(['3', '1']);
	});
});
