import { json } from '@sveltejs/kit';
import { getApp, stackServer } from '$lib/server/app';
import { problem } from '$lib/server/proxy';
import { UNLOCK_COOKIE, unlockedUntil } from '$lib/server/unlock';
import { serverInEffect, type ServerStatus } from '$lib/settings';
import { VERSION } from '$lib/version';
import type { RequestHandler } from './$types';

/** What the server says now, for the panel "This Canvas": behind the unlock, since it names vangogh's address. Spec of the settings tabs, section 4. */
export const GET: RequestHandler = ({ cookies }) => {
	const { config, settings, store, rebuilder, client, updates, updatesOn, startedAt, batocera } = getApp();
	if (!settings) return problem(404, 'settings-off');
	const until = unlockedUntil(config.settingsPin, cookies.get(UNLOCK_COOKIE));
	if (!until) return problem(401, 'locked');
	const saved = settings.get();
	const inEffect = serverInEffect(saved.server, stackServer(config));
	const index = store.get();
	const { running, lastResult, lastError } = rebuilder.status();
	const status: ServerStatus = {
		version: VERSION,
		update: updatesOn() ? { latest: updates.latest, newer: updates.newer, checkedAt: updates.checkedAt } : null,
		startedAt,
		vangogh: { url: config.vangoghUrl, login: client.loginState },
		library: {
			games: index?.entries.length ?? 0,
			collections: index?.collections.length ?? 0,
			builtAt: index?.builtAt ?? null,
			nextAt: inEffect.rebuildAt,
			rebuild: { running, lastResult, lastError }
		},
		// As `/healthz` says it.
		batocera: !saved.batocera.on ? 'off' : saved.batocera.ready ? 'ready' : 'not-set-up',
		jobs: batocera?.jobs() ?? 0,
		timeZone: inEffect.timeZone
	};
	return json(status, { headers: { 'cache-control': 'no-store' } });
};
