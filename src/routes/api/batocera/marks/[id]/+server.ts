import type { RequestEvent } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { crossSite } from '$lib/server/cross-site';
import { problem } from '$lib/server/proxy';
import { UNLOCK_COOKIE, unlockedUntil } from '$lib/server/unlock';
import type { RequestHandler } from './$types';

/** Sets or takes back the mark "Doesn't run on Batocera", only in a browser with the settings unlocked. Spec 0.12.0, sections 7.6 and 11. */
async function mark({ request, url, cookies, params }: RequestEvent<{ id: string }>, marked: boolean): Promise<Response> {
	const { config, batocera } = getApp();
	if (crossSite(request, url)) return problem(403, 'cross-site');
	if (!batocera?.ready()) return problem(404, 'batocera-off');
	if (!unlockedUntil(config.settingsPin, cookies.get(UNLOCK_COOKIE))) return problem(401, 'locked');
	// A game id as the settings file keeps them.
	if (!/^\d+$/.test(params.id)) return problem(404, 'not-in-library');
	if (!(await batocera.mark(params.id, marked))) return problem(500, 'settings-unwritable');
	return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

export const PUT: RequestHandler = (event) => mark(event, true);
export const DELETE: RequestHandler = (event) => mark(event, false);
