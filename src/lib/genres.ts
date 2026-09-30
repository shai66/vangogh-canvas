import { normalize } from './search/text';

/**
 * GOG's one list of "genres" mixes three kinds of thing. The filter shows
 * them apart: what kind of game, where it is set, how it plays.
 */
export type GenreGroup = 'genre' | 'setting' | 'style';
export const GENRE_GROUPS: readonly GenreGroup[] = ['genre', 'setting', 'style'];

const SETTING = ['Fantasy', 'Sci-fi', 'Horror', 'Historical', 'Modern', 'Detective-mystery', 'Espionage'];
const STYLE = ['FPP', 'TPP', 'Turn-based', 'Real-time', 'Open World', 'Point-and-click'];

const GROUP = new Map<string, GenreGroup>([
	...SETTING.map((name) => [normalize(name), 'setting'] as const),
	...STYLE.map((name) => [normalize(name), 'style'] as const)
]);

/** A genre this table does not know is a genre. */
export function genreGroup(genre: string): GenreGroup {
	return GROUP.get(normalize(genre)) ?? 'genre';
}

/** GOG's names that say nothing to someone who does not know them. */
const NAMES = new Map<string, string>([
	['fpp', 'First-person'],
	['tpp', 'Third-person'],
	['detective-mystery', 'Detective']
]);

/** The name a genre is shown by. */
export function genreName(genre: string): string {
	return NAMES.get(normalize(genre)) ?? genre;
}
