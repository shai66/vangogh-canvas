import { error } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import type { PageServerLoad } from './$types';

/** The settings, or the PIN prompt, over the list. Without a PIN there are no settings, and no page for them. */
export const load: PageServerLoad = () => {
	if (!getApp().settings) error(404, 'Not found');
};
