import { json } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { problem } from '$lib/server/proxy';
import type { RequestHandler } from './$types';

/** A game's Batocera state from the last look at the box, which a look older than a minute renews. Spec 0.12.0, sections 4.2 and 11. */
export const GET: RequestHandler = async ({ params }) => {
	const { batocera } = getApp();
	if (!batocera?.ready()) return problem(404, 'batocera-off');
	const state = await batocera.state(params.id);
	if (!state) return problem(404, 'not-in-library');
	return json(state, { headers: { 'cache-control': 'no-store' } });
};
