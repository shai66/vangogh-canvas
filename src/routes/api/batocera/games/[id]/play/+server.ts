import { json } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { crossSite } from '$lib/server/cross-site';
import { problem } from '$lib/server/proxy';
import type { RequestHandler } from './$types';

/** "Play on the TV": starts a game that is on Batocera, waking the box first when it must. Spec 0.12.0, sections 5 and 11. */
export const POST: RequestHandler = async ({ request, url, params }) => {
	const { batocera } = getApp();
	if (crossSite(request, url)) return problem(403, 'cross-site');
	if (!batocera?.ready()) return problem(404, 'batocera-off');
	// `{ closeRunning: true }` closes a game running on the TV first; anything else asks.
	const body: unknown = await request.json().catch(() => null);
	const closeRunning = typeof body === 'object' && body !== null && (body as { closeRunning?: unknown }).closeRunning === true;
	const played = await batocera.play(params.id, closeRunning);
	if (!played) return problem(404, 'not-in-library');
	const headers = { 'cache-control': 'no-store' };
	switch (played.state) {
		case 'started':
			return json({ started: true }, { headers });
		case 'waking':
			// The detail asks the game's state again for the result.
			return json({ waking: true }, { status: 202, headers });
		case 'running':
			return json({ error: 'game-running', name: played.name }, { status: 409, headers });
		case 'no-screen':
			return problem(409, 'no-screen');
		case 'not-started':
			return problem(409, 'not-started');
		case 'gone':
			return problem(409, 'not-on-box');
		case 'box-down':
			return problem(503, 'box-down');
	}
};
