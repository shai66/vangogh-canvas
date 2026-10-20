import { json } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { crossSite } from '$lib/server/cross-site';
import { problem } from '$lib/server/proxy';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request, url }) => {
	// A tool like curl sends neither header and is accepted.
	if (crossSite(request, url)) return problem(403, 'cross-site');
	const started = getApp().rebuilder.start() === 'started';
	return json(
		{ status: started ? 'started' : 'busy' },
		{ status: started ? 202 : 409, headers: { 'cache-control': 'no-store' } }
	);
};
