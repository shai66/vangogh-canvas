import { causeCode } from './errors';
import type { Logger } from './log';

/** GitHub's latest release of the public repository: drafts and pre-releases are not "latest". */
export const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/shai66/vangogh-canvas/releases/latest';

/** The first check waits, so that the first rebuild is under way first. Spec 0.10.0, section 7.2. */
export const FIRST_CHECK_MS = 10_000;
const DAY_MS = 24 * 60 * 60_000;
const TIMEOUT_MS = 5_000;

export interface UpdateCheckDeps {
	/** The running version, such as "0.10.0". */
	version: string;
	url: string;
	fetch: typeof fetch;
	log: Logger;
	now?: () => Date;
	/** How long one request may take. 5 seconds by the spec; the tests shorten it. */
	timeoutMs?: number;
}

/** The version a release tag names, "v0.10.0" or "0.10.0", or null for anything else. */
export function parseTag(tag: unknown): string | null {
	if (typeof tag !== 'string') return null;
	const version = tag.trim().replace(/^v/, '');
	return /^\d+\.\d+\.\d+$/.test(version) ? version : null;
}

/** Number by number: above 0 when `a` is newer than `b`, 0 when they are the same, below 0 when older. */
export function compareVersions(a: string, b: string): number {
	const left = a.split('.').map(Number);
	const right = b.split('.').map(Number);
	for (let i = 0; i < 3; i++) {
		if (left[i] !== right[i]) return left[i] - right[i];
	}
	return 0;
}

/**
 * Asks GitHub for the latest release of Canvas, once at start and once a day, and keeps
 * the answer in memory. Spec 0.10.0, section 7. A failure is one warning and the next
 * check a day later; nothing is retried before. The timers keep the process alive no
 * longer than the rest of it.
 */
export class UpdateCheck {
	readonly #deps: UpdateCheckDeps;
	#latest: string | null = null;
	#checkedAt: string | null = null;
	#first: ReturnType<typeof setTimeout> | null = null;
	#daily: ReturnType<typeof setInterval> | null = null;

	constructor(deps: UpdateCheckDeps) {
		this.#deps = deps;
	}

	/** The latest release as GitHub last answered it, newer or not. */
	get latest(): string | null {
		return this.#latest;
	}

	/** When GitHub last answered, as an ISO time. */
	get checkedAt(): string | null {
		return this.#checkedAt;
	}

	/** The latest release when it is newer than the running version, else null. */
	get newer(): string | null {
		return this.#latest !== null && compareVersions(this.#latest, this.#deps.version) > 0 ? this.#latest : null;
	}

	start(): void {
		this.stop();
		this.#first = setTimeout(() => {
			this.#first = null;
			void this.check();
			this.#daily = setInterval(() => void this.check(), DAY_MS);
			this.#daily.unref?.();
		}, FIRST_CHECK_MS);
		this.#first.unref?.();
	}

	stop(): void {
		if (this.#first) clearTimeout(this.#first);
		if (this.#daily) clearInterval(this.#daily);
		this.#first = null;
		this.#daily = null;
	}

	/** One check. Never throws. */
	async check(): Promise<void> {
		const { fetch, log, url, version } = this.#deps;
		try {
			const res = await fetch(url, {
				headers: { accept: 'application/vnd.github+json', 'user-agent': `vangogh-canvas/${version}` },
				signal: AbortSignal.timeout(this.#deps.timeoutMs ?? TIMEOUT_MS)
			});
			if (!res.ok) {
				log.warn('update check failed', { reason: 'bad status', status: res.status });
				return;
			}
			const body = (await res.json()) as { tag_name?: unknown };
			const latest = parseTag(body?.tag_name);
			if (latest === null) {
				log.warn('update check failed', { reason: 'tag is not a version', tag: String(body?.tag_name ?? '') });
				return;
			}
			const changed = latest !== this.#latest;
			this.#latest = latest;
			this.#checkedAt = (this.#deps.now ?? (() => new Date()))().toISOString();
			if (changed) log.info('update check', { latest, newer: this.newer !== null });
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			const code = causeCode(error);
			log.warn('update check failed', code ? { reason, code } : { reason });
		}
	}
}
