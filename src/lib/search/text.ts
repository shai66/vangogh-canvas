/** Letters that NFD does not split into a base letter and an accent. */
const FOLD: Record<string, string> = {
	ł: 'l',
	ø: 'o',
	đ: 'd',
	ð: 'd',
	þ: 'th',
	ß: 'ss',
	æ: 'ae',
	œ: 'oe',
	ı: 'i'
};
const UNFOLDED = /[łøđðþßæœı]/g;

/** Lower case, without accents. */
export function normalize(text: string): string {
	return text
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(UNFOLDED, (letter) => FOLD[letter]);
}

/** The words of a search, normalised. */
export function words(query: string): string[] {
	return normalize(query).split(/\s+/).filter(Boolean);
}

/** What a title is sorted by: normalised, without a leading "The". */
export function sortKey(title: string): string {
	return normalize(title)
		.trim()
		.replace(/\s+/g, ' ')
		.replace(/^the (?=\S)/, '');
}
