import { describe, expect, it } from 'vitest';
import type { Detail, FileEntry, ListEntry } from '../types';
import { glanceFor, glanceOf } from './glance';
import { INDEX_SCHEMA, type Index } from './index-types';

const MB = 1024 ** 2;

function entry(id: string, o: Partial<ListEntry> = {}): ListEntry {
	return {
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
		...o
	};
}

function file(fileId: string, mb: number): FileEntry {
	return { fileId, name: fileId, filename: `${fileId}.bin`, version: '1.0', sizeText: `${mb} MB`, sizeBytes: mb * MB, run: true };
}

function detail(e: ListEntry, o: Partial<Detail> = {}): Detail {
	const { dlc: _titles, ...shared } = e;
	return {
		...shared,
		description: '',
		languages: [],
		features: [],
		screenshots: [],
		backdrop: null,
		macNotice: null,
		requirements: {},
		storeUrl: null,
		downloads: {},
		downloadLanguage: null,
		dlc: [],
		extras: [],
		requires: null,
		...o
	};
}

/** A library of entries, each with its detail. */
function library(...games: [ListEntry, Partial<Detail>?][]): Pick<Index, 'entries' | 'details'> {
	return {
		entries: games.map(([e]) => e),
		details: Object.fromEntries(games.map(([e, d]) => [e.id, detail(e, d)]))
	};
}

describe('glanceOf', () => {
	it("adds up the files in the archive by system, a DLC's with its system, and the extras apart", () => {
		const glance = glanceOf(
			library(
				[
					entry('1', { os: ['windows'] }),
					{
						downloads: { windows: [file('w1', 100), file('w2', 200)], macos: [file('m1', 300)], linux: [file('l1', 400)] },
						dlc: [{ title: 'Expansion', downloads: { windows: [file('d1', 50)], linux: [file('d2', 60)] } }],
						extras: [{ fileId: 'x1', name: 'manual', kind: 'manuals', sizeText: '12 MB', sizeBytes: 12 * MB }]
					}
				],
				// Another game may use the same file id: it is another file.
				[entry('2'), { downloads: { windows: [file('w1', 1)] } }]
			)
		);
		// The space follows the files: the first game's list names Windows only.
		expect(glance.bytes).toEqual({ windows: 351 * MB, macos: 300 * MB, linux: 460 * MB });
		expect(glance.extrasBytes).toBe(12 * MB);
		expect(glance.systems).toEqual({ windows: 2, macos: 0, linux: 0 });
	});

	it('adds a file that a record lists twice once, and a size it cannot read as nothing', () => {
		const glance = glanceOf(
			library([
				entry('1'),
				{
					downloads: {
						windows: [
							file('w1', 100),
							file('w1', 100),
							{ ...file('w2', 5), sizeBytes: 0 },
							{ ...file('w3', 5), sizeBytes: Number.NaN },
							{ ...file('w4', 5), sizeBytes: -1 }
						]
					},
					dlc: [{ title: 'Again', downloads: { windows: [file('w1', 100)] } }],
					extras: [{ fileId: 'x1', name: 'avatars', kind: 'avatars', sizeText: '', sizeBytes: 0 }]
				}
			])
		);
		expect(glance.bytes.windows).toBe(100 * MB);
		expect(glance.extrasBytes).toBe(0);
	});

	it('counts the games of each system as the platform filter does, by the list of the entry', () => {
		const glance = glanceOf(
			library([entry('1', { os: ['windows'] })], [entry('2', { os: ['windows', 'linux'] })], [entry('3', { os: ['macos'] })], [entry('4', { os: [] })])
		);
		expect(glance.systems).toEqual({ windows: 2, macos: 1, linux: 1 });
	});

	it('counts the games by decade from the first to the last, an empty one as 0, and those without a year apart', () => {
		const y = (id: string, releaseYear: number | null): [ListEntry] => [entry(id, { releaseYear })];
		const glance = glanceOf(library(y('1', 1988), y('2', 1996), y('3', 1999), y('4', 2015), y('5', null), y('6', null)));
		expect(glance.decades).toEqual([
			[1980, 1],
			[1990, 2],
			[2000, 0],
			[2010, 1]
		]);
		expect(glance.noYear).toBe(2);
	});

	it('has no decades when no game has a year', () => {
		const glance = glanceOf(library([entry('1')], [entry('2')]));
		expect(glance.decades).toEqual([]);
		expect(glance.noYear).toBe(2);
	});

	it('counts the genres of the group "genre" once per game, the six most first, ties A to Z', () => {
		const g = (id: string, genres: string[]): [ListEntry] => [entry(id, { genres })];
		const glance = glanceOf(
			library(
				g('1', ['Action', 'Fantasy', 'FPP']),
				g('2', ['Action', 'Action']),
				g('3', ['Strategy']),
				g('4', ['Simulation']),
				g('5', ['Shooter']),
				g('6', ['Racing']),
				g('7', ['Puzzle']),
				g('8', ['Adventure', 'Turn-based'])
			)
		);
		expect(glance.genres).toEqual([
			['Action', 2],
			['Adventure', 1],
			['Puzzle', 1],
			['Racing', 1],
			['Shooter', 1],
			['Simulation', 1]
		]);
	});

	it('gives fewer genres when the library has fewer', () => {
		const glance = glanceOf(library([entry('1', { genres: ['Puzzle'] })], [entry('2', { genres: ['Puzzle', 'Horror'] })]));
		expect(glance.genres).toEqual([['Puzzle', 2]]);
	});

	it('gives nothing for an empty library', () => {
		expect(glanceOf({ entries: [], details: {} })).toEqual({
			bytes: { windows: 0, macos: 0, linux: 0 },
			extrasBytes: 0,
			systems: { windows: 0, macos: 0, linux: 0 },
			decades: [],
			noYear: 0,
			genres: []
		});
	});

	it('survives a game without a detail and a detail that is broken', () => {
		const broken = {
			downloads: { windows: 'nonsense', macos: [null, file('m1', 7)] },
			dlc: [null, { title: 'No downloads' }],
			extras: [null, { fileId: 'x1', sizeBytes: 3 * MB }]
		} as unknown as Partial<Detail>;
		const lib = library([entry('1', { releaseYear: 2001, genres: ['Puzzle'] }), broken], [entry('2', { releaseYear: 2003 })]);
		delete lib.details['2'];
		const glance = glanceOf(lib);
		expect(glance.bytes).toEqual({ windows: 0, macos: 7 * MB, linux: 0 });
		expect(glance.extrasBytes).toBe(3 * MB);
		expect(glance.decades).toEqual([[2000, 2]]);
		expect(glance.genres).toEqual([['Puzzle', 1]]);
		const nulls = library([entry('3'), { downloads: null, dlc: null, extras: null } as unknown as Partial<Detail>]);
		expect(() => glanceOf(nulls)).not.toThrow();
	});
});

describe('glanceFor', () => {
	it('works the glance out once per index, and again for a new one', () => {
		const index: Index = {
			schema: INDEX_SCHEMA,
			builtAt: '2026-10-04T04:30:00.000Z',
			version: 'v1',
			...library([entry('1', { releaseYear: 1999 })]),
			files: {},
			collections: []
		};
		const first = glanceFor(index);
		expect(glanceFor(index)).toBe(first);
		const rebuilt: Index = { ...index, version: 'v2' };
		expect(glanceFor(rebuilt)).not.toBe(first);
		expect(glanceFor(rebuilt)).toEqual(first);
	});
});
