// The library at a glance: the space the archive takes, the systems, the decades and
// the genres, worked out from the index in memory. Spec 0.9.1, sections 3 and 4.
import { genreGroup, genreName } from '../genres';
import { ALL_OS, type Detail, type Downloads, type Glance, type Os } from '../types';
import type { Index } from './index-types';

/** How many genres the sheet shows. */
export const TOP_GENRES = 6;

const zero = (): Record<Os, number> => ({ windows: 0, macos: 0, linux: 0 });

/** A size that can be added: a positive, finite number of bytes, or nothing. */
const bytesOf = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Adds each file of a download list to its system, once per game by its id.
 * A file id listed under two systems counts once, for the first system in the order Windows, macOS, Linux.
 * An extra with the id of an installer is not counted again: the spec counts each file once per game.
 */
function addDownloads(downloads: Downloads | null | undefined, seen: Set<string>, bytes: Record<Os, number>): void {
	for (const os of ALL_OS) {
		const files = downloads?.[os];
		if (!Array.isArray(files)) continue;
		for (const file of files) {
			if (!file || seen.has(file.fileId)) continue;
			seen.add(file.fileId);
			bytes[os] += bytesOf(file.sizeBytes);
		}
	}
}

/** [decade, games] from the first decade with a game to the last; one between them without a game is 0. */
function decadesOf(years: number[]): [number, number][] {
	if (years.length === 0) return [];
	// A loop, not a spread: a spread of every year could overflow the argument limit.
	let min = years[0];
	let max = years[0];
	for (const year of years) {
		if (year < min) min = year;
		if (year > max) max = year;
	}
	const first = Math.floor(min / 10) * 10;
	const last = Math.floor(max / 10) * 10;
	const decades: [number, number][] = [];
	for (let decade = first; decade <= last; decade += 10) {
		decades.push([decade, years.filter((year) => year >= decade && year < decade + 10).length]);
	}
	return decades;
}

/** The genres with the most games, most first; on a tie by the name they are shown by, A to Z. */
function topGenres(counts: Map<string, number>): [string, number][] {
	return [...counts]
		.sort((a, b) => b[1] - a[1] || genreName(a[0]).localeCompare(genreName(b[0]), 'en'))
		.slice(0, TOP_GENRES);
}

/** The glance of an index. Pure; it never throws, on a broken detail neither. */
export function glanceOf(index: Pick<Index, 'entries' | 'details'>): Glance {
	const bytes = zero();
	const systems = zero();
	let extrasBytes = 0;
	const years: number[] = [];
	const genres = new Map<string, number>();
	for (const entry of index.entries) {
		for (const os of ALL_OS) if (entry.os.includes(os)) systems[os]++;
		if (Number.isInteger(entry.releaseYear)) years.push(entry.releaseYear as number);
		for (const genre of new Set(entry.genres)) {
			if (genreGroup(genre) === 'genre') genres.set(genre, (genres.get(genre) ?? 0) + 1);
		}
		// Own keys only: an id such as `__proto__` must not reach the prototype.
		const detail: Detail | undefined = Object.hasOwn(index.details, entry.id) ? index.details[entry.id] : undefined;
		if (!detail) continue;
		// The index keeps only the files that are in the archive; each counts once per game.
		const seen = new Set<string>();
		addDownloads(detail.downloads, seen, bytes);
		for (const dlc of Array.isArray(detail.dlc) ? detail.dlc : []) addDownloads(dlc?.downloads, seen, bytes);
		for (const extra of Array.isArray(detail.extras) ? detail.extras : []) {
			if (!extra || seen.has(extra.fileId)) continue;
			seen.add(extra.fileId);
			extrasBytes += bytesOf(extra.sizeBytes);
		}
	}
	return { bytes, extrasBytes, systems, decades: decadesOf(years), noYear: index.entries.length - years.length, genres: topGenres(genres) };
}

const worked = new WeakMap<Index, Glance>();

/** The glance of an index, worked out once per index: a rebuild makes a new index, and a new glance. */
export function glanceFor(index: Index): Glance {
	let glance = worked.get(index);
	if (!glance) {
		glance = glanceOf(index);
		worked.set(index, glance);
	}
	return glance;
}
