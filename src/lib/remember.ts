import { ALL_OS, type Os } from './types';
import type { Sort, ViewState } from './search/state';

/**
 * The browser remembers two settings of the view: the platform filter and
 * the sort order. They are kept in a cookie and not in local storage, so that
 * the server can draw the list the way it was left, without a second draw.
 * Canvas stores nothing about it.
 */
export const REMEMBER_COOKIE = 'canvas-view';

export interface Remembered {
	os: Os[];
	sort: Sort;
}

export const NOTHING_REMEMBERED: Remembered = { os: [], sort: 'title' };

/** Reads the value of the cookie. Anything it does not know is dropped. */
export function parseRemembered(value: string | undefined): Remembered {
	if (!value) return NOTHING_REMEMBERED;
	const [os = '', sort = ''] = value.split('|');
	const wanted = os.split('+');
	return {
		// In the fixed order, each once.
		os: ALL_OS.filter((name) => wanted.includes(name)),
		sort: sort === 'recent' ? 'recent' : 'title'
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
 * uses only characters a cookie may hold: names joined by `+`, then `|`, then the order.
 */
export function rememberedCookie(state: Pick<ViewState, 'os' | 'sort'>): string {
	return `${REMEMBER_COOKIE}=${state.os.join('+')}|${state.sort}; Max-Age=31536000; Path=/; SameSite=Lax`;
}

/**
 * What is remembered after a change of the view, or null when the change leaves it alone.
 * Only the part the visitor changed is taken: a new order keeps the platforms as they were
 * remembered, and new platforms keep the order. The rest of the view may have come from an
 * address, which the visitor did not choose.
 */
export function nextRemembered(remembered: Remembered, before: ViewState, after: ViewState): Remembered | null {
	const os = before.os.join('+') !== after.os.join('+');
	const sort = before.sort !== after.sort;
	if (!os && !sort) return null;
	return { os: os ? [...after.os] : remembered.os, sort: sort ? after.sort : remembered.sort };
}
