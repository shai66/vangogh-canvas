import { getApp } from '$lib/server/app';
import type { PageServerLoad } from './$types';

/** A collection's sheet over the list. A collection that is not in the index gives `null`, and the page says so. */
export const load: PageServerLoad = ({ params }) => {
	const index = getApp().store.get();
	return { collection: index?.collections.find((c) => c.id === params.id) ?? null };
};
