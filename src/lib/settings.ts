import { NOTHING_REMEMBERED, type Remembered } from './remember';
import type { Sort } from './search/state';
import { ALL_OS } from './types';

/** What whoever holds the PIN chose for everyone at home. Spec 0.11.0, section 3. */
export interface Settings {
	/** How the library opens in a browser that has not chosen its own view. */
	defaults: Remembered;
	/** True when a game's detail shows the theo panel. */
	theo: boolean;
}

export const NO_SETTINGS: Settings = { defaults: NOTHING_REMEMBERED, theo: false };

/** What the page is told of the settings with the layout's data. */
export interface SettingsInfo {
	/** False while no PIN is set: settings are off. */
	enabled: boolean;
	theo: boolean;
	/** When this browser's unlock runs out, as an ISO time; null while it is locked. */
	unlockedUntil: string | null;
	/** False while the settings folder cannot be written. */
	writable: boolean;
}

/** The answer of the settings routes while the browser is unlocked. */
export interface SettingsAnswer extends Settings {
	unlockedUntil: string;
	writable: boolean;
}

/** Every sort order, in the order they are offered. */
export const SORTS: readonly Sort[] = ['title', 'recent', 'year'];

function isRecord(x: unknown): x is Record<string, unknown> {
	return x !== null && typeof x === 'object' && !Array.isArray(x);
}

/**
 * The settings in the body of `PUT /api/settings`, or null when a part is missing or not valid:
 * each part is checked as the file's are, but refused rather than mended. A platform named twice
 * is refused too. Keys it does not know are ignored. Spec 0.11.0, section 7.
 */
export function parseSettingsBody(body: unknown): Settings | null {
	if (!isRecord(body) || !isRecord(body.defaults)) return null;
	const { os, sort, grouped, hide18 } = body.defaults;
	const { theo } = body;
	if (!Array.isArray(os) || new Set(os).size !== os.length) return null;
	if (!os.every((name) => (ALL_OS as readonly unknown[]).includes(name))) return null;
	if (!SORTS.includes(sort as Sort)) return null;
	if (typeof grouped !== 'boolean' || typeof hide18 !== 'boolean' || typeof theo !== 'boolean') return null;
	return {
		// In the fixed order.
		defaults: { os: ALL_OS.filter((name) => os.includes(name)), sort: sort as Sort, grouped, hide18 },
		theo
	};
}
