import { json } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { VERSION } from '$lib/version';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	const { store, rebuilder, client, updates, settings } = getApp();
	const index = store.get();
	return json(
		{
			status: index ? 'ok' : 'no-index',
			version: VERSION,
			index: index && {
				builtAt: index.builtAt,
				ageSeconds: Math.max(0, Math.round((Date.now() - Date.parse(index.builtAt)) / 1000)),
				entries: index.entries.length,
				version: index.version
			},
			rebuild: rebuilder.status(),
			login: client.loginState,
			cache: store.cacheState(),
			update: updates ? { latest: updates.latest, checkedAt: updates.checkedAt } : null,
			settings: settings === null ? 'off' : settings.writable ? 'ok' : 'unwritable'
		},
		{ status: index ? 200 : 503, headers: { 'cache-control': 'no-store' } }
	);
};
