import { describe, expect, it } from 'vitest';
import { collect, type Member, type PackRecord } from './collections';

const game = (id: string, over: Partial<Member> = {}): Member => ({
	id,
	title: `Game ${id}`,
	releaseYear: null,
	storeUrl: null,
	series: null,
	...over
});
const pack = (id: string, includes: string[], over: Partial<PackRecord> = {}): PackRecord => ({
	id,
	name: `Pack ${id}`,
	poster: null,
	storeUrl: null,
	includes,
	...over
});
const dusk = { id: '77', name: 'Dusk' };
const at = 'https://www.gog.com/en/game';

describe('collect', () => {
	it('gives nothing for an empty library', () => {
		const { collections, of } = collect([], []);
		expect(collections).toEqual([]);
		expect(of.size).toBe(0);
	});

	it('makes a collection of a series that holds two games of the library, and none of a series of one', () => {
		const { collections, of } = collect(
			[game('1', { series: dusk }), game('2', { series: dusk }), game('3', { series: { id: '78', name: 'Lone' } })],
			[]
		);
		expect(collections).toEqual([
			{ id: 's77', kind: 'series', name: 'Dusk', poster: null, total: null, storeUrl: null, joined: [], games: ['1', '2'] }
		]);
		expect(of.get('1')).toEqual({ collection: 's77', series: 'Dusk', packs: [] });
		// A series of one is no collection, and its name still finds the game.
		expect(of.get('3')).toEqual({ collection: null, series: 'Lone', packs: [] });
	});

	// Review focus 1
	it('reads a pack inside a pack, two levels deep, and survives loops and repeated links', () => {
		// 900 holds 1 and 901; 901 holds 2 and 902; 902 holds 3, and 900 again. 903 holds itself, 4 twice, and 5.
		const packs = [
			pack('900', ['1', '901']),
			pack('901', ['2', '902']),
			pack('902', ['3', '900']),
			pack('903', ['903', '4', '4', '5'])
		];
		const { collections } = collect(['1', '2', '3', '4', '5'].map((id) => game(id)), packs);
		const outer = collections.find((c) => c.id === 'p900');
		expect(outer).toMatchObject({ kind: 'pack', total: 3, games: ['1', '2', '3'] });
		// Each of the three holds all three games through the others; they tie and go by name.
		expect(outer?.joined).toEqual([
			{ kind: 'pack', name: 'Pack 901' },
			{ kind: 'pack', name: 'Pack 902' }
		]);
		expect(collections.find((c) => c.id === 'p903')).toMatchObject({ total: 2, games: ['4', '5'] });
	});

	it('counts a link to a product it has not read as one game', () => {
		const { collections } = collect([game('1'), game('2')], [pack('900', ['1', '2', '777'])]);
		expect(collections[0]).toMatchObject({ id: 'p900', total: 3, games: ['1', '2'] });
	});

	it('keeps a pack the library holds half of, and leaves out one it holds less of', () => {
		const library = ['1', '2', '3', '4'].map((id) => game(id));
		const { collections, of } = collect(library, [pack('900', ['1', '2', '98', '99']), pack('901', ['3', '4', '95', '96', '97'])]);
		expect(collections.map((c) => c.id)).toEqual(['p900']);
		expect(of.get('3')).toEqual({ collection: null, series: null, packs: [] });
	});

	it('counts only the games of the library', () => {
		// 50 is not in the library: a nested DLC, or a product left out of the list.
		const { collections, of } = collect([game('1'), game('2')], [pack('900', ['1', '50'])]);
		expect(collections).toEqual([]);
		expect(of.get('1')?.packs).toEqual(['Pack 900']);
	});

	it("gives the pack's page to the collection only when a game has the same page, with or without a language part", () => {
		const sold = collect(
			[game('1', { storeUrl: 'https://www.gog.com/game/dusk_pack' }), game('2')],
			[pack('900', ['1', '2'], { storeUrl: `${at}/dusk_pack`, poster: 'f'.repeat(64) })]
		);
		expect(sold.collections[0]).toMatchObject({ kind: 'pack', poster: 'f'.repeat(64), total: 2, storeUrl: `${at}/dusk_pack` });
		const hidden = collect(
			[game('1', { storeUrl: `${at}/dusk_one` }), game('2')],
			[pack('900', ['1', '2'], { storeUrl: `${at}/dusk_pack` })]
		);
		expect(hidden.collections[0].storeUrl).toBeNull();
	});

	it('joins a chain of groups: a series and a pack share a game, the pack and another pack another', () => {
		const library = [game('1', { series: dusk }), game('2', { series: dusk }), game('3'), game('4')];
		const { collections, of } = collect(library, [pack('900', ['2', '3']), pack('901', ['3', '4'])]);
		expect(collections).toHaveLength(1);
		expect(collections[0]).toMatchObject({ id: 's77', kind: 'collection', games: ['1', '2', '3', '4'] });
		expect(collections[0].joined).toEqual([
			{ kind: 'pack', name: 'Pack 900' },
			{ kind: 'pack', name: 'Pack 901' }
		]);
		for (const id of ['1', '2', '3', '4']) expect(of.get(id)?.collection).toBe('s77');
	});

	it('leads by the most games, then a pack sold as, then a series, then another pack, then the name, then the id', () => {
		const lead = (library: Member[], packs: PackRecord[]) => collect(library, packs).collections[0].id;
		// The most games.
		expect(lead([game('1', { series: dusk }), game('2', { series: dusk }), game('3')], [pack('900', ['1', '2', '3'])])).toBe('p900');
		// A pack sold as, before a series of as many games.
		const page = `${at}/dusk_pack`;
		expect(lead([game('1', { series: dusk, storeUrl: page }), game('2', { series: dusk })], [pack('900', ['1', '2'], { storeUrl: page })])).toBe('p900');
		// A series, before another pack.
		expect(lead([game('1', { series: dusk }), game('2', { series: dusk })], [pack('900', ['1', '2'])])).toBe('s77');
		// Two other packs: by name, then by id.
		expect(lead([game('1'), game('2')], [pack('900', ['1', '2'], { name: 'Beta' }), pack('901', ['1', '2'], { name: 'Alpha' })])).toBe('p901');
		expect(lead([game('1'), game('2')], [pack('901', ['1', '2'], { name: 'Same' }), pack('900', ['1', '2'], { name: 'Same' })])).toBe('p900');
	});

	it('is a Series or a Pack when the lead holds every game, a Collection when not', () => {
		const series = collect([game('1', { series: dusk }), game('2', { series: dusk })], [pack('900', ['1'])]);
		expect(series.collections[0]).toMatchObject({ id: 's77', kind: 'series', joined: [{ kind: 'pack', name: 'Pack 900' }] });
		const mixed = collect([game('1', { series: dusk }), game('2', { series: dusk }), game('3')], [pack('900', ['2', '3'])]);
		expect(mixed.collections[0]).toMatchObject({ id: 's77', kind: 'collection' });
	});

	it('orders the games oldest first, a game without a year last, and the games of a year by title', () => {
		const library = [
			game('1', { series: dusk, title: 'The Zebra', releaseYear: 1998 }),
			game('2', { series: dusk, title: 'Apple', releaseYear: 1998 }),
			game('3', { series: dusk, title: 'Older', releaseYear: 1991 }),
			game('4', { series: dusk, title: 'Undated', releaseYear: null })
		];
		expect(collect(library, []).collections[0].games).toEqual(['3', '2', '1', '4']);
	});

	it('names the joined groups, the largest first', () => {
		const library = ['1', '2', '3', '4'].map((id) => game(id));
		const { collections } = collect(library, [pack('900', ['1', '2', '3', '4']), pack('901', ['1']), pack('902', ['1', '2', '3'])]);
		expect(collections[0].joined).toEqual([
			{ kind: 'pack', name: 'Pack 902' },
			{ kind: 'pack', name: 'Pack 901' }
		]);
	});

	it('gives each entry its packs A to Z, and the collections by name', () => {
		const library = [game('1'), game('2'), game('3'), game('4')];
		const { collections, of } = collect(library, [
			pack('900', ['1', '2'], { name: 'Zeta' }),
			pack('901', ['1', '2'], { name: 'Alpha' }),
			pack('902', ['3', '4'], { name: 'Middle' })
		]);
		expect(of.get('1')?.packs).toEqual(['Alpha', 'Zeta']);
		expect(collections.map((c) => c.name)).toEqual(['Alpha', 'Middle']);
	});

	it('gives a series no poster, total or page', () => {
		const page = `${at}/dusk`;
		const { collections } = collect([game('1', { series: dusk, storeUrl: page }), game('2', { series: dusk, storeUrl: page })], []);
		expect(collections[0]).toMatchObject({ poster: null, total: null, storeUrl: null });
	});
});
