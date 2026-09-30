// While a sheet is open the page behind it does not scroll. The room its
// scrollbar took is kept, so that nothing on the page moves sideways.

let open = 0;

export function lockPage(): void {
	if (open++ > 0) return;
	const root = document.documentElement;
	root.style.setProperty('--scrollbar', `${window.innerWidth - root.clientWidth}px`);
	root.classList.add('is-locked');
}

export function unlockPage(): void {
	if (open === 0 || --open > 0) return;
	document.documentElement.classList.remove('is-locked');
}
