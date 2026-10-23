import { json } from '@sveltejs/kit';
import { getApp, stackServer } from '$lib/server/app';
import type { Config } from '$lib/server/config';
import { crossSite } from '$lib/server/cross-site';
import { problem } from '$lib/server/proxy';
import type { SettingsStore } from '$lib/server/settings';
import { UNLOCK_COOKIE, unlockedUntil } from '$lib/server/unlock';
import { applyBody, parseSettingsBody, serverInEffect, toAnswer } from '$lib/settings';
import type { RequestHandler } from './$types';

/**
 * The settings as the unlocked browser is told them, without Batocera's password, and the Server settings in effect.
 * Spec 0.11.0, section 7, and 0.12.0, section 11.
 */
function answer(config: Config, settings: SettingsStore, until: string): Response {
	const saved = settings.get();
	const stack = stackServer(config);
	const inEffect = serverInEffect(saved.server, stack);
	return json(toAnswer(saved, until, settings.writable, inEffect, stack), { headers: { 'cache-control': 'no-store' } });
}

export const GET: RequestHandler = ({ cookies }) => {
	const { config, settings } = getApp();
	if (!settings) return problem(404, 'settings-off');
	const until = unlockedUntil(config.settingsPin, cookies.get(UNLOCK_COOKIE));
	if (!until) return problem(401, 'locked');
	return answer(config, settings, until);
};

export const PUT: RequestHandler = async ({ request, url, cookies }) => {
	const { config, settings } = getApp();
	if (!settings) return problem(404, 'settings-off');
	if (crossSite(request, url)) return problem(403, 'cross-site');
	const until = unlockedUntil(config.settingsPin, cookies.get(UNLOCK_COOKIE));
	if (!until) return problem(401, 'locked');
	const next = parseSettingsBody(await request.json().catch(() => null));
	if (!next) return problem(400, 'bad-settings');
	// Applied to the settings as the saves before it leave them.
	if (!(await settings.update((current) => applyBody(current, next)))) return problem(500, 'settings-unwritable');
	return answer(config, settings, until);
};
