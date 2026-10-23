import { createHash } from 'node:crypto';

/** The game's details for EmulationStation's list (spec 3.6), and GOG's description as plain text. */

export interface ListDetails {
	name: string;
	description: string;
	releaseYear: number | null;
	developers: string[];
	publisher: string;
	genres: string[];
}

/** EmulationStation's id of a game: the MD5 of its whole path on the box, as hex. */
export function listId(path: string): string {
	return createHash('md5').update(path).digest('hex');
}

/**
 * The details for `POST /systems/<system>/games/<id>`, as 43.1's `ImportFromJson` takes them: its metadata keys
 * with string values; what is not known is left out.
 */
export function detailsJson(d: ListDetails): string {
	const fields: [string, string][] = [
		['name', d.name],
		['desc', d.description],
		['releasedate', d.releaseYear === null ? '' : `${String(d.releaseYear).padStart(4, '0')}0101T000000`],
		['developer', d.developers.join(', ')],
		['publisher', d.publisher],
		['genre', d.genres.join(', ')]
	];
	return JSON.stringify(Object.fromEntries(fields.filter(([, v]) => v !== '')));
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '\u2014', ndash: '\u2013', hellip: '\u2026' };

/** GOG's description (a little HTML) as plain text: paragraphs, headings and lists kept as line breaks. */
export function plainText(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|h[1-6]|ul|ol)\s*>/gi, '\n\n')
		.replace(/<li(\s[^>]*)?>/gi, '\n- ')
		.replace(/<[^>]*>/g, '')
		.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(lt|gt|quot|apos|nbsp|mdash|ndash|hellip));/gi, (entity: string, dec?: string, hex?: string, name?: string) => {
			if (name) return ENTITIES[name.toLowerCase()];
			const code = Number.parseInt((dec ?? hex)!, dec ? 10 : 16);
			return Number.isInteger(code) && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
		})
		.replace(/&amp;/g, '&')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
