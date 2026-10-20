import { json } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { crossSite } from '$lib/server/cross-site';
import { problem } from '$lib/server/proxy';
import type { SettingsStore } from '$lib/server/settings';
import { UNLOCK_COOKIE, unlockedUntil } from '$lib/server/unlock';
import { parseSettingsBody, type SettingsAnswer } from '$lib/settings';
import type { RequestHandler } from './$types';

/** The settings as the unlocked browser is told them. Spec 0.11.0, section 7. */
function answer(settings: SettingsStore, until: string): Response {
	const body: SettingsAnswer = { ...settings.get(), unlockedUntil: until, writable: settings.writable };
	return json(body, { headers: { 'cache-control': 'no-store' } });
}

export const GET: RequestHandler = ({ cookies }) => {
	const { config, settings } = getApp();
	if (!settings) return problem(404, 'settings-off');
	const until = unlockedUntil(config.settingsPin, cookies.get(UNLOCK_COOKIE));
	if (!until) return problem(401, 'locked');
	return answer(settings, until);
};

export const PUT: RequestHandler = async ({ request, url, cookies }) => {
	const { config, settings } = getApp();
	if (!settings) return problem(404, 'settings-off');
	if (crossSite(request, url)) return problem(403, 'cross-site');
	const until = unlockedUntil(config.settingsPin, cookies.get(UNLOCK_COOKIE));
	if (!until) return problem(401, 'locked');
	const next = parseSettingsBody(await request.json().catch(() => null));
	if (!next) return problem(400, 'bad-settings');
	if (!(await settings.save(next))) return problem(500, 'settings-unwritable');
	return answer(settings, until);
};
