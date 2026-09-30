import { getApp } from '$lib/server/app';
import { proxyImage } from '$lib/server/proxy';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, request }) => {
	const { client, log } = getApp();
	return proxyImage(client, params.imageId, request, log);
};
