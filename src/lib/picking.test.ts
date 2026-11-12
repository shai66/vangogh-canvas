import { describe, expect, it } from 'vitest';
import { Picking } from './picking.svelte';

describe('picking', () => {
	it('counts games and collections and lists them as members', () => {
		const picking = new Picking();
		picking.toggle('11', 'game');
		picking.toggle('s5', 'collection');
		expect(picking.counts).toEqual({ games: 1, collections: 1, n: 2 });
		expect(picking.has('11')).toBe(true);
		expect(picking.members()).toEqual([{ game: '11' }, { collection: 's5' }]);

		// A second toggle unpicks.
		picking.toggle('11', 'game');
		expect(picking.has('11')).toBe(false);
		expect(picking.counts).toEqual({ games: 0, collections: 1, n: 1 });
		expect(picking.members()).toEqual([{ collection: 's5' }]);
	});

	it('empties on stop', () => {
		const picking = new Picking();
		picking.start();
		expect(picking.active).toBe(true);
		picking.toggle('11', 'game');
		picking.toggle('p7', 'collection');
		picking.stop();
		expect(picking.active).toBe(false);
		expect(picking.counts.n).toBe(0);
		expect(picking.members()).toEqual([]);
	});
});
