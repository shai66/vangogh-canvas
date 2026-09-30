import { describe, expect, it } from 'vitest';
import { normalize, sortKey, words } from './text';

describe('normalize', () => {
	it('ignores case and accents', () => {
		expect(normalize('Šťastný ÚTEK')).toBe('stastny utek');
		expect(normalize('Pokémon')).toBe('pokemon');
	});

	it('folds letters that do not decompose', () => {
		expect(normalize('Łódź')).toBe('lodz');
		expect(normalize('Straße')).toBe('strasse');
		expect(normalize('ØÆŒÐĐÞıẞ')).toBe('oaeoeddthiss');
	});
});

describe('words', () => {
	it('splits on any space and drops empty parts', () => {
		expect(words('  Witch   wild\thunt ')).toEqual(['witch', 'wild', 'hunt']);
		expect(words('   ')).toEqual([]);
	});
});

describe('sortKey', () => {
	it('ignores a leading "The"', () => {
		expect(sortKey('The Witcher')).toBe('witcher');
		expect(sortKey('the  Long Road')).toBe('long road');
	});

	it('keeps "The" inside a word or alone', () => {
		expect(sortKey('Thea: The Awakening')).toBe('thea: the awakening');
		expect(sortKey('The')).toBe('the');
	});
});
