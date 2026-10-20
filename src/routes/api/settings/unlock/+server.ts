import { getApp } from '$lib/server/app';
import { crossSite } from '$lib/server/cross-site';
import { problem } from '$lib/server/proxy';
import { isPin, UNLOCK_COOKIE, UNLOCK_SECONDS, unlockValue } from '$lib/server/unlock';
import type { RequestHandler } from './$types';

/** How long a wrong PIN waits for its answer: it slows guessing at no cost to a person. */
const WRONG_PIN_DELAY_MS = 1000;

export const POST: RequestHandler = async ({ request, url, cookies }) => {
	const pin = getApp().config.settingsPin;
	if (!pin) return problem(404, 'settings-off');
	if (crossSite(request, url)) return problem(403, 'cross-site');
	const body: unknown = await request.json().catch(() => null);
	const typed = body !== null && typeof body === 'object' ? (body as { pin?: unknown }).pin : undefined;
	if (!isPin(pin, typed)) {
		await new Promise((resolve) => setTimeout(resolve, WRONG_PIN_DELAY_MS));
		return problem(401, 'wrong-pin');
	}
	const expiry = Math.floor(Date.now() / 1000) + UNLOCK_SECONDS;
	// Not `secure`: Canvas is served over plain HTTP at home.
	cookies.set(UNLOCK_COOKIE, unlockValue(pin, expiry), {
		path: '/',
		httpOnly: true,
		sameSite: 'strict',
		secure: false,
		maxAge: UNLOCK_SECONDS
	});
	return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
};
