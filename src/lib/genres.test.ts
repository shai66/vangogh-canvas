import { describe, expect, it } from 'vitest';
import { genreGroup, genreName } from './genres';

describe('genreGroup', () => {
	it.each([
		['Strategy', 'genre'],
		['Role-playing', 'genre'],
		['Fantasy', 'setting'],
		['Detective-mystery', 'setting'],
		['FPP', 'style'],
		['Turn-based', 'style'],
		['Open World', 'style']
	])('puts %s into %s', (genre, group) => {
		expect(genreGroup(genre)).toBe(group);
	});

	it('does not mind the case', () => {
		expect(genreGroup('sci-FI')).toBe('setting');
		expect(genreGroup('fpp')).toBe('style');
	});

	it('takes a genre it does not know, or a name of an object property, as a genre', () => {
		expect(genreGroup('Visual Novel')).toBe('genre');
		expect(genreGroup('constructor')).toBe('genre');
		expect(genreGroup('')).toBe('genre');
	});
});

describe('genreName', () => {
	it('gives the three unclear names a plain one', () => {
		expect(genreName('FPP')).toBe('First-person');
		expect(genreName('TPP')).toBe('Third-person');
		expect(genreName('Detective-mystery')).toBe('Detective');
	});

	it('leaves every other name as it is', () => {
		expect(genreName('Role-playing')).toBe('Role-playing');
		expect(genreName('toString')).toBe('toString');
	});
});
