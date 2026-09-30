import { describe, expect, it } from 'vitest';
import { ageInDays, builtTime, builtWhen, isStale } from './age';

const now = Date.parse('2026-10-03T12:00:00.000Z');

describe('the age of the library', () => {
	it('counts whole days', () => {
		expect(ageInDays('2026-10-03T04:30:00.000Z', now)).toBe(0);
		expect(ageInDays('2026-10-02T12:00:00.001Z', now)).toBe(0);
		expect(ageInDays('2026-10-02T12:00:00.000Z', now)).toBe(1);
		expect(ageInDays('2026-09-30T04:30:00.000Z', now)).toBe(3);
	});

	it('warns from two days on', () => {
		expect(isStale('2026-10-02T04:30:00.000Z', now)).toBe(false);
		expect(isStale('2026-10-01T12:00:00.001Z', now)).toBe(false);
		expect(isStale('2026-10-01T12:00:00.000Z', now)).toBe(true);
		expect(isStale('2026-09-01T04:30:00.000Z', now)).toBe(true);
	});

	it('takes a time in the future, no time and nonsense as "just now"', () => {
		expect(ageInDays('2027-01-01T00:00:00.000Z', now)).toBe(0);
		expect(ageInDays(null, now)).toBe(0);
		expect(ageInDays('yesterday', now)).toBe(0);
		expect(isStale('', now)).toBe(false);
		expect(builtTime('not a time')).toBeNull();
		expect(builtTime('2026-10-03T04:30:00.000Z')?.toISOString()).toBe('2026-10-03T04:30:00.000Z');
	});

	it('writes the time of the build as "30 September, 04:30", in the zone it is given', () => {
		const built = new Date('2026-09-30T04:30:00.000Z');
		expect(builtWhen(built, 'UTC')).toBe('30 September, 04:30');
		expect(builtWhen(built, 'Europe/Bratislava')).toBe('30 September, 06:30');
		// Past midnight on a 24-hour clock, and a day of one digit without a nought.
		expect(builtWhen(new Date('2026-10-01T00:05:00.000Z'), 'UTC')).toBe('1 October, 00:05');
	});
});
