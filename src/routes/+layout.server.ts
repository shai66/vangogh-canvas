import { getApp } from '$lib/server/app';
import { glanceFor } from '$lib/server/glance';
import { parseRemembered, REMEMBER_COOKIE } from '$lib/remember';
import { VERSION } from '$lib/version';
import { detectVisitor } from '$lib/visitor';
import type { LayoutServerLoad } from './$types';

/** What every page needs: the whole list, and a few facts about Canvas and the visitor. */
export const load: LayoutServerLoad = ({ request, cookies }) => {
	const { store, config } = getApp();
	const index = store.get();
	return {
		ready: index !== null,
		entries: index?.entries ?? [],
		collections: index?.collections ?? [],
		// Worked out once per index, from the details on the server: the page gets the numbers only.
		glance: index ? glanceFor(index) : null,
		builtAt: index?.builtAt ?? null,
		version: VERSION,
		timeZone: config.timeZone,
		visitor: detectVisitor(request.headers.get('user-agent') ?? ''),
		remembered: parseRemembered(cookies.get(REMEMBER_COOKIE))
	};
};
