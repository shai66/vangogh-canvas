import { isOwnId } from '$lib/own';
import { getApp } from '$lib/server/app';
import type { PageServerLoad } from './$types';

/**
 * A collection's sheet over the list: GOG's from the index, or an own one as kept (`linkedOwn`; the layout's `own`
 * holds them all). Each is `null` when there is none, and when both are the page says so.
 */
export const load: PageServerLoad = ({ params }) => {
	const { store, own } = getApp();
	const index = store.get();
	return {
		collection: index?.collections.find((c) => c.id === params.id) ?? null,
		linkedOwn: isOwnId(params.id) ? (own?.get(params.id) ?? null) : null
	};
};
