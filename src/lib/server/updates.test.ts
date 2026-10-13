import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { silentLogger, type Logger } from './log';
import { compareVersions, FIRST_CHECK_MS, GITHUB_LATEST_RELEASE_URL, parseTag, UpdateCheck, type UpdateCheckDeps } from './updates';

const DAY = 24 * 60 * 60_000;

function answer(status: number, body: unknown): typeof fetch {
	return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
}

/** Never answers; rejects with the signal's reason when the request is aborted, as a real fetch does. */
function hanging(): typeof fetch {
	return vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)))) as unknown as typeof fetch;
}

function logger() {
	const lines: { level: string; message: string; fields?: Record<string, unknown> }[] = [];
	const log: Logger = {
		info: (message, fields) => lines.push({ level: 'info', message, fields }),
		warn: (message, fields) => lines.push({ level: 'warn', message, fields }),
		error: (message, fields) => lines.push({ level: 'error', message, fields })
	};
	return { log, lines };
}

function make(over: Partial<UpdateCheckDeps> = {}) {
	return new UpdateCheck({ version: '0.10.0', url: GITHUB_LATEST_RELEASE_URL, fetch: answer(200, { tag_name: 'v0.10.0' }), log: silentLogger, ...over });
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-10-13T10:00:00Z'));
});
afterEach(() => {
	vi.useRealTimers();
});

describe('parseTag', () => {
	it('drops a leading v and keeps a plain version', () => {
		expect(parseTag('v0.10.0')).toBe('0.10.0');
		expect(parseTag('0.10.0')).toBe('0.10.0');
		expect(parseTag('v12.0.3')).toBe('12.0.3');
	});

	it('gives null for anything that is not three numbers', () => {
		expect(parseTag('v1.0.0-rc.1')).toBeNull();
		expect(parseTag('v1.0')).toBeNull();
		expect(parseTag('latest')).toBeNull();
		expect(parseTag('')).toBeNull();
		expect(parseTag(undefined)).toBeNull();
		expect(parseTag(10)).toBeNull();
	});
});

describe('compareVersions', () => {
	it('compares number by number, not as text', () => {
		expect(compareVersions('0.10.0', '0.9.2')).toBeGreaterThan(0);
		expect(compareVersions('0.9.2', '0.10.0')).toBeLessThan(0);
		expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
		expect(compareVersions('0.10.0', '0.10.0')).toBe(0);
		expect(compareVersions('0.10.1', '0.10.0')).toBeGreaterThan(0);
	});
});

describe('UpdateCheck', () => {
	it('asks GitHub as the spec says, and keeps the latest release and when it was asked', async () => {
		const fetch = answer(200, { tag_name: 'v0.11.0' });
		const check = make({ fetch });
		expect([check.latest, check.checkedAt, check.newer]).toEqual([null, null, null]);
		await check.check();
		expect(fetch).toHaveBeenCalledTimes(1);
		const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://api.github.com/repos/shai66/vangogh-canvas/releases/latest');
		expect(new Headers(init.headers).get('accept')).toBe('application/vnd.github+json');
		expect(new Headers(init.headers).get('user-agent')).toBe('vangogh-canvas/0.10.0');
		expect(init.signal).toBeInstanceOf(AbortSignal);
		expect(check.latest).toBe('0.11.0');
		expect(check.checkedAt).toBe('2026-10-13T10:00:00.000Z');
		expect(check.newer).toBe('0.11.0');
	});

	it('names no newer version when the latest is the running one or older', async () => {
		const same = make({ fetch: answer(200, { tag_name: 'v0.10.0' }) });
		await same.check();
		expect([same.latest, same.newer]).toEqual(['0.10.0', null]);
		const older = make({ fetch: answer(200, { tag_name: 'v0.9.2' }) });
		await older.check();
		expect([older.latest, older.newer]).toEqual(['0.9.2', null]);
	});

	it('logs one line when the latest changed, with whether it is newer, and none when it did not', async () => {
		const { log, lines } = logger();
		const check = make({ fetch: answer(200, { tag_name: 'v0.11.0' }), log });
		await check.check();
		await check.check();
		expect(lines).toEqual([{ level: 'info', message: 'update check', fields: { latest: '0.11.0', newer: true } }]);
	});

	// Review focus 4
	it('keeps what it knew across a bad status, a tag that is not a version and a fetch that throws, and warns each time with the reason', async () => {
		const { log, lines } = logger();
		const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
		const answers = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(json(200, { tag_name: 'v0.11.0' }))
			.mockResolvedValueOnce(json(403, { message: 'rate limit' }))
			.mockResolvedValueOnce(json(200, { tag_name: 'nightly' }))
			.mockRejectedValueOnce(new Error('network is down'));
		const check = make({ fetch: answers, log });
		await check.check();
		const known = ['0.11.0', '0.11.0', '2026-10-13T10:00:00.000Z'];
		expect([check.latest, check.newer, check.checkedAt]).toEqual(known);
		const failures = [{ reason: 'bad status', status: 403 }, { reason: 'tag is not a version', tag: 'nightly' }, { reason: 'network is down' }];
		for (const [i, fields] of failures.entries()) {
			// A later clock, so that a checkedAt written on a failure would show.
			vi.setSystemTime(new Date(Date.UTC(2026, 9, 13, 11 + i)));
			await check.check();
			expect([check.latest, check.newer, check.checkedAt]).toEqual(known);
			expect(lines).toHaveLength(2 + i);
			expect(lines.at(-1)).toEqual({ level: 'warn', message: 'update check failed', fields });
		}
		expect(answers).toHaveBeenCalledTimes(4);
		expect(lines.map((line) => line.level)).toEqual(['info', 'warn', 'warn', 'warn']);
	});

	// Review focus 4
	it('keeps what it knew when the tag is not a version or the body is not JSON', async () => {
		const { log, lines } = logger();
		const check = make({ fetch: answer(200, { tag_name: 'v1.0.0-rc.1' }), log });
		await check.check();
		expect([check.latest, check.checkedAt]).toEqual([null, null]);
		expect(lines).toEqual([{ level: 'warn', message: 'update check failed', fields: { reason: 'tag is not a version', tag: 'v1.0.0-rc.1' } }]);
		const text = vi.fn(async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
		const broken = make({ fetch: text, log });
		await broken.check();
		expect(broken.latest).toBeNull();
		expect(lines.at(-1)).toMatchObject({ level: 'warn', message: 'update check failed' });
	});

	// Review focus 4
	it('gives up after the timeout and warns', async () => {
		// AbortSignal.timeout runs on a timer the fake clock does not drive: a real, short one.
		vi.useRealTimers();
		const { log, lines } = logger();
		const check = make({ fetch: hanging(), log, timeoutMs: 50 });
		await check.check();
		expect(check.latest).toBeNull();
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({ level: 'warn', message: 'update check failed', fields: { code: 'timeout' } });
	});

	it('names the code of the network error behind a fetch that failed', async () => {
		const { log, lines } = logger();
		const failing = vi.fn(async () => {
			throw new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.github.com'), { code: 'ENOTFOUND' }) });
		}) as unknown as typeof fetch;
		await make({ fetch: failing, log }).check();
		expect(lines).toEqual([{ level: 'warn', message: 'update check failed', fields: { reason: 'fetch failed', code: 'ENOTFOUND' } }]);
	});

	it('does not throw when fetch throws', async () => {
		const failing = vi.fn(async () => {
			throw new Error('network is down');
		}) as unknown as typeof fetch;
		const check = make({ fetch: failing });
		await expect(check.check()).resolves.toBeUndefined();
	});

	it('checks 10 seconds after start, then every 24 hours', async () => {
		const fetch = answer(200, { tag_name: 'v0.11.0' });
		const check = make({ fetch });
		check.start();
		expect(fetch).toHaveBeenCalledTimes(0);
		await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
		expect(fetch).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(DAY - 1);
		expect(fetch).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(fetch).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(DAY);
		expect(fetch).toHaveBeenCalledTimes(3);
		check.stop();
	});

	// Review focus 5
	it('keeps nothing alive after stop, and asks no more', async () => {
		const fetch = answer(200, { tag_name: 'v0.11.0' });
		const check = make({ fetch });
		check.start();
		check.stop();
		await vi.advanceTimersByTimeAsync(2 * DAY);
		expect(fetch).toHaveBeenCalledTimes(0);
		expect(vi.getTimerCount()).toBe(0);
		// Started twice, it runs once.
		check.start();
		check.start();
		await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
		expect(fetch).toHaveBeenCalledTimes(1);
		check.stop();
	});
});
