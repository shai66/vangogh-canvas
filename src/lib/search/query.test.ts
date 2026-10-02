import { describe, expect, it } from 'vitest';
import type { ListEntry } from '$lib/types';
import { allGenres, genreFacets, matchEntry, query } from './query';
import { DEFAULT_STATE } from './state';
import { existsSync, readFileSync } from 'node:fs';
import { buildIndex } from '$lib/server/indexer';
import { silentLogger } from '$lib/server/log';

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
		...over
	};
}

const witcher = entry({
	id: '1',
	title: 'The Witcher 3: Wild Hunt',
	os: ['windows'],
	genres: ['Role-playing'],
	tags: ['Story Rich', 'Fantasy'],
	developers: ['CD PROJEKT RED'],
	publisher: 'CD PROJEKT',
	dlc: ['Blood and Wine', 'Hearts of Stone'],
	order: 0
});
const civ = entry({
	id: '2',
	title: 'Alpha Centauri',
	os: ['windows', 'linux'],
	genres: ['Strategy'],
	tags: ['Turn-Based'],
	developers: ['Firaxis'],
	order: 1
});
const stastny = entry({
	id: '3',
	title: 'Šťastný útek',
	os: ['macos', 'linux'],
	genres: ['Adventure', 'Strategy'],
	order: 2
});
const all = [witcher, civ, stastny];

describe('matchEntry', () => {
	it('matches everything when nothing is typed', () => {
		expect(matchEntry(civ, [])).toEqual({ entry: civ, reason: null });
	});

	it('finds every word in any order', () => {
		expect(matchEntry(witcher, ['wild', 'witch'])).toEqual({ entry: witcher, reason: null });
		expect(matchEntry(witcher, ['witch', 'tame'])).toBeNull();
	});

	it('ignores accents in the title and in what was typed', () => {
		expect(matchEntry(stastny, ['stastny'])).not.toBeNull();
		expect(matchEntry(civ, ['álpha'].map((w) => w.normalize('NFD').replace(/\p{M}/gu, '')))).not.toBeNull();
	});

	it.each([
		['wine', { field: 'dlc', value: 'Blood and Wine' }],
		['role', { field: 'genre', value: 'Role-playing' }],
		['fantasy', { field: 'tag', value: 'Fantasy' }],
		['red', { field: 'developer', value: 'CD PROJEKT RED' }],
		['projekt', { field: 'developer', value: 'CD PROJEKT RED' }]
	])('says why "%s" matched', (word, reason) => {
		expect(matchEntry(witcher, [word])?.reason).toEqual(reason);
	});

	it('finds a genre by the name it is shown by, and by the name GOG gives it', () => {
		const shooter = entry({ id: '9', title: 'X', genres: ['FPP', 'Detective-mystery'] });
		expect(matchEntry(shooter, ['first'])?.reason).toEqual({ field: 'genre', value: 'First-person' });
		expect(matchEntry(shooter, ['fpp'])?.reason).toEqual({ field: 'genre', value: 'FPP' });
		expect(matchEntry(shooter, ['detective'])?.reason).toEqual({
			field: 'genre',
			value: 'Detective-mystery'
		});
		expect(matchEntry(shooter, ['third'])).toBeNull();
	});

	it('names the publisher when nothing else holds the word', () => {
		const game = entry({ id: '9', title: 'X', publisher: 'Small Press' });
		expect(matchEntry(game, ['press'])?.reason).toEqual({ field: 'publisher', value: 'Small Press' });
	});

	it('gives no reason when the title holds every word', () => {
		const game = entry({ id: '9', title: 'Fantasy General', tags: ['Fantasy'] });
		expect(matchEntry(game, ['fantasy'])?.reason).toBeNull();
	});

	it('combines the title with another field, and names the other field', () => {
		expect(matchEntry(witcher, ['witcher', 'stone'])?.reason).toEqual({
			field: 'dlc',
			value: 'Hearts of Stone'
		});
	});
});

describe('query', () => {
	const ids = (state: Partial<typeof DEFAULT_STATE>) =>
		query(all, { ...DEFAULT_STATE, ...state }).map((m) => m.entry.id);

	it('sorts by title, ignoring accents and a leading "The"', () => {
		expect(ids({})).toEqual(['2', '3', '1']);
	});

	it('sorts by the title without a leading "The"', () => {
		const theAbc = entry({ id: 'a', title: 'The Abc', order: 0 });
		const bcd = entry({ id: 'b', title: 'Bcd', order: 1 });
		expect(query([bcd, theAbc], DEFAULT_STATE).map((m) => m.entry.title)).toEqual(['The Abc', 'Bcd']);
	});

	it('finds a title whatever the case and the accents of what was typed', () => {
		expect(ids({ q: 'ÁLPHA' })).toEqual(['2']);
		expect(ids({ q: 'ŠŤASTNÝ' })).toEqual(['3']);
	});

	it('finds titles with letters that do not decompose', () => {
		const lodz = entry({ id: 'l', title: 'Łódź Nights' });
		const strasse = entry({ id: 's', title: 'Die Straße' });
		const both = [lodz, strasse];
		expect(query(both, { ...DEFAULT_STATE, q: 'lodz' }).map((m) => m.entry.id)).toEqual(['l']);
		expect(query(both, { ...DEFAULT_STATE, q: 'strasse' }).map((m) => m.entry.id)).toEqual(['s']);
	});

	it('sorts the most recent first', () => {
		expect(ids({ sort: 'recent' })).toEqual(['1', '2', '3']);
	});

	it('sorts by release year, newest first, a game without a year last, and equal years by title', () => {
		const older = entry({ id: 'o', title: 'Older', releaseYear: 1998 });
		const newer = entry({ id: 'n', title: 'Newer', releaseYear: 2015 });
		const same = entry({ id: 's', title: 'The Also', releaseYear: 2015 });
		const none = entry({ id: 'x', title: 'Aardvark' });
		const alsoNone = entry({ id: 'y', title: 'Zebra' });
		const sorted = query([alsoNone, none, older, newer, same], { ...DEFAULT_STATE, sort: 'year' });
		// "The Also" sorts as "Also", before "Newer"; two games without a year go by title.
		expect(sorted.map((m) => m.entry.id)).toEqual(['s', 'n', 'o', 'x', 'y']);
	});

	it('filters by any of the chosen systems', () => {
		expect(ids({ os: ['linux'] })).toEqual(['2', '3']);
		expect(ids({ os: ['macos', 'windows'] })).toEqual(['2', '3', '1']);
	});

	it('filters by any of the chosen genres, whatever their case', () => {
		expect(ids({ genres: ['strategy'] })).toEqual(['2', '3']);
		expect(ids({ genres: ['Adventure', 'Role-playing'] })).toEqual(['3', '1']);
	});

	it('needs every group of genres to hold, and any genre within a group', () => {
		const fantasyStrategy = entry({ id: 'fs', title: 'A', genres: ['Strategy', 'Fantasy', 'Turn-based'] });
		const scifiStrategy = entry({ id: 'ss', title: 'B', genres: ['Strategy', 'Sci-fi', 'Real-time'] });
		const fantasyRpg = entry({ id: 'fr', title: 'C', genres: ['Role-playing', 'Fantasy'] });
		const games = [fantasyStrategy, scifiStrategy, fantasyRpg];
		const found = (genres: string[]) =>
			query(games, { ...DEFAULT_STATE, genres }).map((m) => m.entry.id);

		expect(found(['Strategy'])).toEqual(['fs', 'ss']);
		expect(found(['Fantasy'])).toEqual(['fs', 'fr']);
		// A genre and a setting: both must hold.
		expect(found(['Strategy', 'Fantasy'])).toEqual(['fs']);
		// Two genres: either is enough.
		expect(found(['Strategy', 'Role-playing'])).toEqual(['fs', 'ss', 'fr']);
		// Two settings and a genre.
		expect(found(['Fantasy', 'Sci-fi', 'Strategy'])).toEqual(['fs', 'ss']);
		// All three groups.
		expect(found(['strategy', 'FANTASY', 'turn-based'])).toEqual(['fs']);
		expect(found(['Strategy', 'Fantasy', 'Real-time'])).toEqual([]);
	});

	it('finds nothing for a genre the library does not have', () => {
		expect(ids({ genres: ['Visual Novel'] })).toEqual([]);
		expect(ids({ genres: ['constructor'] })).toEqual([]);
	});

	it('filters by any of the chosen ways of playing together', () => {
		const solo = entry({ id: 's', title: 'A' });
		const coop = entry({ id: 'c', title: 'B', coop: true });
		const multi = entry({ id: 'm', title: 'C', multiplayer: true });
		const games = [solo, coop, multi];
		const found = (together: ('multiplayer' | 'coop')[]) =>
			query(games, { ...DEFAULT_STATE, together }).map((m) => m.entry.id);
		expect(found([])).toEqual(['s', 'c', 'm']);
		expect(found(['coop'])).toEqual(['c']);
		expect(found(['coop', 'multiplayer'])).toEqual(['c', 'm']);
	});

	it('needs both filters to hold', () => {
		expect(ids({ os: ['macos'], genres: ['Strategy'] })).toEqual(['3']);
		expect(ids({ os: ['windows'], genres: ['Adventure'] })).toEqual([]);
	});

	it('combines search and filters', () => {
		expect(ids({ q: 'turn', os: ['linux'] })).toEqual(['2']);
		expect(ids({ q: 'turn', os: ['macos'] })).toEqual([]);
	});

	it('does not change the list it was given', () => {
		const before = all.map((e) => e.id);
		query(all, { ...DEFAULT_STATE, sort: 'recent' });
		expect(all.map((e) => e.id)).toEqual(before);
	});

	it('takes typed text as text, not as a pattern', () => {
		expect(ids({ q: '.*' })).toEqual([]);
		expect(ids({ q: '3:' })).toEqual(['1']);
	});
});

describe('allGenres', () => {
	it('lists each genre once, in alphabetical order', () => {
		expect(allGenres(all)).toEqual(['Adventure', 'Role-playing', 'Strategy']);
	});
});

describe('genreFacets', () => {
	it('counts the genres by group, the most common first', () => {
		const games = [
			entry({ id: '1', title: 'A', genres: ['Strategy', 'Fantasy', 'Turn-based'] }),
			entry({ id: '2', title: 'B', genres: ['Strategy', 'Sci-fi'] }),
			entry({ id: '3', title: 'C', genres: ['Action', 'Fantasy', 'FPP', 'Fantasy'] })
		];
		expect(genreFacets(games)).toEqual({
			genre: [
				{ genre: 'Strategy', count: 2 },
				{ genre: 'Action', count: 1 }
			],
			setting: [
				{ genre: 'Fantasy', count: 2 },
				{ genre: 'Sci-fi', count: 1 }
			],
			style: [
				{ genre: 'FPP', count: 1 },
				{ genre: 'Turn-based', count: 1 }
			]
		});
	});

	it('gives three empty groups for an empty library', () => {
		expect(genreFacets([])).toEqual({ genre: [], setting: [], style: [] });
	});
});

describe.skipIf(!existsSync('samples/available-products.json'))('query on the real library', () => {
	const read = (path: string): unknown | null =>
		existsSync(`samples/${path}`) ? JSON.parse(readFileSync(`samples/${path}`, 'utf8')) : null;

	it('filters the whole library in well under a keystroke', async () => {
		const index = await buildIndex(
			{
				availableProducts: async () => read('available-products.json'),
				metadata: async (type, id) => read(`metadata/${type}/${id}.json`),
				filenames: async (id) => (read(`filenames/${id}.json`) ?? {}) as Record<string, string>,
				fileOnDisk: async () => null
			},
			silentLogger
		);
		const began = performance.now();
		for (const q of ['t', 'th', 'the', 'the w', 'strategy', 'turn based', 'zzzz']) {
			query(index.entries, { ...DEFAULT_STATE, q });
		}
		const each = (performance.now() - began) / 7;
		console.log(`${index.entries.length} entries, ${each.toFixed(2)} ms for one search`);
		console.log('genres:', allGenres(index.entries).join(', '));
		expect(each).toBeLessThan(16);
	});
});
