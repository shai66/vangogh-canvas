// The rules of scripts/screenshots.ts that need no browser: which pictures to take,
// whether the Canvas there runs the version being released, and the list under the sheets.

export interface Picture {
	/** The file name without `.jpg`. */
	name: string;
	url: URL;
}

const NAME = /^[a-z0-9-]+$/;

/** Reads the arguments, each `name=address`. Throws an Error that says what is wrong. */
export function parsePictures(args: readonly string[]): Picture[] {
	if (args.length === 0) {
		throw new Error('Give at least one picture as name=address, for example library=http://canvas.example/');
	}
	const pictures: Picture[] = [];
	for (const arg of args) {
		const cut = arg.indexOf('=');
		if (cut <= 0) throw new Error(`"${arg}" is not name=address.`);
		const name = arg.slice(0, cut);
		const address = arg.slice(cut + 1);
		if (!NAME.test(name)) throw new Error(`The name "${name}" may hold only lower case letters, digits and hyphens.`);
		if (pictures.some((p) => p.name === name)) throw new Error(`The name "${name}" is given twice.`);
		const url = URL.canParse(address) ? new URL(address) : null;
		if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
			throw new Error(`The address of "${name}" is not a full http or https address: ${address}`);
		}
		const tab = settingsTab(url);
		if (tab === 'batocera') {
			throw new Error(`The tab "batocera" of "${name}" shows the address of a Batocera box, so it is not pictured.`);
		}
		if (tab !== null && !SETTINGS_TABS.includes(tab)) {
			throw new Error(`The tab "${tab}" of "${name}" is not one of ${SETTINGS_TABS.join(', ')}.`);
		}
		if (pictures.length > 0 && url.origin !== pictures[0].url.origin) {
			throw new Error(`All addresses must be on one Canvas: ${pictures[0].url.origin} and ${url.origin}.`);
		}
		pictures.push({ name, url });
	}
	return pictures;
}

/**
 * Null when `/healthz` says the version of package.json and an index is built;
 * otherwise what to tell the person. The version is checked first.
 */
export function healthProblem(health: unknown, expected: string): string | null {
	const field = (name: string) =>
		typeof health === 'object' && health !== null && name in health
			? (health as Record<string, unknown>)[name]
			: undefined;
	const version = field('version');
	if (typeof version !== 'string') return '/healthz did not say which version runs.';
	if (version !== expected) {
		return `The Canvas there runs ${version}, and package.json says ${expected}. Redeploy it first.`;
	}
	const status = field('status');
	return status === 'ok'
		? null
		: `The Canvas there has no index yet (/healthz says ${String(status)}). Wait until it has built one.`;
}

/** True for an address that opens a sheet over the list: a game, a collection, the glance. */
export function opensSheet(url: URL): boolean {
	return url.pathname !== '/';
}

/** The tabs of the settings sheet, by the names they show. */
const SETTINGS_TABS = ['library', 'downloads', 'batocera', 'server'];

/** True for the settings sheet, which opens behind the PIN. */
export function isSettings(url: URL): boolean {
	return url.pathname === '/settings';
}

/** The tab a settings address asks for by its hash, as `/settings#server`; null for the sheet's first tab or another address. */
export function settingsTab(url: URL): string | null {
	if (!isSettings(url) || url.hash.length <= 1) return null;
	const hash = url.hash.slice(1);
	try {
		return decodeURIComponent(hash).toLowerCase();
	} catch {
		// Not a name any tab has: refused as an unknown tab.
		return hash.toLowerCase();
	}
}

/** Null for a PIN Canvas could take; otherwise what to tell the person. */
export function pinProblem(pin: string): string | null {
	return /^\d{4,8}$/.test(pin) ? null : "SETTINGS_PIN must be the settings' PIN: 4 to 8 digits.";
}

/** vangogh's address in a picture of the Server tab: the example stack's, so that no address of a home network reaches the README. */
export const VANGOGH_STAND_IN = 'http://vangogh:1853';

/** The answer of `/api/settings/status` with the stand-in in place of vangogh's address; any other answer as it is. */
export function withStandIn(status: unknown): unknown {
	if (typeof status !== 'object' || status === null || !('vangogh' in status)) return status;
	const vangogh = (status as { vangogh: unknown }).vangogh;
	if (typeof vangogh !== 'object' || vangogh === null || !('url' in vangogh)) return status;
	return { ...status, vangogh: { ...vangogh, url: VANGOGH_STAND_IN } };
}

const ALL_OS = ['windows', 'macos', 'linux'];

/**
 * Canvas's cookie `canvas-view` for the first address whose path is `/`, or null without one.
 * An address with parameters shows its list but is not remembered, so without the cookie the
 * list under a sheet would be the default one. Node cannot load Canvas's own `parseState` and
 * `rememberedCookie` (they import through `$lib`), so this builds the same value, and a unit
 * test holds the two equal.
 */
export function listCookie(pictures: readonly Picture[]): { name: string; value: string } | null {
	const list = pictures.find((p) => !opensSheet(p.url));
	if (!list) return null;
	const params = list.url.searchParams;
	const wanted = params
		.getAll('os')
		.flatMap((v) => v.split(','))
		.map((v) => v.trim())
		.filter(Boolean);
	const os = [...new Set(wanted)].filter((v) => ALL_OS.includes(v));
	const asked = params.get('sort');
	const sort = asked === 'recent' || asked === 'year' ? asked : 'title';
	const view = params.get('view') === 'collections' ? '|collections' : '';
	return { name: 'canvas-view', value: `${os.join('+')}|${sort}${view}` };
}
