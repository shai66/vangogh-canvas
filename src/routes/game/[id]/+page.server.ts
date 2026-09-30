import { getApp } from '$lib/server/app';
import type { PageServerLoad } from './$types';

/** The detail of one game. A game that is not in the library gives `null`, and the page says so. */
export const load: PageServerLoad = ({ params }) => {
	const index = getApp().store.get();
	const detail = index && Object.hasOwn(index.details, params.id) ? index.details[params.id] : null;
	return { detail };
};
