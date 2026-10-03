/** A title that does not fit runs slowly to its end and back while its card is pointed at or focused. */
export function runTitle(title: HTMLElement): void {
	const over = title.scrollWidth - title.clientWidth;
	const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	if (over <= 0 || still || title.classList.contains('is-running')) return;
	title.style.setProperty('--run', `${-over - 4}px`);
	title.style.setProperty('--run-time', `${Math.max(5, over / 14 + 4)}s`);
	title.classList.add('is-running');
}

export function restTitle(title: HTMLElement): void {
	title.classList.remove('is-running');
}
