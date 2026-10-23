import { json } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { VERSION } from '$lib/version';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	const { store, rebuilder, client, updates, updatesOn, startedAt, settings, batocera: service } = getApp();
	const index = store.get();
	const batocera = settings?.get().batocera;
	return json(
		{
			status: index ? 'ok' : 'no-index',
			version: VERSION,
			// Spec of the settings tabs, section 4: noted once, when the server started.
			startedAt,
			index: index && {
				builtAt: index.builtAt,
				ageSeconds: Math.max(0, Math.round((Date.now() - Date.parse(index.builtAt)) / 1000)),
				entries: index.entries.length,
				version: index.version
			},
			rebuild: rebuilder.status(),
			login: client.loginState,
			cache: store.cacheState(),
			update: updatesOn() ? { latest: updates.latest, checkedAt: updates.checkedAt } : null,
			settings: settings === null ? 'off' : settings.writable ? 'ok' : 'unwritable',
			// Spec 0.12.0, section 11: off without a PIN or with the switch off.
			batocera: !batocera?.on ? 'off' : batocera.ready ? 'ready' : 'not-set-up',
			// The sends to Batocera waiting or running.
			jobs: service?.jobs() ?? 0
		},
		{ status: index ? 200 : 503, headers: { 'cache-control': 'no-store' } }
	);
};
