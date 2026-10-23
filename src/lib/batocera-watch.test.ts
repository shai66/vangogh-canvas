import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameOnBox, JobView } from './batocera';
import { BatoceraWatch } from './batocera-watch.svelte';

const NOW = Date.parse('2026-10-20T21:00:00.000Z');

function job(over: Partial<JobView> = {}): JobView {
	return {
		id: 'job-1',
		state: 'running',
		ahead: 0,
		step: 'copy',
		stepNumber: 1,
		steps: 3,
		overall: 0.1,
		bytesDone: 0,
		bytesAll: 1024,
		minutesLeft: null,
		waking: 'no',
		waitingForBox: false,
		reason: null,
		endedAt: null,
		listLater: false,
		...over
	};
}

function game(over: Partial<GameOnBox> = {}): GameOnBox {
	return {
		can: true,
		system: 'windows',
		size: 1024,
		onBox: 'no',
		version: null,
		sentAt: null,
		newer: false,
		marked: false,
		job: null,
		countdown: null,
		play: null,
		box: 'up',
		// A fresh look: no reason to ask again for it.
		checkedAt: new Date(NOW).toISOString(),
		...over
	};
}

/** A fetch that answers the game's state from `answers`, one after another, the last one again and again. */
function fakeFetch(answers: GameOnBox[]) {
	const asked: { url: string; method: string; body: unknown }[] = [];
	let at = 0;
	const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		asked.push({ url, method, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
		if (method === 'GET') {
			const answer = answers[Math.min(at++, answers.length - 1)];
			return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
		}
		if (url.endsWith('/play')) {
			return new Response(JSON.stringify({ error: 'game-running', name: 'Other Game' }), { status: 409, headers: { 'content-type': 'application/json' } });
		}
		return new Response(null, { status: 204 });
	});
	const gets = () => asked.filter((a) => a.method === 'GET').length;
	return { fetcher: fetcher as unknown as typeof fetch, asked, gets };
}

describe('BatoceraWatch', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('asks every 2 seconds while a job runs, and stops when it is done', async () => {
		const running = game({ job: job() });
		const done = game({ onBox: 'canvas', job: job({ state: 'done', overall: 1, endedAt: new Date(NOW).toISOString() }) });
		const { fetcher, asked, gets } = fakeFetch([running, running, done]);
		const watch = new BatoceraWatch('3001', fetcher);
		watch.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(asked[0]).toEqual({ url: '/api/batocera/games/3001', method: 'GET', body: undefined });
		expect(watch.game?.job?.state).toBe('running');

		await vi.advanceTimersByTimeAsync(1999);
		expect(gets()).toBe(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(gets()).toBe(2);
		await vi.advanceTimersByTimeAsync(2000);
		expect(gets()).toBe(3);
		expect(watch.game?.job?.state).toBe('done');

		// Done: nothing more to wait for.
		await vi.advanceTimersByTimeAsync(20_000);
		expect(gets()).toBe(3);
		watch.stop();
	});

	it('stops asking when stopped', async () => {
		const { fetcher, gets } = fakeFetch([game({ job: job() })]);
		const watch = new BatoceraWatch('3001', fetcher);
		watch.start();
		await vi.advanceTimersByTimeAsync(4000);
		expect(gets()).toBe(3);
		watch.stop();
		await vi.advanceTimersByTimeAsync(20_000);
		expect(gets()).toBe(3);
	});

	it('asks again while the look at the box is older than a minute, a few times at most', async () => {
		const old = game({ checkedAt: new Date(NOW - 120_000).toISOString() });
		const fresh = game({ checkedAt: new Date(NOW + 2000).toISOString() });
		const first = fakeFetch([old, fresh]);
		const watch = new BatoceraWatch('3001', first.fetcher);
		watch.start();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(first.gets()).toBe(2);
		watch.stop();

		// A look that never comes: the watch gives up after a few answers.
		const never = fakeFetch([game({ checkedAt: null })]);
		const patient = new BatoceraWatch('3002', never.fetcher);
		patient.start();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(never.gets()).toBeLessThanOrEqual(6);
		patient.stop();
	});

	it('counts the countdown down between answers', async () => {
		const { fetcher } = fakeFetch([game({ onBox: 'canvas', countdown: 581 })]);
		const watch = new BatoceraWatch('3001', fetcher);
		watch.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(watch.left).toBe(581);
		await vi.advanceTimersByTimeAsync(1000);
		// The answer two seconds on says 581 again here, as the fake does not count: the clock goes by the answer.
		expect(watch.left).toBe(580);
		watch.stop();
	});

	it('sends, stops, plays, keeps the box on and marks, each through its route', async () => {
		const { fetcher, asked } = fakeFetch([game({ onBox: 'canvas', countdown: 100, job: job() })]);
		const watch = new BatoceraWatch('3001', fetcher);
		watch.start();
		await vi.advanceTimersByTimeAsync(0);

		await watch.stopJob();
		await watch.keepOn();
		await watch.mark(true);
		await watch.mark(false);
		await watch.send();
		const acts = asked.filter((a) => a.method !== 'GET').map((a) => `${a.method} ${a.url}`);
		expect(acts).toEqual([
			'DELETE /api/batocera/jobs/job-1',
			'POST /api/batocera/keep-on',
			'PUT /api/batocera/marks/3001',
			'DELETE /api/batocera/marks/3001',
			'POST /api/batocera/games/3001/send'
		]);
		expect(watch.keptOn).toBe(false);
		watch.stop();
	});

	it('asks whether to close a running game only after its own Play was answered so', async () => {
		const { fetcher, asked } = fakeFetch([game({ onBox: 'canvas', play: { state: 'running', name: 'Other Game' } })]);
		const watch = new BatoceraWatch('3001', fetcher);
		watch.start();
		await vi.advanceTimersByTimeAsync(0);
		// The server keeps the answer of an earlier Play, perhaps on another device: no question from it alone.
		expect(watch.shownPlay).toBeNull();

		await watch.playNow(false);
		expect(asked.at(-2)).toEqual({ url: '/api/batocera/games/3001/play', method: 'POST', body: { closeRunning: false } });
		expect(watch.shownPlay).toEqual({ state: 'running', name: 'Other Game' });
		watch.play = null;
		expect(watch.shownPlay).toBeNull();
		watch.stop();
	});

	it('is not answered until its first answer', async () => {
		// A detail opened before told the page the game's state.
		const before = new BatoceraWatch('3014', fakeFetch([game({ onBox: 'canvas' })]).fetcher);
		before.start();
		await vi.advanceTimersByTimeAsync(0);
		before.stop();
		// Each GET waits for the test to answer it.
		let answer: (() => void) | null = null;
		const fetcher = (async () =>
			new Promise<Response>(
				(resolve) => (answer = () => resolve(new Response(JSON.stringify(game({ onBox: 'canvas' })), { status: 200, headers: { 'content-type': 'application/json' } })))
			)) as typeof fetch;
		const watch = new BatoceraWatch('3014', fetcher);
		// The state the page was told is shown at once, and is not an answer.
		expect(watch.game?.onBox).toBe('canvas');
		expect(watch.answered).toBe(false);
		watch.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(watch.answered).toBe(false);
		answer!();
		await vi.advanceTimersByTimeAsync(0);
		expect(watch.answered).toBe(true);
		watch.stop();
	});

	it('says that a Play is starting from its press until its answer, and how it was pressed', async () => {
		// Each play waits for the test to answer it, or to fail it.
		let answer: { resolve: (res: Response) => void; reject: (error: Error) => void } | null = null;
		const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
			if ((init?.method ?? 'GET') === 'GET') {
				return new Response(JSON.stringify(game({ onBox: 'canvas' })), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			return new Promise<Response>((resolve, reject) => (answer = { resolve, reject }));
		}) as typeof fetch;
		const watch = new BatoceraWatch('3001', fetcher);
		watch.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(watch.starting).toBeNull();

		const played = watch.playNow(false);
		expect(watch.starting).toBe('play');
		answer!.resolve(new Response(null, { status: 200 }));
		await played;
		expect(watch.starting).toBeNull();
		expect(watch.play).toEqual({ state: 'started' });

		// "Close it and play".
		const closed = watch.playNow(true);
		expect(watch.starting).toBe('close');
		answer!.resolve(new Response(null, { status: 200 }));
		await closed;
		expect(watch.starting).toBeNull();

		// No answer at all: no longer starting either.
		const lost = watch.playNow(false);
		expect(watch.starting).toBe('play');
		answer!.reject(new Error('offline'));
		await lost;
		expect(watch.starting).toBeNull();
		watch.stop();
	});

	it("shows no Play answer from before its own send, not even one an earlier ask brings late", async () => {
		const gone = game({ onBox: 'no', countdown: 30, play: { state: 'gone' } });
		// Each GET waits for the test to answer it; the first at once.
		const answers: ((g: GameOnBox) => void)[] = [];
		let first = true;
		const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const method = init?.method ?? 'GET';
			const body = (g: GameOnBox) => new Response(JSON.stringify(g), { status: 200, headers: { 'content-type': 'application/json' } });
			if (method === 'GET') {
				if (first) {
					first = false;
					return body(gone);
				}
				return new Promise<Response>((resolve) => answers.push((g) => resolve(body(g))));
			}
			return new Response(JSON.stringify(job()), { status: 202, headers: { 'content-type': 'application/json' } });
		}) as typeof fetch;
		const watch = new BatoceraWatch('3001', fetcher);
		watch.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(watch.shownPlay).toEqual({ state: 'gone' });
		// The countdown asks again in 2 seconds; its answer is late.
		await vi.advanceTimersByTimeAsync(2000);
		expect(answers).toHaveLength(1);

		await watch.send();
		expect(watch.shownPlay).toBeNull();
		expect(watch.game?.job?.state).toBe('running');
		// The answer of the ask before the send still has the old Play, and the old state: it is dropped.
		answers[0](gone);
		await vi.advanceTimersByTimeAsync(0);
		expect(watch.shownPlay).toBeNull();
		expect(watch.game?.job?.state).toBe('running');
		// The answer of the ask after it is taken.
		answers[1](game({ job: job() }));
		await vi.advanceTimersByTimeAsync(0);
		expect(watch.game?.countdown).toBeNull();
		watch.stop();
	});
});
