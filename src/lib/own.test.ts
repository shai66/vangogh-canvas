import { describe, expect, it } from 'vitest';
import type { Collection, ListEntry } from '$lib/types';
import {
	bandsOf,
	isOwnId,
	ownName,
	ownNamesByEntry,
	parseCreateBody,
	parseMember,
	parsePatchBody,
	resolveOwn,
	sameMember,
	sameName,
	type OwnCollection,
	type OwnMember,
	type ShownOwn
} from './own';

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
		groups: [],
		adult: false,
		...over
	};
}

// A series that a pack joined: found by either id.
const thornwick: Collection = {
	id: 's7',
	kind: 'collection',
	name: 'Thornwick Mysteries',
	poster: null,
	total: null,
	storeUrl: null,
	joined: [{ kind: 'pack', name: 'Thornwick Casebook' }],
	groups: ['s7', 'p900'],
	games: ['1', '2', '3']
};
const library = [
	entry({ id: '1', title: 'Thornwick Mysteries', releaseYear: 1996, banner: 'b1', poster: 'p1', collection: 's7', groups: ['s7', 'p900'] }),
	entry({ id: '2', title: 'Thornwick Mysteries 2', releaseYear: 1998, banner: 'b2', poster: 'p2', collection: 's7', groups: ['s7'] }),
	entry({ id: '3', title: 'Saltwater Detectives', releaseYear: 2001, collection: 's7', groups: ['p900'] }),
	// A series GOG's collections no longer hold: its games stand in for it.
	entry({ id: '4', title: 'Copper Rally 88', releaseYear: 1988, groups: ['s8'] }),
	entry({ id: '5', title: 'Helix Drift', releaseYear: 2004, groups: ['s8'] }),
	entry({ id: '6', title: 'Night Ferry', releaseYear: 2015, banner: 'b6' }),
	entry({ id: '7', title: 'Quiet Harbour' }),
	entry({ id: '8', title: 'Amber Coast', releaseYear: 1996 }),
	entry({ id: '10', title: 'Harbour 10', releaseYear: 2015 }),
	entry({ id: '11', title: 'Harbour 9', releaseYear: 2015 }),
	entry({ id: '12', title: 'The Lantern', releaseYear: 2015, poster: 'p12' }),
	entry({ id: '13', title: 'Velvet Alley', releaseYear: 2010, adult: true })
];
const collections = [thornwick];
const own = (...members: OwnMember[]): OwnCollection => ({ id: 'h1', name: 'Party night', members });
const shown = (...members: OwnMember[]): ShownOwn => resolveOwn([own(...members)], library, collections)[0];
const keys = (s: ShownOwn) => s.members.map((m) => (m.kind === 'game' ? m.entry.id : m.collection.id));
const ids = (games: ListEntry[]) => games.map((g) => g.id);

describe('names', () => {
	it('trims and bounds a name', () => {
		expect(ownName('  Party night ')).toBe('Party night');
		expect(ownName('   ')).toBeNull();
		expect(ownName('x'.repeat(60))).toHaveLength(60);
		expect(ownName('x'.repeat(61))).toBeNull();
		expect(ownName(7)).toBeNull();
	});
	it('ignores letter case', () => {
		expect(sameName('Party Night', ' party night')).toBe(true);
		expect(sameName('Party night', 'Party nights')).toBe(false);
	});
	it('knows an own id', () => {
		expect(isOwnId('h3')).toBe(true);
		expect(isOwnId('s3')).toBe(false);
		expect(isOwnId('h')).toBe(false);
		expect(isOwnId('h3x')).toBe(false);
	});
});

describe('members', () => {
	it('takes a game or a series or a pack, and nothing else', () => {
		expect(parseMember({ game: '12' })).toEqual({ game: '12' });
		expect(parseMember({ collection: 's5' })).toEqual({ collection: 's5' });
		expect(parseMember({ collection: 'p900' })).toEqual({ collection: 'p900' });
		for (const bad of [{ collection: 'h2' }, { game: 'x1' }, { game: 12 }, { game: '' }, { game: '1', collection: 's5' }, { game: '1', note: 'x' }, '12', null, [{ game: '1' }]]) {
			expect(parseMember(bad)).toBeNull();
		}
	});
	it('tells the same member', () => {
		expect(sameMember({ game: '1' }, { game: '1' })).toBe(true);
		expect(sameMember({ collection: 's1' }, { collection: 's1' })).toBe(true);
		expect(sameMember({ game: '1' }, { game: '2' })).toBe(false);
		expect(sameMember({ collection: 's1' }, { collection: 'p1' })).toBe(false);
	});
});

describe('bodies', () => {
	it('takes a game and a series, and refuses an own collection as a member', () => {
		expect(parseCreateBody({ name: 'A', members: [{ game: '12' }, { collection: 's5' }, { game: '12' }] })).toEqual({ name: 'A', members: [{ game: '12' }, { collection: 's5' }] });
		expect(parseCreateBody({ name: 'A', members: [{ collection: 'h2' }] })).toBeNull();
		expect(parsePatchBody({ name: 'B', add: [] })).toBeNull();
		expect(parsePatchBody({ remove: [{ game: '1' }] })).toEqual({ remove: [{ game: '1' }] });
	});
	it('trims the name of a new collection and refuses one without a name or a list of members', () => {
		expect(parseCreateBody({ name: '  Rainy Sundays ', members: [] })).toEqual({ name: 'Rainy Sundays', members: [] });
		expect(parseCreateBody({ name: '  ', members: [] })).toBeNull();
		expect(parseCreateBody({ name: 'A' })).toBeNull();
		expect(parseCreateBody({ name: 'A', members: { game: '1' } })).toBeNull();
		expect(parseCreateBody(null)).toBeNull();
	});
	it('takes exactly one change, its members once', () => {
		expect(parsePatchBody({ name: ' B ' })).toEqual({ name: 'B' });
		expect(parsePatchBody({ add: [{ collection: 'p900' }, { collection: 'p900' }] })).toEqual({ add: [{ collection: 'p900' }] });
		expect(parsePatchBody({ name: '' })).toBeNull();
		expect(parsePatchBody({ remove: [{ game: '1' }, { game: 'x' }] })).toBeNull();
		expect(parsePatchBody({})).toBeNull();
		expect(parsePatchBody({ add: [], remove: [] })).toBeNull();
	});
});

describe('resolveOwn', () => {
	it('finds a GOG member through a joined group', () => {
		const [member] = shown({ collection: 'p900' }).members;
		expect(member.kind).toBe('collection');
		expect(member.stored).toEqual({ collection: 'p900' });
		expect(member.kind === 'collection' && member.collection.id).toBe('s7');
		expect(member.kind === 'collection' && ids(member.games)).toEqual(['1', '2', '3']);
	});
	it('stands the games of a group in when no collection holds it', () => {
		const s = shown({ collection: 's8' });
		expect(s.members.map((m) => m.kind)).toEqual(['game', 'game']);
		expect(keys(s)).toEqual(['4', '5']);
		expect(s.members.every((m) => sameMember(m.stored, { collection: 's8' }))).toBe(true);
	});
	it('leaves out a member not in the library', () => {
		const s = shown({ game: '999' }, { collection: 's404' }, { game: '6' });
		expect(keys(s)).toEqual(['6']);
		expect(ids(s.games)).toEqual(['6']);
	});
	it('counts a game once that is both a member and in a GOG member', () => {
		const s = shown({ game: '2' }, { collection: 's7' });
		expect(keys(s)).toEqual(['s7', '2']);
		expect(ids(s.games)).toEqual(['1', '2', '3']);
	});
	it('shows each game and each GOG collection once among the members', () => {
		expect(keys(shown({ game: '4' }, { collection: 's8' }))).toEqual(['4', '5']);
		expect(shown({ game: '4' }, { collection: 's8' }).members[0].stored).toEqual({ game: '4' });
		expect(keys(shown({ collection: 's7' }, { collection: 'p900' }))).toEqual(['s7']);
	});
	it('orders members by their oldest year, then title, no year last', () => {
		const s = shown({ game: '7' }, { game: '6' }, { game: '12' }, { game: '10' }, { collection: 's7' }, { game: '11' }, { game: '8' });
		expect(keys(s)).toEqual(['8', 's7', '11', '10', '12', '6', '7']);
		expect(ids(s.games)).toEqual(['8', '1', '2', '3', '11', '10', '12', '6', '7']);
	});
	it('keeps an empty collection', () => expect(resolveOwn([{ id: 'h1', name: 'E', members: [] }], [], [])[0].games).toEqual([]));
	it('keeps the id and the name, and every collection in the given order', () => {
		const list = resolveOwn([own({ game: '6' }), { id: 'h4', name: 'Rainy Sundays', members: [] }], library, collections);
		expect(list.map((o) => [o.id, o.name])).toEqual([
			['h1', 'Party night'],
			['h4', 'Rainy Sundays']
		]);
	});
});

describe('bandsOf', () => {
	const sevenGames = shown({ game: '8' }, { game: '4' }, { game: '2' }, { game: '3' }, { game: '5' }, { game: '6' }, { game: '7' });
	const withSeries = shown({ collection: 's7' }, { game: '6' });
	it('gives at most six, in the members order', () => {
		expect(bandsOf(sevenGames, false)).toHaveLength(6);
		// 1988, 1996, 1998, 2001, 2004, 2015; the game without a year is the seventh.
		expect(bandsOf(sevenGames, false).map((b) => b.title)).toEqual(['Copper Rally 88', 'Amber Coast', 'Thornwick Mysteries 2', 'Saltwater Detectives', 'Helix Drift', 'Night Ferry']);
	});
	it('gives a game its own images and title', () => expect(bandsOf(withSeries, false)[1]).toEqual({ banner: 'b6', poster: null, title: 'Night Ferry', nested: null }));
	it('marks a GOG member with its number of games', () => {
		expect(bandsOf(withSeries, false)[0]).toMatchObject({ nested: 3, title: 'Thornwick Mysteries' });
		expect(bandsOf(withSeries, false)[0]).toEqual({ banner: 'b1', poster: 'p1', title: 'Thornwick Mysteries', nested: 3 });
	});
	it('leaves out what Hide 18+ hides', () => {
		const adultFirst = library.map((e) => (e.id === '1' ? { ...e, adult: true } : e));
		const s = resolveOwn([own({ collection: 's7' }, { game: '13' }, { game: '6' })], adultFirst, collections)[0];
		expect(bandsOf(s, false).map((b) => b.title)).toEqual(['Thornwick Mysteries', 'Velvet Alley', 'Night Ferry']);
		expect(bandsOf(s, true)).toEqual([
			{ banner: 'b2', poster: 'p2', title: 'Thornwick Mysteries', nested: 2 },
			{ banner: 'b6', poster: null, title: 'Night Ferry', nested: null }
		]);
		const allAdult = library.map((e) => (['1', '2', '3'].includes(e.id) ? { ...e, adult: true } : e));
		expect(bandsOf(resolveOwn([own({ collection: 's7' })], allAdult, collections)[0], true)).toEqual([]);
	});
	it('fills six bands with what Hide 18+ leaves', () => {
		const eight = shown({ game: '13' }, { game: '8' }, { game: '4' }, { game: '2' }, { game: '3' }, { game: '5' }, { game: '6' }, { game: '7' });
		expect(bandsOf(eight, false).map((b) => b.title)).toEqual(['Copper Rally 88', 'Amber Coast', 'Thornwick Mysteries 2', 'Saltwater Detectives', 'Helix Drift', 'Velvet Alley']);
		expect(bandsOf(eight, true).map((b) => b.title)).toEqual(['Copper Rally 88', 'Amber Coast', 'Thornwick Mysteries 2', 'Saltwater Detectives', 'Helix Drift', 'Night Ferry']);
	});
});

describe('ownNamesByEntry', () => {
	it('names the own collections that hold a game, A to Z', () => {
		const list = resolveOwn(
			[
				{ id: 'h1', name: 'Rainy Sundays', members: [{ collection: 's7' }, { game: '6' }] },
				{ id: 'h2', name: 'Party night', members: [{ game: '2' }] },
				{ id: 'h3', name: 'The Attic', members: [{ game: '2' }] },
				{ id: 'h4', name: 'Empty', members: [] }
			],
			library,
			collections
		);
		const names = ownNamesByEntry(list);
		// As "A to Z" sorts: without a leading "The".
		expect(names.get('2')).toEqual(['The Attic', 'Party night', 'Rainy Sundays']);
		expect(names.get('6')).toEqual(['Rainy Sundays']);
		expect(names.has('7')).toBe(false);
	});
});
