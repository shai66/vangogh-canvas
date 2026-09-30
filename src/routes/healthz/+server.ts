import { json } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { VERSION } from '$lib/version';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	const { store, rebuilder, client } = getApp();
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
			login: client.loginRejected ? 'rejected' : 'ok',
			cache: store.cacheState()
		},
		{ status: index ? 200 : 503, headers: { 'cache-control': 'no-store' } }
	);
};
