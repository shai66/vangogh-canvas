import { json } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { problem } from '$lib/server/proxy';
import type { RequestHandler } from './$types';

/** True when a browser sent the request from a page of another site. */
function crossSite(request: Request, url: URL): boolean {
	const origin = request.headers.get('origin');
	if (origin !== null) {
		let host: string | null = null;
		try {
			host = new URL(origin).host;
		} catch {
			// "null" or anything else that is not an address.
		}
		if (host !== url.host) return true;
	}
	const site = request.headers.get('sec-fetch-site');
	return site !== null && site !== 'same-origin' && site !== 'none';
}

export const POST: RequestHandler = ({ request, url }) => {
	// A tool like curl sends neither header and is accepted.
	if (crossSite(request, url)) return problem(403, 'cross-site');
	const started = getApp().rebuilder.start() === 'started';
	return json(
		{ status: started ? 'started' : 'busy' },
		{ status: started ? 202 : 409, headers: { 'cache-control': 'no-store' } }
	);
};
