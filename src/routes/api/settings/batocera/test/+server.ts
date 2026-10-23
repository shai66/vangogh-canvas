import { getApp } from '$lib/server/app';
import { ndjson } from '$lib/server/batocera/service';
import { crossSite } from '$lib/server/cross-site';
import { problem } from '$lib/server/proxy';
import { UNLOCK_COOKIE, unlockedUntil } from '$lib/server/unlock';
import { isBoxAddress, isBoxPassword, isBoxUser } from '$lib/settings';
import type { RequestHandler } from './$types';

/** The body `{ address, user, password? }`, checked as the settings are, or null; an address must be given. */
function parseTest(body: unknown): { address: string; user: string; password?: string } | null {
	if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
	const { address, user, password } = body as Record<string, unknown>;
	if (!isBoxAddress(address) || address === '' || !isBoxUser(user)) return null;
	// No password tests the saved one.
	if (password !== undefined && !isBoxPassword(password)) return null;
	return { address, user, ...(password === undefined ? {} : { password }) };
}

/** The connection test, a line as each check ends. Spec 0.12.0, sections 9.3 and 11. */
export const POST: RequestHandler = async ({ request, url, cookies }) => {
	const { config, batocera } = getApp();
	if (!batocera) return problem(404, 'settings-off');
	if (crossSite(request, url)) return problem(403, 'cross-site');
	if (!unlockedUntil(config.settingsPin, cookies.get(UNLOCK_COOKIE))) return problem(401, 'locked');
	const input = parseTest(await request.json().catch(() => null));
	if (!input) return problem(400, 'bad-settings');
	return ndjson(batocera.testConnection(input));
};
