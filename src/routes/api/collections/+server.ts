import { json } from '@sveltejs/kit';
import { parseCreateBody } from '$lib/own';
import { getApp } from '$lib/server/app';
import { crossSite } from '$lib/server/cross-site';
import { problem } from '$lib/server/proxy';
import { UNLOCK_COOKIE, unlockedUntil } from '$lib/server/unlock';
import type { RequestHandler } from './$types';

/** Makes an own collection, guarded as the settings are. Spec of own collections, section 13. */
export const POST: RequestHandler = async ({ request, url, cookies }) => {
	const { config, own } = getApp();
	if (!own) return problem(404, 'settings-off');
	if (crossSite(request, url)) return problem(403, 'cross-site');
	if (!unlockedUntil(config.settingsPin, cookies.get(UNLOCK_COOKIE))) return problem(401, 'locked');
	const body = parseCreateBody(await request.json().catch(() => null));
	if (!body) return problem(400, 'bad-collection');
	const made = await own.create(body);
	if (!made.ok) return made.error === 'name-taken' ? problem(409, 'name-taken') : problem(500, 'settings-unwritable');
	return json({ collection: made.collection }, { status: 201, headers: { 'cache-control': 'no-store' } });
};
