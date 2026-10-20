import { preparingState } from '$lib/preparing';
import { getApp } from '$lib/server/app';
import { glanceFor } from '$lib/server/glance';
import { UNLOCK_COOKIE, unlockedUntil } from '$lib/server/unlock';
import { parseRemembered, REMEMBER_COOKIE } from '$lib/remember';
import { NO_SETTINGS, type SettingsInfo } from '$lib/settings';
import { VERSION } from '$lib/version';
import { detectVisitor } from '$lib/visitor';
import type { LayoutServerLoad } from './$types';

/** What every page needs: the whole list, and a few facts about Canvas and the visitor. */
export const load: LayoutServerLoad = ({ request, cookies }) => {
	const { store, config, updates, rebuilder, client, settings } = getApp();
	const index = store.get();
	const saved = settings?.get() ?? NO_SETTINGS;
	return {
		ready: index !== null,
		// Without a library: whether Canvas is reading the archive or the last reading failed, and why (0.10.2).
		preparing: index ? null : preparingState(rebuilder.status(), client.loginState),
		entries: index?.entries ?? [],
		collections: index?.collections ?? [],
		// Worked out once per index, from the details on the server: the page gets the numbers only.
		glance: index ? glanceFor(index) : null,
		builtAt: index?.builtAt ?? null,
		version: VERSION,
		// Spec 0.10.0, section 7.6: the newer release, or null. Read with the page, as the built time is.
		update: updates?.newer ?? null,
		timeZone: config.timeZone,
		visitor: detectVisitor(request.headers.get('user-agent') ?? ''),
		// Spec 0.11.0, section 5: a browser that has not chosen its own view opens with the defaults.
		defaults: saved.defaults,
		remembered: cookies.get(REMEMBER_COOKIE) ? parseRemembered(cookies.get(REMEMBER_COOKIE)) : saved.defaults,
		settings: {
			enabled: settings !== null,
			theo: saved.theo,
			unlockedUntil: unlockedUntil(config.settingsPin, cookies.get(UNLOCK_COOKIE)),
			writable: settings?.writable ?? true
		} satisfies SettingsInfo
	};
};
