import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger, silentLogger } from './log';
import {
	AUTH_RETRY_DELAY_MS,
	RETRY_DELAYS_MS,
	Scheduler,
	wallClock,
	type Rebuilding
} from './scheduler';
import { VangoghAuthError } from './vangogh/client';

const MINUTE = 60_000;

function setup() {
	const rebuilder: Rebuilding & { starts: number } = {
		starts: 0,
		onResult: null,
		start() {
			this.starts++;
			return 'started';
		}
	};
	const scheduler = new Scheduler({
		rebuilder,
		rebuildAt: '04:30',
		timeZone: 'Europe/Bratislava',
		log: silentLogger
	});
	return { rebuilder, scheduler };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-09-29T10:00:00Z'));
});
afterEach(() => {
	vi.useRealTimers();
});

describe('wallClock', () => {
	it('gives the day and time in the zone, in summer and in winter', () => {
		expect(wallClock(new Date('2026-09-29T02:30:10Z'), 'Europe/Bratislava')).toEqual({
			day: '2026-09-29',
			time: '04:30'
		});
		expect(wallClock(new Date('2026-12-01T03:30:59Z'), 'Europe/Bratislava')).toEqual({
			day: '2026-12-01',
			time: '04:30'
		});
		expect(wallClock(new Date('2026-09-29T23:05:00Z'), 'Europe/Bratislava')).toEqual({
			day: '2026-09-30',
			time: '01:05'
		});
	});
});

describe('Scheduler', () => {
	it('uses the retry delays of the spec', () => {
		expect(RETRY_DELAYS_MS).toEqual([5 * MINUTE, 15 * MINUTE, 60 * MINUTE]);
	});

	it('rebuilds at start', () => {
		const { rebuilder, scheduler } = setup();
		scheduler.start();
		expect(rebuilder.starts).toBe(1);
		scheduler.stop();
	});

	it('retries after 5, 15 and 60 minutes, then gives up', () => {
		const { rebuilder, scheduler } = setup();
		scheduler.start();
		const fail = () => rebuilder.onResult?.(false, new Error('down'));

		fail();
		vi.advanceTimersByTime(5 * MINUTE - 1);
		expect(rebuilder.starts).toBe(1);
		vi.advanceTimersByTime(1);
		expect(rebuilder.starts).toBe(2);

		fail();
		vi.advanceTimersByTime(15 * MINUTE);
		expect(rebuilder.starts).toBe(3);

		fail();
		vi.advanceTimersByTime(60 * MINUTE);
		expect(rebuilder.starts).toBe(4);

		fail();
		vi.advanceTimersByTime(6 * 60 * MINUTE);
		expect(rebuilder.starts).toBe(4);
		scheduler.stop();
	});

	it('starts the delays over after a success', () => {
		const { rebuilder, scheduler } = setup();
		scheduler.start();
		rebuilder.onResult?.(false, new Error('down'));
		vi.advanceTimersByTime(5 * MINUTE);
		rebuilder.onResult?.(true, null);
		rebuilder.onResult?.(false, new Error('down'));
		vi.advanceTimersByTime(5 * MINUTE);
		expect(rebuilder.starts).toBe(3);
		scheduler.stop();
	});

	it('drops a waiting retry when a rebuild succeeds in the meantime', () => {
		const { rebuilder, scheduler } = setup();
		scheduler.start();
		rebuilder.onResult?.(false, new Error('down'));
		rebuilder.onResult?.(true, null);
		vi.advanceTimersByTime(2 * 60 * MINUTE);
		expect(rebuilder.starts).toBe(1);
		scheduler.stop();
	});

	it('retries a rejected login once after 15 minutes, then waits for the daily rebuild', () => {
		expect(AUTH_RETRY_DELAY_MS).toBe(15 * MINUTE);
		const { rebuilder, scheduler } = setup();
		scheduler.start();
		const rejected = () => rebuilder.onResult?.(false, new VangoghAuthError('vangogh rejected the login'));

		rejected();
		vi.advanceTimersByTime(15 * MINUTE - 1);
		expect(rebuilder.starts).toBe(1);
		vi.advanceTimersByTime(1);
		expect(rebuilder.starts).toBe(2);

		rejected();
		vi.advanceTimersByTime(6 * 60 * MINUTE);
		expect(rebuilder.starts).toBe(2);
		scheduler.stop();
	});

	it('gives a rejected login its one retry again after a success', () => {
		const { rebuilder, scheduler } = setup();
		scheduler.start();
		const rejected = () => rebuilder.onResult?.(false, new VangoghAuthError('vangogh rejected the login'));

		rejected();
		vi.advanceTimersByTime(15 * MINUTE);
		expect(rebuilder.starts).toBe(2);
		rebuilder.onResult?.(true, null);

		rejected();
		vi.advanceTimersByTime(15 * MINUTE);
		expect(rebuilder.starts).toBe(3);
		scheduler.stop();
	});

	it('gives a rejected login its one retry again after a failure of another kind', () => {
		const { rebuilder, scheduler } = setup();
		scheduler.start();
		const rejected = () => rebuilder.onResult?.(false, new VangoghAuthError('vangogh rejected the login'));

		rejected();
		vi.advanceTimersByTime(15 * MINUTE);
		expect(rebuilder.starts).toBe(2);
		rebuilder.onResult?.(false, new Error('down'));
		vi.advanceTimersByTime(5 * MINUTE);
		expect(rebuilder.starts).toBe(3);

		rejected();
		vi.advanceTimersByTime(15 * MINUTE);
		expect(rebuilder.starts).toBe(4);
		scheduler.stop();
	});

	it('gives the daily rebuild its own retry of a rejected login', () => {
		vi.setSystemTime(new Date('2026-09-28T22:00:00Z'));
		const { rebuilder, scheduler } = setup();
		scheduler.start();
		const rejected = () => rebuilder.onResult?.(false, new VangoghAuthError('vangogh rejected the login'));
		rejected();
		vi.advanceTimersByTime(15 * MINUTE);
		rejected();
		expect(rebuilder.starts).toBe(2);

		vi.setSystemTime(new Date('2026-09-29T02:29:45Z'));
		vi.advanceTimersByTime(30_000);
		expect(rebuilder.starts).toBe(3);
		rejected();
		vi.advanceTimersByTime(15 * MINUTE);
		expect(rebuilder.starts).toBe(4);
		scheduler.stop();
	});

	it('rebuilds once a day at the set time', () => {
		vi.setSystemTime(new Date('2026-09-29T02:29:45Z'));
		const { rebuilder, scheduler } = setup();
		scheduler.start();
		expect(rebuilder.starts).toBe(1);

		vi.advanceTimersByTime(30_000);
		expect(rebuilder.starts).toBe(2);
		vi.advanceTimersByTime(30_000);
		expect(rebuilder.starts).toBe(2);

		vi.advanceTimersByTime(24 * 60 * MINUTE);
		expect(rebuilder.starts).toBe(3);
		scheduler.stop();
	});

	it('retries again after the daily rebuild, even when it had given up', () => {
		vi.setSystemTime(new Date('2026-09-28T22:00:00Z'));
		const { rebuilder, scheduler } = setup();
		scheduler.start();
		for (const delay of RETRY_DELAYS_MS) {
			rebuilder.onResult?.(false, new Error('down'));
			vi.advanceTimersByTime(delay);
		}
		rebuilder.onResult?.(false, new Error('down'));
		expect(rebuilder.starts).toBe(4);

		vi.setSystemTime(new Date('2026-09-29T02:29:45Z'));
		vi.advanceTimersByTime(30_000);
		expect(rebuilder.starts).toBe(5);
		rebuilder.onResult?.(false, new Error('down'));
		vi.advanceTimersByTime(5 * MINUTE);
		expect(rebuilder.starts).toBe(6);
		scheduler.stop();
	});

	it('does nothing after stop', () => {
		vi.setSystemTime(new Date('2026-09-29T02:29:45Z'));
		const { rebuilder, scheduler } = setup();
		scheduler.start();
		rebuilder.onResult?.(false, new Error('down'));
		scheduler.stop();
		vi.advanceTimersByTime(2 * 60 * MINUTE);
		expect(rebuilder.starts).toBe(1);
		expect(rebuilder.onResult).toBeNull();
	});

	it('still rebuilds when the set minute was missed', () => {
		vi.setSystemTime(new Date('2026-09-29T02:29:45Z'));
		const { rebuilder, scheduler } = setup();
		scheduler.start();
		expect(rebuilder.starts).toBe(1);

		// The process was paused from 04:29:45 to 04:47 local time.
		vi.setSystemTime(new Date('2026-09-29T02:47:00Z'));
		vi.advanceTimersByTime(30_000);
		expect(rebuilder.starts).toBe(2);

		vi.advanceTimersByTime(60 * MINUTE);
		expect(rebuilder.starts).toBe(2);
		scheduler.stop();
	});

	it('does not rebuild a second time when it starts after the set time', () => {
		vi.setSystemTime(new Date('2026-09-29T03:00:00Z'));
		const { rebuilder, scheduler } = setup();
		scheduler.start();
		expect(rebuilder.starts).toBe(1);

		vi.advanceTimersByTime(10 * MINUTE);
		expect(rebuilder.starts).toBe(1);

		// The next day at 04:30 local time.
		vi.setSystemTime(new Date('2026-09-30T02:30:05Z'));
		vi.advanceTimersByTime(30_000);
		expect(rebuilder.starts).toBe(2);
		scheduler.stop();
	});

	it('logs the daily rebuild only when it started', () => {
		vi.setSystemTime(new Date('2026-09-29T02:29:45Z'));
		let busy = false;
		const lines: string[] = [];
		const rebuilder: Rebuilding = {
			onResult: null,
			start: () => (busy ? 'busy' : 'started')
		};
		const scheduler = new Scheduler({
			rebuilder,
			rebuildAt: '04:30',
			timeZone: 'Europe/Bratislava',
			log: createLogger((line) => lines.push(line))
		});
		scheduler.start();
		busy = true;
		vi.advanceTimersByTime(2 * MINUTE);
		expect(lines.filter((l) => l.includes('daily rebuild'))).toEqual([]);
		busy = false;
		vi.advanceTimersByTime(2 * MINUTE);
		expect(lines.filter((l) => l.includes('daily rebuild'))).toHaveLength(1);
		scheduler.stop();
	});

	it('follows a rebuild that was running at the set time with the daily one', () => {
		vi.setSystemTime(new Date('2026-09-29T02:29:45Z'));
		let busy = false;
		const rebuilder: Rebuilding & { started: number } = {
			started: 0,
			onResult: null,
			start() {
				if (busy) return 'busy';
				this.started++;
				return 'started';
			}
		};
		const scheduler = new Scheduler({
			rebuilder,
			rebuildAt: '04:30',
			timeZone: 'Europe/Bratislava',
			log: silentLogger
		});
		scheduler.start();
		expect(rebuilder.started).toBe(1);

		busy = true;
		vi.advanceTimersByTime(2 * MINUTE);
		expect(rebuilder.started).toBe(1);

		busy = false;
		vi.advanceTimersByTime(30_000);
		expect(rebuilder.started).toBe(2);

		vi.advanceTimersByTime(60 * MINUTE);
		expect(rebuilder.started).toBe(2);
		scheduler.stop();
	});
});
