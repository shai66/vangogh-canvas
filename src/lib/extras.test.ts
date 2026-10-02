import { describe, expect, it } from 'vitest';
import { byKind, kindCounts, kindRank, vangoghDownloads } from './extras';

describe('vangoghDownloads', () => {
	it.each([
		['12 MB', true],
		['1.5 GB', true],
		['2 TB', true],
		['0 MB', false],
		['0.0 GB', false],
		['1.5GB', false],
		['12 KB', false],
		['12 mb', false],
		['', false],
		['unknown', false],
		['1,5 GB', false]
	])('reads %j as %s, as vangogh does', (size, wanted) => {
		expect(vangoghDownloads(size)).toBe(wanted);
	});
});

describe('the order of kinds', () => {
	it('puts the kinds GOG uses in a fixed order, and any other after them', () => {
		expect(kindRank('manuals')).toBe(0);
		expect(kindRank('Game Add-ons')).toBe(7);
		expect(kindRank('comic book')).toBe(8);
	});

	it('sorts by kind, then by name', () => {
		const list = [
			{ kind: 'audio', name: 'b' },
			{ kind: 'manuals', name: 'z' },
			{ kind: 'audio', name: 'a' },
			{ kind: 'comic book', name: 'c' }
		];
		expect(list.sort(byKind).map((e) => e.name)).toEqual(['z', 'a', 'b', 'c']);
	});

	it('keeps each kind GOG may add later together, by its own name, after the known ones', () => {
		const list = [
			{ kind: 'demo', name: 'a' },
			{ kind: 'comic book', name: 'b' },
			{ kind: 'Demo', name: 'c' },
			{ kind: 'audio', name: 'z' }
		];
		expect(list.sort(byKind).map((e) => e.name)).toEqual(['z', 'b', 'a', 'c']);
	});

	it('counts unknown kinds in the same order as the rows', () => {
		expect(kindCounts(['demo', 'audio', 'comic book', 'demo'])).toEqual([
			['audio', 1],
			['comic book', 1],
			['demo', 2]
		]);
	});

	it('counts the kinds in that order', () => {
		expect(kindCounts(['audio', 'manuals', 'audio', 'comic book'])).toEqual([
			['manuals', 1],
			['audio', 2],
			['comic book', 1]
		]);
		expect(kindCounts([])).toEqual([]);
	});
});
