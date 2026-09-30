import { json } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { problem } from '$lib/server/proxy';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	const index = getApp().store.get();
	if (!index) return problem(503, 'index-not-ready');
	const detail = Object.hasOwn(index.details, params.id) ? index.details[params.id] : null;
	if (!detail) return problem(404, 'not-in-library');
	return json(detail, { headers: { 'cache-control': 'no-cache' } });
};
