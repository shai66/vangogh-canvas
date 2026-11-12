import { json } from '@sveltejs/kit';
import { isOwnId, parsePatchBody } from '$lib/own';
import { getApp } from '$lib/server/app';
import { crossSite } from '$lib/server/cross-site';
import type { OwnError } from '$lib/server/own-store';
import { problem } from '$lib/server/proxy';
import { UNLOCK_COOKIE, unlockedUntil } from '$lib/server/unlock';
import type { RequestHandler } from './$types';

/** The answer to a change the store refused; `no-collection` when another request deleted it meanwhile. */
function refused(error: OwnError): Response {
	if (error === 'name-taken') return problem(409, 'name-taken');
	if (error === 'no-collection') return problem(404, 'no-collection');
	return problem(500, 'settings-unwritable');
}

/** Renames an own collection, or adds or removes members. Spec of own collections, section 13. */
export const PATCH: RequestHandler = async ({ request, url, cookies, params }) => {
	const { config, own } = getApp();
	if (!own) return problem(404, 'settings-off');
	if (crossSite(request, url)) return problem(403, 'cross-site');
	if (!unlockedUntil(config.settingsPin, cookies.get(UNLOCK_COOKIE))) return problem(401, 'locked');
	if (!isOwnId(params.id) || !own.get(params.id)) return problem(404, 'no-collection');
	const body = parsePatchBody(await request.json().catch(() => null));
	if (!body) return problem(400, 'bad-collection');
	const changed = await own.change(params.id, body);
	if (!changed.ok) return refused(changed.error);
	return json({ collection: changed.collection }, { headers: { 'cache-control': 'no-store' } });
};

/** Deletes an own collection. Spec of own collections, section 13. */
export const DELETE: RequestHandler = async ({ request, url, cookies, params }) => {
	const { config, own } = getApp();
	if (!own) return problem(404, 'settings-off');
	if (crossSite(request, url)) return problem(403, 'cross-site');
	if (!unlockedUntil(config.settingsPin, cookies.get(UNLOCK_COOKIE))) return problem(401, 'locked');
	if (!isOwnId(params.id) || !own.get(params.id)) return problem(404, 'no-collection');
	const removed = await own.remove(params.id);
	if (!removed.ok) return refused(removed.error);
	return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
};
