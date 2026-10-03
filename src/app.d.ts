import type { Detail } from '$lib/types';

declare global {
	namespace App {
		interface PageState {
			/** The game whose detail lies over the list. Set when a card is clicked. */
			detail?: Detail;
			/** The address of the list under the detail or the sheet, as the visitor last saw it there. */
			list?: string;
			/** The id of the collection whose sheet lies over the list. Set when its card is clicked. */
			collection?: string;
			/**
			 * How many entries of the history lie between a detail and the list: 1 for a detail opened
			 * over the list, 2 for one opened from a collection's sheet that was opened over the list,
			 * 0 when the page under it was opened by its address. Closing goes back that far, or, for
			 * 0, shows the list in place of the detail.
			 */
			back?: 0 | 1 | 2;
			/** True for a game opened from the open row of its collection: its row starts open. */
			shelf?: boolean;
		}
	}
}

export {};
