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
			 * How many entries of the history lie between a detail, or a collection's sheet, and the list:
			 * 1 for one opened over the list (a sheet's state leaves it unset), one more for each sheet it
			 * was opened from in turn (2 from a sheet opened over the list, 3 from a sheet opened from that
			 * one, and so on), 0 when the page under it was opened by its address. Closing goes back that
			 * far, or, for 0, shows the list in its place.
			 */
			back?: number;
			/** The id of the collection from whose open row the game was opened: that row starts open. */
			shelf?: string;
			/** Set while the library at a glance lies over the list, opened by a click on the count. */
			glance?: true;
			/** Set while the settings, or the PIN prompt, lie over the list, opened by a click on "Settings" in the foot. */
			settings?: true;
		}
	}
}

export {};
