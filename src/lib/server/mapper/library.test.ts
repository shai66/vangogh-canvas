import { describe, expect, it } from 'vitest';
import { mapLibrary } from './library';

describe('mapLibrary', () => {
	it('maps titles, systems and DLC', () => {
		const raw = [{ id: '1001', tt: 'A Game', os: [1, 2, 3], dlc: { '2001': 'An Expansion' } }];
		expect(mapLibrary(raw)).toEqual([
			{
				id: '1001',
				title: 'A Game',
				os: ['windows', 'macos', 'linux'],
				dlc: [{ id: '2001', title: 'An Expansion' }]
			}
		]);
	});

	it('accepts a numeric id and a missing dlc', () => {
		expect(mapLibrary([{ id: 1002, tt: 'Other', os: [1] }])).toEqual([
			{ id: '1002', title: 'Other', os: ['windows'], dlc: [] }
		]);
	});

	it('ignores systems it does not know and entries without an id', () => {
		const raw = [{ tt: 'No id' }, { id: '5', tt: 'Odd', os: [1, 9, 'x', 1] }, null, 'text'];
		expect(mapLibrary(raw)).toEqual([{ id: '5', title: 'Odd', os: ['windows'], dlc: [] }]);
	});

	it.each([['__proto__'], ['12/34'], ['12?x'], ['constructor'], ['toString'], [''], ['-1']])(
		'skips the product id %j',
		(id) => {
			expect(mapLibrary([{ id, tt: 'Odd' }, { id: '8', tt: 'Fine' }]).map((p) => p.id)).toEqual(['8']);
		}
	);

	it('skips DLC ids that are not numbers', () => {
		const raw = [
			{
				id: '9',
				tt: 'G',
				dlc: JSON.parse('{"__proto__": "a", "12/34": "b", "12?x": "c", "constructor": "d", "2001": "e"}')
			}
		];
		expect(mapLibrary(raw)[0].dlc).toEqual([{ id: '2001', title: 'e' }]);
	});

	it('ignores systems named like the properties of an object', () => {
		expect(mapLibrary([{ id: '9', os: ['constructor', 'toString', '__proto__', 1] }])[0].os).toEqual([
			'windows'
		]);
	});

	it('uses the id when the title is missing', () => {
		expect(mapLibrary([{ id: '7' }])[0].title).toBe('7');
	});

	it('throws when the list is not a list', () => {
		expect(() => mapLibrary({ error: 'x' })).toThrow('the library list is not a list');
		expect(() => mapLibrary(null)).toThrow('the library list is not a list');
	});
});
