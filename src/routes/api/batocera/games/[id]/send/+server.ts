import { json } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { crossSite } from '$lib/server/cross-site';
import { problem } from '$lib/server/proxy';
import type { RequestHandler } from './$types';

/** Queues a send of the game to Batocera, or answers with its job already queued. Spec 0.12.0, sections 3.1 and 11. */
export const POST: RequestHandler = ({ request, url, params }) => {
	const { batocera } = getApp();
	if (crossSite(request, url)) return problem(403, 'cross-site');
	if (!batocera?.ready()) return problem(404, 'batocera-off');
	const job = batocera.send(params.id);
	if (job === null) return problem(404, 'not-in-library');
	if (job === 'cannot-go') return problem(409, 'cannot-go');
	return json(job, { status: 202, headers: { 'cache-control': 'no-store' } });
};
