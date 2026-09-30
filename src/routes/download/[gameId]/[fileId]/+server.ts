import { getApp } from '$lib/server/app';
import { problem, proxyFile } from '$lib/server/proxy';
import type { RequestEvent, RequestHandler } from './$types';

function serve({ params, request }: RequestEvent, check: boolean): Promise<Response> | Response {
	const { store, client, log } = getApp();
	const index = store.get();
	if (!index) return problem(503, 'index-not-ready');
	const key = `${params.gameId}/${params.fileId}`;
	// The address in vangogh comes from the index, never from the browser.
	const target = Object.hasOwn(index.files, key) ? index.files[key] : null;
	if (!target) return problem(404, 'not-in-library');
	return proxyFile(client, target, request, { check, log });
}

export const GET: RequestHandler = (event) => serve(event, false);
export const HEAD: RequestHandler = (event) => serve(event, true);
