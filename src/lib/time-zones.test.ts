import { describe, expect, it } from 'vitest';
import {
	ZONES,
	nowLine,
	offsetLabel,
	sameClocks,
	selectedZone,
	winterOffset,
	zoneOptions
} from './time-zones';

const JAN = new Date('2026-01-15T12:00:00Z');
const JUL = new Date('2026-07-01T12:00:00Z');

describe('ZONES', () => {
	it('holds 33 entries from Pago Pago to Kiritimati, all known to Intl', () => {
		expect(ZONES).toHaveLength(33);
		expect(ZONES[0].zone).toBe('Pacific/Pago_Pago');
		expect(ZONES[32].zone).toBe('Pacific/Kiritimati');
		for (const { zone } of ZONES) {
			expect(() => new Intl.DateTimeFormat('en', { timeZone: zone })).not.toThrow();
		}
	});
});

describe('offsetLabel', () => {
	it('writes the offset with a real minus and no offset as UTC', () => {
		expect(offsetLabel('Asia/Kolkata', JAN)).toBe('UTC+5:30');
		expect(offsetLabel('America/St_Johns', JAN)).toBe('UTC−3:30');
		expect(offsetLabel('Europe/London', JAN)).toBe('UTC');
	});
});

describe('winterOffset and sameClocks', () => {
	it('takes the smaller offset of January and July', () => {
		expect(winterOffset('Europe/Berlin', 2026)).toBe('UTC+1');
		expect(winterOffset('Australia/Sydney', 2026)).toBe('UTC+10');
	});
	it('compares the clocks of two zones', () => {
		expect(sameClocks('Europe/Bratislava', 'Europe/Berlin', 2026)).toBe(true);
		expect(sameClocks('Europe/London', 'UTC', 2026)).toBe(false);
	});
});

describe('zoneOptions', () => {
	it('labels the 33 entries by winter offset and cities', () => {
		const options = zoneOptions('Europe/Berlin', JAN);
		expect(options).toHaveLength(33);
		expect(options.find((o) => o.value === 'Europe/Berlin')?.label).toBe(
			'UTC+1 · Amsterdam, Berlin, Bratislava, Lagos, Paris, Prague, Rome, Vienna'
		);
	});
	it('puts a zone of its own next to the entry with its offset', () => {
		const options = zoneOptions('UTC', JAN);
		expect(options).toHaveLength(34);
		const i = options.findIndex((o) => o.value === 'UTC');
		expect(options[i]).toEqual({ value: 'UTC', label: 'UTC · UTC' });
		expect(options[i - 1].value).toBe('Europe/London');
	});
	it('adds nothing for a zone with the clocks of an entry', () => {
		expect(zoneOptions('Europe/Bratislava', JAN)).toHaveLength(33);
	});
	it('keeps a zone of its own for a zone to keep, as for the current one, and only once', () => {
		const options = zoneOptions('Europe/Berlin', JAN, ['UTC']);
		expect(options).toHaveLength(34);
		const i = options.findIndex((o) => o.value === 'UTC');
		expect(options[i]).toEqual({ value: 'UTC', label: 'UTC · UTC' });
		expect(options[i - 1].value).toBe('Europe/London');
		expect(zoneOptions('UTC', JAN, ['UTC'])).toEqual(zoneOptions('UTC', JAN));
		expect(zoneOptions('Europe/Berlin', JAN, ['Europe/Bratislava'])).toHaveLength(33);
	});
});

describe('selectedZone', () => {
	it('keeps a listed zone, maps a twin, else keeps the zone', () => {
		expect(selectedZone('Europe/Berlin', 2026)).toBe('Europe/Berlin');
		expect(selectedZone('Europe/Bratislava', 2026)).toBe('Europe/Berlin');
		expect(selectedZone('UTC', 2026)).toBe('UTC');
	});
});

describe('nowLine', () => {
	it('tells summer time and the offset now', () => {
		expect(nowLine('Europe/Berlin', JUL)).toEqual({ summer: true, offset: 'UTC+2' });
		expect(nowLine('Asia/Kolkata', JAN)).toEqual({ summer: false, offset: 'UTC+5:30' });
	});
});
