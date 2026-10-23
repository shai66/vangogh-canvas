import { getApp } from '$lib/server/app';
import { crossSite } from '$lib/server/cross-site';
import { problem } from '$lib/server/proxy';
import type { RequestHandler } from './$types';

/** "Keep it on": cancels the shutdown after a send, for anyone. Spec 0.12.0, sections 6.2 and 11. */
export const POST: RequestHandler = ({ request, url }) => {
	const { batocera } = getApp();
	if (crossSite(request, url)) return problem(403, 'cross-site');
	if (!batocera?.ready()) return problem(404, 'batocera-off');
	batocera.keepOn();
	return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
};
