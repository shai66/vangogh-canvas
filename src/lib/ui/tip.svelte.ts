/**
 * The tooltips of the small icon buttons in a game's detail: the TV, the "i" and the flag (spec of the detail
 * with Batocera, 6.4 and call 14). One is open in the page at a time; how it was opened decides what closes it.
 */

/** How a tooltip was opened: by a mouse pointing at it, by the keyboard's focus, or by a tap or a click. */
export type TipBy = 'pointer' | 'focus' | 'tap';
export interface OpenTip {
	id: string;
	by: TipBy;
}
export type TipEvent = { kind: 'enter' | 'leave' | 'focus' | 'blur' | 'tap'; id: string } | { kind: 'escape' | 'away' };

/**
 * The tooltip open after an event: one in the page at a time (spec 6.4, call 14). Pointing keeps a tooltip that is
 * already open, however it was opened, and the pointer's leaving closes only one it opened; a blur closes its own
 * however it was opened; a tap toggles its own; Esc and a tap elsewhere close it. Any opening replaces another.
 */
export function nextTip(open: OpenTip | null, event: TipEvent): OpenTip | null {
	// Esc and a tap elsewhere close it.
	if (!('id' in event)) return null;
	const own = open?.id === event.id;
	switch (event.kind) {
		case 'enter':
			return own ? open : { id: event.id, by: 'pointer' };
		case 'leave':
			return own && open?.by === 'pointer' ? null : open;
		case 'blur':
			return own ? null : open;
		case 'focus':
			return { id: event.id, by: 'focus' };
		case 'tap':
			return own && open?.by === 'tap' ? null : { id: event.id, by: 'tap' };
	}
}

/** The page's open tooltip, shared by every TipButton. */
export const tips = $state<{ open: OpenTip | null }>({ open: null });
