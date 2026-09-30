import { getApp } from '$lib/server/app';
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
		builtAt: index?.builtAt ?? null,
		version: VERSION,
		timeZone: config.timeZone,
		visitor: detectVisitor(request.headers.get('user-agent') ?? ''),
		remembered: parseRemembered(cookies.get(REMEMBER_COOKIE))
	};
};
