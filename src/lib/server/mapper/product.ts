import type { Os } from '../../types';
import { imageIdFromUrl } from './imageId';
import { arr, names, obj, str, unique } from './raw';
import { sanitizeDescription } from './sanitize';

export type ProductType = 'GAME' | 'DLC' | 'PACK' | 'UNKNOWN';

export interface Related {
	id: string;
	title: string | null;
}

export interface MappedProduct {
	title: string | null;
	productType: ProductType;
	os: Os[];
	genres: string[];
	tags: string[];
	developers: string[];
	publisher: string;
	features: string[];
	multiplayer: boolean;
	coop: boolean;
	languages: string[];
	description: string;
	screenshots: string[];
	poster: string | null;
	banner: string | null;
	backdrop: string | null;
	releaseYear: number | null;
	macNotice: string | null;
	requires: Related[];
	includes: Related[];
	includedIn: Related[];
}

const OS_BY_NAME = new Map<string, Os>([
	['windows', 'windows'],
	['osx', 'macos'],
	['mac', 'macos'],
	['macos', 'macos'],
	['linux', 'linux']
]);

function productType(x: unknown): ProductType {
	const type = str(x).toUpperCase();
	return type === 'GAME' || type === 'DLC' || type === 'PACK' ? type : 'UNKNOWN';
}

/** Product ids in a relation: one link or a list of links. */
function related(x: unknown): Related[] {
	const items = Array.isArray(x) ? x : x ? [x] : [];
	const out: Related[] = [];
	for (const item of items) {
		const link = obj(item);
		const path = str(link.href).split(/[?#]/)[0].replace(/\/+$/, '');
		const id = path.split('/').pop() ?? '';
		if (!/^\d+$/.test(id) || out.some((r) => r.id === id)) continue;
		out.push({ id, title: str(link.title) || null });
	}
	return out;
}

/**
 * The year of a date as GOG writes it, "2002-09-27T00:00:00+02:00": the year
 * that stands there, not the year of that moment in another time zone.
 */
function yearOf(x: unknown): number | null {
	const year = Number(str(x).match(/^(\d{4})-\d{2}-\d{2}(?:T|$)/)?.[1]);
	return year >= 1950 ? year : null;
}

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	rsquo: '\u2019',
	lsquo: '\u2018'
};

/** A notice longer than this is not the sentence GOG writes, and is not shown. */
const MAX_NOTICE = 300;

/** A field longer than this is not looked into at all. */
const MAX_FIELD = 20_000;

/** One entity as GOG writes it: named, or a number in decimal or hexadecimal. Left as written when it is none we know. */
function decodeEntity(whole: string, name: string): string {
	if (name[0] === '#') {
		const hex = name[1] === 'x' || name[1] === 'X';
		const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
		// Only what can be shown: not a control character, not a surrogate, not beyond Unicode.
		const showable = code >= 32 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
		return showable ? String.fromCodePoint(code) : whole;
	}
	return ENTITIES[name.toLowerCase()] ?? whole;
}

/**
 * What GOG says about the macOS version of a product, or null. The field
 * `additionalRequirements` is HTML with notes of all kinds. The notice is the
 * line that begins with "Mac notice:". It is given as plain text, without
 * those two words. Never throws, whatever it is given.
 */
export function macNoticeOf(x: unknown): string | null {
	const field = str(x);
	if (field.length > MAX_FIELD) return null;
	const lines = field
		// Where a paragraph, a line or a list item ends, a line ends. A tag does not run across another `<`, so this stays linear.
		.replace(/<\s*(?:br(?:\s[^<>]*)?\/?|\/p|\/div|\/li)\s*>/gi, '\n')
		.replace(/<[^<>]*>/g, '')
		.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, decodeEntity)
		.split(/[\r\n]+/);
	for (const line of lines) {
		const text = line.replace(/\s+/g, ' ').trim().match(/^Mac notice:\s*(.+)$/i)?.[1];
		if (text) return text.length <= MAX_NOTICE ? text : null;
	}
	return null;
}

/** Maps a `gog-api-products` record. Never throws, whatever it is given. */
export function mapApiProduct(raw: unknown): MappedProduct {
	const root = obj(raw);
	const embedded = obj(root._embedded);
	const links = obj(root._links);
	const features = names(embedded.features);
	const description =
		str(root.description) ||
		[str(root.overview), str(root.featuresDescription)].filter(Boolean).join('\n');

	return {
		title: str(obj(embedded.product).title) || null,
		productType: productType(embedded.productType),
		os: unique(
			arr(embedded.supportedOperatingSystems)
				.map((item) => OS_BY_NAME.get(str(obj(obj(item).operatingSystem).name).toLowerCase()))
				.filter((os): os is Os => os !== undefined)
		),
		genres: names(embedded.tags),
		tags: names(embedded.properties),
		developers: names(embedded.developers),
		publisher: str(obj(embedded.publisher).name),
		features,
		multiplayer: features.some((f) => /multi-?player/i.test(f)),
		coop: features.some((f) => /co-?op/i.test(f)),
		languages: unique(
			arr(embedded.localizations)
				.map((item) => {
					const language = obj(obj(obj(item)._embedded).language);
					return str(language.name) || str(language.code);
				})
				.filter(Boolean)
		),
		description: sanitizeDescription(description),
		screenshots: unique(
			arr(embedded.screenshots)
				.map((item) => imageIdFromUrl(str(obj(obj(obj(item)._links).self).href)))
				.filter((id): id is string => id !== undefined)
		),
		poster: imageIdFromUrl(str(obj(links.boxArtImage).href)) ?? null,
		// The wide image with the logo sits with the product, not with the record's own links.
		banner: imageIdFromUrl(str(obj(obj(obj(embedded.product)._links).image).href)) ?? null,
		backdrop: imageIdFromUrl(str(obj(links.galaxyBackgroundImage).href)) ?? null,
		// When the game first came out. `gogReleaseDate`, next to it, is when it came to GOG.
		releaseYear: yearOf(obj(embedded.product).globalReleaseDate),
		macNotice: macNoticeOf(root.additionalRequirements),
		requires: related(links.requiresGames),
		includes: related(links.includesGames),
		includedIn: related(links.isIncludedInGames)
	};
}
