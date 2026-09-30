import { json } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { problem } from '$lib/server/proxy';
import type { IndexPayload } from '$lib/types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request }) => {
	const index = getApp().store.get();
	if (!index) return problem(503, 'index-not-ready');

	const etag = `"${index.version}"`;
	// A 304 must tell the browser too when the list was last checked against vangogh.
	const headers = { etag, 'cache-control': 'no-cache', 'x-built-at': index.builtAt };
	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, { status: 304, headers });
	}
	const body: IndexPayload = {
		builtAt: index.builtAt,
		version: index.version,
		entries: index.entries
	};
	return json(body, { headers });
};
