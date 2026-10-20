import { crossSite } from '$lib/server/cross-site';
import { problem } from '$lib/server/proxy';
import { UNLOCK_COOKIE } from '$lib/server/unlock';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request, url, cookies }) => {
	if (crossSite(request, url)) return problem(403, 'cross-site');
	cookies.delete(UNLOCK_COOKIE, { path: '/', secure: false });
	return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
};
