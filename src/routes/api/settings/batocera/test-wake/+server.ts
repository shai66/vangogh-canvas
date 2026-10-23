import { getApp } from '$lib/server/app';
import { ndjson } from '$lib/server/batocera/service';
import { crossSite } from '$lib/server/cross-site';
import { problem } from '$lib/server/proxy';
import { UNLOCK_COOKIE, unlockedUntil } from '$lib/server/unlock';
import type { RequestHandler } from './$types';

/** The wake test, a line as each step ends; usable once a connection test saved the MAC. Spec 0.12.0, sections 9.5 and 11. */
export const POST: RequestHandler = ({ request, url, cookies }) => {
	const { config, settings, batocera } = getApp();
	if (!settings || !batocera) return problem(404, 'settings-off');
	if (crossSite(request, url)) return problem(403, 'cross-site');
	if (!unlockedUntil(config.settingsPin, cookies.get(UNLOCK_COOKIE))) return problem(401, 'locked');
	if (!settings.get().batocera.mac) return problem(400, 'no-mac');
	return ndjson(batocera.testWake());
};
