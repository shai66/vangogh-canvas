import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE, parseState, toParams } from './state';

const parse = (text: string) => parseState(new URLSearchParams(text));

describe('parseState', () => {
	it('gives the defaults for an empty address', () => {
		expect(parse('')).toEqual(DEFAULT_STATE);
		expect(DEFAULT_STATE).toEqual({ q: '', os: [], genres: [], together: [], sort: 'title' });
	});

	it('reads the example of the spec', () => {
		expect(parse('q=witcher&os=linux&genre=strategy&sort=recent')).toEqual({
			q: 'witcher',
			os: ['linux'],
			genres: ['strategy'],
			together: [],
			sort: 'recent'
		});
	});

	it('reads the ways of playing together', () => {
		expect(parse('play=coop,multiplayer').together).toEqual(['coop', 'multiplayer']);
		expect(parse('play=coop&play=coop').together).toEqual(['coop']);
		expect(parse('play=alone,constructor,,coop').together).toEqual(['coop']);
	});

	it('reads several values, separated or repeated', () => {
		expect(parse('os=linux,macos&genre=Strategy&genre=Role-playing').os).toEqual(['linux', 'macos']);
		expect(parse('os=linux,macos&genre=Strategy&genre=Role-playing').genres).toEqual([
			'Strategy',
			'Role-playing'
		]);
	});

	it('drops what it does not know', () => {
		expect(parse('os=amiga,,linux,linux&sort=price&genre=&genre=%20')).toEqual({
			q: '',
			os: ['linux'],
			genres: [],
			together: [],
			sort: 'title'
		});
	});

	it('cuts a very long search', () => {
		expect(parse(`q=${'x'.repeat(500)}`).q).toHaveLength(200);
	});
});

describe('toParams', () => {
	it('leaves out the defaults', () => {
		expect(toParams(DEFAULT_STATE).toString()).toBe('');
	});

	it('writes what parseState reads', () => {
		const state = {
			q: 'witch wild',
			os: ['linux', 'macos'] as const,
			genres: ['Role-playing', 'Strategy'],
			together: ['coop', 'multiplayer'] as const,
			sort: 'recent' as const
		};
		const params = toParams({ ...state, os: [...state.os], together: [...state.together] });
		expect(params.toString()).toBe(
			'q=witch+wild&os=linux%2Cmacos&genre=Role-playing&genre=Strategy&play=coop%2Cmultiplayer&sort=recent'
		);
		expect(parseState(params)).toEqual({ ...state, os: [...state.os], together: [...state.together] });
	});

	it('trims the search', () => {
		expect(toParams({ ...DEFAULT_STATE, q: '  ' }).toString()).toBe('');
	});
});
