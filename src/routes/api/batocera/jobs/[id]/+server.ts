import { getApp } from '$lib/server/app';
import { crossSite } from '$lib/server/cross-site';
import { problem } from '$lib/server/proxy';
import type { RequestHandler } from './$types';

/** "Stop sending": ends a send that waits or runs, and leaves nothing on the box. Spec 0.12.0, sections 3.5 and 11. */
export const DELETE: RequestHandler = ({ request, url, params }) => {
	const { batocera } = getApp();
	if (crossSite(request, url)) return problem(403, 'cross-site');
	if (!batocera?.ready()) return problem(404, 'batocera-off');
	if (!batocera.stop(params.id)) return problem(404, 'no-such-job');
	return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
};
