import { dayWhen } from './age';
import { t } from './strings';

const MINUTE = 60_000;

/** The parts of a moment in a zone, put together from Intl's parts so that no version of Intl joins them its own way. */
function parts(at: Date, timeZone: string): Record<'year' | 'month' | 'day' | 'hour' | 'minute', string> {
	const found = new Intl.DateTimeFormat('en-GB', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
		timeZone
	}).formatToParts(at);
	const part = (type: Intl.DateTimeFormatPartTypes) => found.find((p) => p.type === type)?.value ?? '';
	return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute') };
}

/** The time of a moment on a 24-hour clock in the zone, and whether it is today there. */
function clock(at: Date, timeZone: string, now: Date): { time: string; today: boolean } {
	const then = parts(at, timeZone);
	const today = parts(now, timeZone);
	return {
		time: `${then.hour}:${then.minute}`,
		today: then.year === today.year && then.month === today.month && then.day === today.day
	};
}

/**
 * When something happened, as the panel "This Canvas" says it: "today at 11:04", else "21 October at 11:04", the day
 * as the foot writes days. On a 24-hour clock, in the given zone, and today is today in that zone.
 */
export function whenText(iso: string, timeZone: string, now: Date): string {
	const at = new Date(iso);
	const { time, today } = clock(at, timeZone, now);
	return today ? t.settings.facts.today(time) : t.settings.facts.onDay(dayWhen(at, timeZone), time);
}

/** When the library was read: "today at 11:04", else the day alone, "30 September", so that the next read fits its line. */
export function whenRead(iso: string, timeZone: string, now: Date): string {
	const at = new Date(iso);
	const { time, today } = clock(at, timeZone, now);
	return today ? t.settings.facts.today(time) : dayWhen(at, timeZone);
}

/** How long Canvas has run: "45 minutes" under an hour, "2 hours" under two days, then "3 days". Whole ones, rounded down. */
export function runningFor(startedAt: string, now: Date): string {
	const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(startedAt)) / MINUTE));
	if (minutes < 60) return t.settings.facts.minutes(minutes);
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return t.settings.facts.hours(hours);
	return t.settings.facts.days(Math.floor(hours / 24));
}
