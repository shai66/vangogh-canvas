/**
 * Puts a text on the clipboard, and says whether that worked (0.11.0, spec 6.3). Canvas is served over plain HTTP
 * at home, where browsers withhold the clipboard API: there a hidden text area is selected and copied, the way
 * pages copied before the API existed.
 */
export async function copyText(text: string): Promise<boolean> {
	if (window.isSecureContext && navigator.clipboard) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// Refused, as a browser may: the old way may still work.
		}
	}
	return copyBySelection(text);
}

function copyBySelection(text: string): boolean {
	const before = document.activeElement;
	const area = document.createElement('textarea');
	area.value = text;
	area.readOnly = true;
	area.setAttribute('aria-hidden', 'true');
	// Out of the flow and unseen: nothing on the page moves.
	Object.assign(area.style, { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
	// An open modal dialog makes the rest of the page inert, and an inert text area cannot be selected.
	(document.querySelector('dialog[open]') ?? document.body).append(area);
	try {
		area.focus({ preventScroll: true });
		area.select();
		return document.execCommand('copy');
	} catch {
		return false;
	} finally {
		area.remove();
		if (before instanceof HTMLElement) before.focus({ preventScroll: true });
	}
}
