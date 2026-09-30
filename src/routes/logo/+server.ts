import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import builtIn from '$lib/assets/logo.svg?raw';
import { getApp } from '$lib/server/app';
import type { RequestHandler } from './$types';

const TYPES: Record<string, string> = {
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.webp': 'image/webp'
};

const HEADERS = {
	'cache-control': 'public, max-age=3600',
	'x-content-type-options': 'nosniff',
	// An SVG can hold a script. This keeps one from running.
	'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'"
};

let warned = false;

export const GET: RequestHandler = async () => {
	const { config, log } = getApp();
	if (config.customLogo) {
		const type = TYPES[extname(config.customLogo).toLowerCase()];
		try {
			if (!type) throw new Error('the logo must be an svg, png or webp file');
			const body = await readFile(config.customLogo);
			return new Response(body, { headers: { ...HEADERS, 'content-type': type } });
		} catch (error) {
			if (!warned) {
				warned = true;
				log.warn('the custom logo cannot be used, showing the built-in one', {
					file: config.customLogo,
					reason: error instanceof Error ? error.message : String(error)
				});
			}
		}
	}
	return new Response(builtIn, { headers: { ...HEADERS, 'content-type': 'image/svg+xml' } });
};
