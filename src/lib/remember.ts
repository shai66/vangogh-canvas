import { ALL_OS, type Os } from './types';
import { parseSort, type Sort, type ViewState } from './search/state';

/**
 * The browser remembers four settings of the view: the platform filter, the
 * sort order, the collections toggle and the chip "Hide 18+". They are kept in
 * a cookie and not in local storage, so that the server can draw the list the
 * way it was left, without a second draw. Canvas stores nothing about it.
 */
export const REMEMBER_COOKIE = 'canvas-view';

export interface Remembered {
	os: Os[];
	sort: Sort;
	/** True when the list shows each collection as one card. */
	grouped: boolean;
	/** True when the games for adults are left out. */
	hide18: boolean;
}

export const NOTHING_REMEMBERED: Remembered = { os: [], sort: 'title', grouped: false, hide18: false };

/**
 * Reads the value of the cookie: the platforms, the sort order, then flags by name.
 * Anything it does not know is dropped; a cookie of 0.8.0 (two parts) or 0.9.0 (three)
 * has the flags it lacks off.
 */
export function parseRemembered(value: string | undefined): Remembered {
	if (!value) return NOTHING_REMEMBERED;
	const [os = '', sort = '', ...flags] = value.split('|');
	const wanted = os.split('+');
	return {
		// In the fixed order, each once.
		os: ALL_OS.filter((name) => wanted.includes(name)),
		sort: parseSort(sort),
		grouped: flags.includes('collections'),
		hide18: flags.includes('hide18')
	};
}

/** Reads what is remembered out of a whole cookie text, as `document.cookie` gives it. */
export function recall(cookies: string): Remembered {
	for (const part of cookies.split(';')) {
		const [name, ...value] = part.trim().split('=');
		if (name === REMEMBER_COOKIE) return parseRemembered(value.join('='));
	}
	return NOTHING_REMEMBERED;
}

/**
 * The cookie to set, as `document.cookie` takes it. It lasts a year. The value
 * uses only characters a cookie may hold: names joined by `+`, then `|`, then
 * the order, then `|collections` while the toggle is on and `|hide18` while
 * the chip is on.
 */
export function rememberedCookie(state: Pick<ViewState, 'os' | 'sort' | 'grouped' | 'hide18'>): string {
	const flags = `${state.grouped ? '|collections' : ''}${state.hide18 ? '|hide18' : ''}`;
	return `${REMEMBER_COOKIE}=${state.os.join('+')}|${state.sort}${flags}; Max-Age=31536000; Path=/; SameSite=Lax`;
}

/**
 * What is remembered after a change of the view, or null when the change leaves it alone.
 * Only the part the visitor changed is taken: a new order keeps the platforms and the flags
 * as they were remembered, and so on. The rest of the view may have come from an address,
 * which the visitor did not choose.
 */
export function nextRemembered(remembered: Remembered, before: ViewState, after: ViewState): Remembered | null {
	const os = before.os.join('+') !== after.os.join('+');
	const sort = before.sort !== after.sort;
	const grouped = before.grouped !== after.grouped;
	const hide18 = before.hide18 !== after.hide18;
	if (!os && !sort && !grouped && !hide18) return null;
	return {
		os: os ? [...after.os] : remembered.os,
		sort: sort ? after.sort : remembered.sort,
		grouped: grouped ? after.grouped : remembered.grouped,
		hide18: hide18 ? after.hide18 : remembered.hide18
	};
}
