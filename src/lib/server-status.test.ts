import { describe, expect, it } from 'vitest';
import { runningFor, whenRead, whenText } from './server-status';

describe('whenText', () => {
	const now = new Date('2026-10-21T08:00:00Z');

	it('says today with the time, on a 24-hour clock', () => {
		expect(whenText('2026-10-21T07:04:00Z', 'UTC', now)).toBe('today at 07:04');
		expect(whenText('2026-10-21T07:04:00Z', 'Europe/Berlin', now)).toBe('today at 09:04');
	});

	it('names another day as the foot writes days', () => {
		expect(whenText('2026-10-20T11:04:00Z', 'UTC', now)).toBe('20 October at 11:04');
		expect(whenText('2026-10-02T23:15:00Z', 'UTC', now)).toBe('2 October at 23:15');
	});

	it('counts the days in the given zone, across midnight in Berlin', () => {
		// 00:30 on 21 October in Berlin, still 20 October in UTC.
		expect(whenText('2026-10-20T22:30:00Z', 'Europe/Berlin', now)).toBe('today at 00:30');
		expect(whenText('2026-10-20T22:30:00Z', 'UTC', now)).toBe('20 October at 22:30');
		// A minute before Berlin's midnight is yesterday there.
		expect(whenText('2026-10-20T21:59:00Z', 'Europe/Berlin', now)).toBe('20 October at 23:59');
		// Ten past midnight in Berlin, still 21 October in UTC: twenty minutes ago is yesterday in Berlin only.
		const late = new Date('2026-10-21T22:10:00Z');
		expect(whenText('2026-10-21T21:50:00Z', 'Europe/Berlin', late)).toBe('21 October at 23:50');
		expect(whenText('2026-10-21T21:50:00Z', 'UTC', late)).toBe('today at 21:50');
	});

	it('does not take the same day of another year for today', () => {
		expect(whenText('2025-10-21T07:04:00Z', 'UTC', now)).toBe('21 October at 07:04');
	});
});

describe('whenRead', () => {
	const now = new Date('2026-10-21T08:00:00Z');

	it('says today with the time, and another day without it', () => {
		expect(whenRead('2026-10-21T07:04:00Z', 'UTC', now)).toBe('today at 07:04');
		expect(whenRead('2026-09-30T04:30:00Z', 'UTC', now)).toBe('30 September');
	});

	it('counts the days in the given zone, across midnight in Berlin', () => {
		expect(whenRead('2026-10-20T22:30:00Z', 'Europe/Berlin', now)).toBe('today at 00:30');
		expect(whenRead('2026-10-20T22:30:00Z', 'UTC', now)).toBe('20 October');
	});
});

describe('runningFor', () => {
	const start = '2026-10-21T09:00:00Z';
	const after = (ms: number) => new Date(Date.parse(start) + ms);
	const MINUTE = 60_000;
	const HOUR = 60 * MINUTE;

	it('counts minutes under an hour', () => {
		expect(runningFor(start, after(MINUTE))).toBe('1 minute');
		expect(runningFor(start, after(45 * MINUTE + 30_000))).toBe('45 minutes');
		expect(runningFor(start, after(HOUR - 1))).toBe('59 minutes');
	});

	it('counts hours under two days', () => {
		expect(runningFor(start, after(HOUR))).toBe('1 hour');
		expect(runningFor(start, after(HOUR + 59 * MINUTE))).toBe('1 hour');
		expect(runningFor(start, after(2 * HOUR))).toBe('2 hours');
		// Across midnight: a duration, whatever the zone.
		expect(runningFor(start, after(47 * HOUR + 59 * MINUTE))).toBe('47 hours');
	});

	it('counts days from two days on', () => {
		expect(runningFor(start, after(48 * HOUR))).toBe('2 days');
		expect(runningFor(start, after(3 * 24 * HOUR + 5 * HOUR))).toBe('3 days');
	});
});
