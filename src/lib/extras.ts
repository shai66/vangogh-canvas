/**
 * GOG's goodies ("extras"): manuals, soundtracks, artwork. GOG names their kind in its own
 * words (`type` in its record). This table gives each kind its place in the panel; the names
 * they are shown by are in strings.ts, their icons in ui/icons.ts. A kind GOG adds later comes
 * after these.
 */
export const EXTRA_KINDS = [
	'manuals',
	'guides & reference',
	'audio',
	'artworks',
	'wallpapers',
	'avatars',
	'video',
	'game add-ons'
] as const;

/** Where a kind stands in the panel. */
export function kindRank(kind: string): number {
	const at = (EXTRA_KINDS as readonly string[]).indexOf(kind.toLowerCase());
	return at < 0 ? EXTRA_KINDS.length : at;
}

/** Known kinds in table order, then unknown ones. */
function byKindOnly(a: string, b: string): number {
	return kindRank(a) - kindRank(b) || a.toLowerCase().localeCompare(b.toLowerCase(), 'en');
}

/** The panel's order: by kind, then by name. Unknown kinds follow the known ones, each grouped by its own name. */
export function byKind<T extends { kind: string; name: string }>(a: T, b: T): number {
	return byKindOnly(a.kind, b.kind) || a.name.localeCompare(b.name, 'en', { numeric: true });
}

/**
 * True when vangogh downloads an extra of this size. It reads a number, one space and MB, GB or
 * TB, and never downloads one that reads as 0 (`SizeToEstimatedBytes` and the filter after it,
 * in vangogh's `downloads.go`, version 1.2.18).
 */
export function vangoghDownloads(size: string): boolean {
	const match = /^(\d+(?:\.\d+)?) (MB|GB|TB)$/.exec(size);
	return match !== null && Number(match[1]) > 0;
}

/** How many of each kind, in the panel's order: [["manuals", 5], ["audio", 4]]. */
export function kindCounts(kinds: string[]): [string, number][] {
	const counts = new Map<string, number>();
	for (const kind of [...kinds].sort(byKindOnly)) {
		counts.set(kind, (counts.get(kind) ?? 0) + 1);
	}
	return [...counts];
}
