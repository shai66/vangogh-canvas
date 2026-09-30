import type { Logger } from './log';
import { VangoghAuthError } from './vangogh/client';

/** Spec section 7: after 5, 15 and 60 minutes, then the next daily run. */
export const RETRY_DELAYS_MS = [5, 15, 60].map((minutes) => minutes * 60_000);

/** A rejected login can pass while vangogh restarts: it is tried once more after this. */
export const AUTH_RETRY_DELAY_MS = 15 * 60_000;

const TICK_MS = 30_000;

export interface Rebuilding {
	start(): 'started' | 'busy';
	onResult: ((ok: boolean, error: unknown) => void) | null;
}

export interface SchedulerDeps {
	rebuilder: Rebuilding;
	/** HH:MM */
	rebuildAt: string;
	timeZone: string;
	log: Logger;
	now?: () => Date;
}

/** The day and the time on a clock on the wall in that time zone. */
export function wallClock(date: Date, timeZone: string): { day: string; time: string } {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(date);
	const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	return {
		day: `${part('year')}-${part('month')}-${part('day')}`,
		time: `${part('hour')}:${part('minute')}`
	};
}

/** Decides when rebuilds happen: at start, once a day, and after failures. */
export class Scheduler {
	readonly #deps: SchedulerDeps;
	#retries = 0;
	/** True once a rejected login had its one retry. */
	#authRetried = false;
	#retryTimer: ReturnType<typeof setTimeout> | null = null;
	#tickTimer: ReturnType<typeof setInterval> | null = null;
	#lastDailyDay: string | null = null;

	constructor(deps: SchedulerDeps) {
		this.#deps = deps;
	}

	start(): void {
		this.stop();
		this.#deps.rebuilder.onResult = (ok, error) => this.#afterRebuild(ok, error);
		const { day, time } = wallClock((this.#deps.now ?? (() => new Date()))(), this.#deps.timeZone);
		if (time >= this.#deps.rebuildAt) {
			this.#lastDailyDay = day;
		}
		this.#deps.rebuilder.start();
		this.#tickTimer = setInterval(() => this.tick(), TICK_MS);
	}

	stop(): void {
		if (this.#tickTimer) clearInterval(this.#tickTimer);
		this.#tickTimer = null;
		this.#clearRetry();
		this.#deps.rebuilder.onResult = null;
	}

	/** Looks at the clock. Public so that a test can call it. */
	tick(): void {
		const { day, time } = wallClock((this.#deps.now ?? (() => new Date()))(), this.#deps.timeZone);
		if (time < this.#deps.rebuildAt || day === this.#lastDailyDay) return;
		const result = this.#deps.rebuilder.start();
		if (result === 'started') {
			this.#deps.log.info('daily rebuild', { day });
			this.#lastDailyDay = day;
			this.#retries = 0;
			this.#authRetried = false;
			this.#clearRetry();
		}
	}

	#clearRetry(): void {
		if (this.#retryTimer) clearTimeout(this.#retryTimer);
		this.#retryTimer = null;
	}

	#afterRebuild(ok: boolean, error: unknown): void {
		this.#clearRetry();
		if (ok) {
			this.#retries = 0;
			this.#authRetried = false;
			return;
		}
		if (error instanceof VangoghAuthError) {
			if (this.#authRetried) {
				this.#deps.log.error('the login was rejected; waiting for the next daily rebuild');
				return;
			}
			this.#authRetried = true;
			this.#deps.log.error('the login was rejected; trying once more', {
				inMinutes: AUTH_RETRY_DELAY_MS / 60_000
			});
			this.#retryAfter(AUTH_RETRY_DELAY_MS);
			return;
		}
		this.#authRetried = false;
		const delay = RETRY_DELAYS_MS[this.#retries];
		if (delay === undefined) {
			this.#deps.log.warn('giving up until the next daily rebuild');
			return;
		}
		this.#retries++;
		this.#deps.log.info('rebuild will be retried', { inMinutes: delay / 60_000 });
		this.#retryAfter(delay);
	}

	#retryAfter(delay: number): void {
		this.#retryTimer = setTimeout(() => {
			this.#retryTimer = null;
			this.#deps.rebuilder.start();
		}, delay);
	}
}
