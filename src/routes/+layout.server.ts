import { preparingState } from '$lib/preparing';
import { getApp, stackServer } from '$lib/server/app';
import { glanceFor } from '$lib/server/glance';
import { UNLOCK_COOKIE, unlockedUntil } from '$lib/server/unlock';
import { parseRemembered, REMEMBER_COOKIE } from '$lib/remember';
import { batoceraReady, NO_SETTINGS, serverInEffect, toAnswer, type SettingsInfo } from '$lib/settings';
import { VERSION } from '$lib/version';
import { detectVisitor } from '$lib/visitor';
import type { LayoutServerLoad } from './$types';

/** What every page needs: the whole list, and a few facts about Canvas and the visitor. */
export const load: LayoutServerLoad = ({ request, cookies }) => {
	const { store, config, updates, updatesOn, rebuilder, client, settings } = getApp();
	const index = store.get();
	const saved = settings?.get() ?? NO_SETTINGS;
	const until = unlockedUntil(config.settingsPin, cookies.get(UNLOCK_COOKIE));
	// The Server settings that apply; without settings, the stack's.
	const stack = stackServer(config);
	const inEffect = serverInEffect(saved.server, stack);
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
		update: updatesOn() ? updates.newer : null,
		timeZone: inEffect.timeZone,
		visitor: detectVisitor(request.headers.get('user-agent') ?? ''),
		// Spec 0.11.0, section 5: a browser that has not chosen its own view opens with the defaults.
		defaults: saved.defaults,
		remembered: cookies.get(REMEMBER_COOKIE) ? parseRemembered(cookies.get(REMEMBER_COOKIE)) : saved.defaults,
		settings: {
			enabled: settings !== null,
			theo: saved.theo,
			// Spec 0.12.0, section 11: what a game's detail needs of Batocera, for every visitor.
			preferred: saved.preferred,
			batocera: { ready: batoceraReady(saved), wake: saved.batocera.wake },
			notRunning: saved.notRunning,
			unlockedUntil: until,
			writable: settings?.writable ?? true,
			// The rest of the settings only for an unlocked browser, and never the password.
			answer: settings && until ? toAnswer(saved, until, settings.writable, inEffect, stack) : null
		} satisfies SettingsInfo
	};
};
