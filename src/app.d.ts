import type { Detail } from '$lib/types';

declare global {
	namespace App {
		interface PageState {
			/** The game whose detail lies over the list. Set when a card is clicked. */
			detail?: Detail;
			/** The address of the list under the detail, as the visitor last saw it there. */
			list?: string;
		}
	}
}

export {};
