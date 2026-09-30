const DAY = 86_400_000;

/** From this age on the foot of the page warns: two daily rebuilds did not happen. */
export const STALE_DAYS = 2;

/** When the index was built, or null when the text is not a time. */
export function builtTime(builtAt: string | null): Date | null {
	if (!builtAt) return null;
	const time = new Date(builtAt);
	return Number.isNaN(time.getTime()) ? null : time;
}

/** Whole days since the index was built. A time in the future counts as today. */
export function ageInDays(builtAt: string | null, now: number = Date.now()): number {
	const built = builtTime(builtAt);
	return built ? Math.max(0, Math.floor((now - built.getTime()) / DAY)) : 0;
}

/** True when the library was not updated for two days or more. */
export function isStale(builtAt: string | null, now: number = Date.now()): boolean {
	return ageInDays(builtAt, now) >= STALE_DAYS;
}

/**
 * The time of the build as the foot writes it: "30 September, 04:30", on a 24-hour
 * clock, in the given time zone. Put together from its parts, so that it does not
 * depend on how the version of Intl in the server or the browser joins them.
 */
export function builtWhen(built: Date, timeZone: string): string {
	const parts = new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'long',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
		timeZone
	}).formatToParts(built);
	const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
	return `${part('day')} ${part('month')}, ${part('hour')}:${part('minute')}`;
}
