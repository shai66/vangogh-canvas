import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_BATOCERA, NO_SETTINGS, type Settings } from '../../src/lib/settings';
import { batoceraLibrary } from '../../src/lib/server/testing/batocera-library';
import { startFakeBatocera, type FakeBatocera } from '../../src/lib/server/testing/fake-batocera';
import { startFakeVangogh, type FakeVangogh } from '../../src/lib/server/testing/fake-vangogh';

/** The PIN of every Canvas here. */
const PIN = '2468';

let vangogh: FakeVangogh;
let box: FakeBatocera;
/** Each Canvas's folders, under one folder. */
let folder: string;
const children: ChildProcess[] = [];
let output = '';

/** A built Canvas, and the folder of its settings file. */
interface Canvas {
	url: string;
	settingsDir: string;
}

/** A Canvas with Batocera on, set to the fake box but not tested yet. */
let boxed: Canvas;
/** A Canvas with the settings of a fresh start: Batocera off, no MAC. */
let off: Canvas;
/** A Canvas with Batocera set up with the fake box, as after a passed connection test. */
let ready: Canvas;
/** As `ready`, with waking and "Shut down after sending" on. */
let waker: Canvas;

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as { port: number };
			server.close(() => resolve(port));
		});
	});
}

async function waitFor(check: () => Promise<boolean>, what: string): Promise<void> {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		if (await check().catch(() => false)) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`timed out waiting for ${what}. Output of the app:\n${output}`);
}

/** Starts a built Canvas named `name` with a PIN, the fake vangogh and the fake box, its settings file written first. */
async function startCanvas(name: string, settings: Settings): Promise<Canvas> {
	const dir = join(folder, name);
	const settingsDir = join(dir, 'settings');
	await mkdir(settingsDir, { recursive: true });
	await writeFile(join(settingsDir, 'settings.json'), JSON.stringify({ version: 1, ...settings }));
	const port = await freePort();
	const child = spawn(process.execPath, ['build'], {
		env: {
			PATH: process.env.PATH ?? '',
			HOST: '127.0.0.1',
			PORT: String(port),
			VANGOGH_URL: vangogh.url,
			VANGOGH_USERNAME: 'api',
			VANGOGH_PASSWORD: 'secret',
			CACHE_DIR: join(dir, 'cache'),
			SETTINGS_DIR: settingsDir,
			SETTINGS_PIN: PIN,
			BATOCERA_PORT: String(box.port),
			BATOCERA_WAKE_TO: `127.0.0.1:${box.wakePort}`,
			BATOCERA_SHUTDOWN_SECONDS: '2',
			VERSION_CHECK: 'off',
			// The settings may switch the check on: it must never reach GitHub.
			VERSION_CHECK_URL: `${vangogh.url}/releases/latest`
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	child.stdout?.on('data', (chunk) => (output += chunk));
	child.stderr?.on('data', (chunk) => (output += chunk));
	children.push(child);
	const url = `http://127.0.0.1:${port}`;
	await waitFor(async () => (await fetch(`${url}/healthz`)).status === 200, `the Canvas "${name}"`);
	return { url, settingsDir };
}

function stop(child: ChildProcess): Promise<void> {
	return new Promise((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) return resolve();
		child.once('exit', () => resolve());
		child.kill('SIGKILL');
	});
}

beforeAll(async () => {
	if (!existsSync('build/index.js')) throw new Error('run "npm run build" first');
	vangogh = await startFakeVangogh(batoceraLibrary());
	box = await startFakeBatocera();
	folder = await mkdtemp(join(tmpdir(), 'canvas-it-batocera-'));
	const login = { on: true, address: '127.0.0.1', user: box.user, password: box.password };
	const tested = { ...login, ready: true, hostKey: box.fingerprint, mac: box.mac };
	[boxed, off, ready, waker] = await Promise.all([
		startCanvas('boxed', { ...NO_SETTINGS, batocera: { ...NO_BATOCERA, ...login } }),
		startCanvas('off', NO_SETTINGS),
		startCanvas('ready', { ...NO_SETTINGS, batocera: { ...NO_BATOCERA, ...tested } }),
		startCanvas('waker', { ...NO_SETTINGS, batocera: { ...NO_BATOCERA, ...tested, wake: true, shutdown: true } })
	]);
});

afterAll(async () => {
	await Promise.all(children.map(stop));
	await box?.close();
	await vangogh?.close();
	if (folder) await rm(folder, { recursive: true, force: true });
});

/** A request with a JSON body, as the page sends it. */
const send = (at: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
	fetch(`${at}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: body === undefined ? undefined : JSON.stringify(body)
	});

/** Unlocks the Canvas at `at`, and gives the cookie as the browser sends it back. */
async function unlock(at: string): Promise<string> {
	const res = await send(at, '/api/settings/unlock', { pin: PIN });
	expect(res.status).toBe(204);
	return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

/** The status and the body of an answer that no cache may keep. */
async function answer(res: Response): Promise<{ status: number; body: unknown }> {
	expect(res.headers.get('cache-control')).toBe('no-store');
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('the tests in the settings', () => {
	it('streams the checks of a connection test', async () => {
		const cookie = await unlock(boxed.url);
		// No password: the saved one.
		const res = await send(boxed.url, '/api/settings/batocera/test', { address: '127.0.0.1', user: box.user }, { cookie });
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/x-ndjson');
		expect(res.headers.get('cache-control')).toBe('no-store');
		const lines = (await res.text()).split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
		expect(lines).toEqual([
			{ step: 1, result: 'ok', address: '127.0.0.1' },
			{ step: 2, result: 'ok' },
			{ step: 3, result: 'ok' },
			{ step: 4, result: 'ok', free: box.freeBytes, version: '43.1' },
			{ step: 5, result: 'ok' },
			{ done: true, ready: true, mac: box.mac }
		]);
		const saved = JSON.parse(await readFile(join(boxed.settingsDir, 'settings.json'), 'utf8'));
		expect(saved.batocera).toMatchObject({ ready: true, hostKey: box.fingerprint, mac: box.mac });
	});

	it('refuses the test while locked', async () => {
		const locked = { status: 401, body: { error: 'locked' } };
		expect(await answer(await send(boxed.url, '/api/settings/batocera/test', { address: '127.0.0.1', user: 'root' }))).toEqual(locked);
		expect(await answer(await send(boxed.url, '/api/settings/batocera/test-wake'))).toEqual(locked);
	});

	it('refuses the wake test without a MAC', async () => {
		const cookie = await unlock(off.url);
		expect(await answer(await send(off.url, '/api/settings/batocera/test-wake', undefined, { cookie }))).toEqual({
			status: 400,
			body: { error: 'no-mac' }
		});
	});

	it('refuses a test from another site', async () => {
		const evil = { origin: 'http://evil.example', cookie: await unlock(boxed.url) };
		const refused = { status: 403, body: { error: 'cross-site' } };
		expect(await answer(await send(boxed.url, '/api/settings/batocera/test', { address: '127.0.0.1', user: 'root' }, evil))).toEqual(refused);
		expect(await answer(await send(boxed.url, '/api/settings/batocera/test-wake', undefined, evil))).toEqual(refused);
		expect(box.shutdowns).toBe(0);
	});
});

describe("a game's state on Batocera", () => {
	/** A request of the page, with what the browser adds. */
	const call = (at: string, method: string, path: string, headers: Record<string, string> = {}) => fetch(`${at}${path}`, { method, headers });

	it("answers a game's state", async () => {
		const { status, body } = await answer(await call(ready.url, 'GET', '/api/batocera/games/3001'));
		expect(status).toBe(200);
		// The game's installer and its DLC's, 1 MB each in the fixture.
		expect(body).toMatchObject({ can: true, system: 'windows', size: 2 * 1024 ** 2, onBox: 'no', marked: false, newer: false, job: null });
		// The first answer started a look, and a later answer has it.
		await waitFor(async () => ((await (await call(ready.url, 'GET', '/api/batocera/games/3001')).json()) as { box: string }).box === 'up', 'the look');
		expect(await answer(await call(ready.url, 'GET', '/api/batocera/games/9999'))).toEqual({ status: 404, body: { error: 'not-in-library' } });
	});

	it('says Batocera is off while it is not set up', async () => {
		const offAnswer = { status: 404, body: { error: 'batocera-off' } };
		expect(await answer(await call(off.url, 'GET', '/api/batocera/games/3001'))).toEqual(offAnswer);
		const cookie = await unlock(off.url);
		expect(await answer(await call(off.url, 'PUT', '/api/batocera/marks/3001', { cookie }))).toEqual(offAnswer);
	});

	it('marks a game only while unlocked', async () => {
		const state = async () => (await answer(await call(ready.url, 'GET', '/api/batocera/games/3001'))).body;
		const notRunning = async () => JSON.parse(await readFile(join(ready.settingsDir, 'settings.json'), 'utf8')).notRunning;
		expect(await answer(await call(ready.url, 'PUT', '/api/batocera/marks/3001'))).toEqual({ status: 401, body: { error: 'locked' } });
		const cookie = await unlock(ready.url);
		expect(await answer(await call(ready.url, 'PUT', '/api/batocera/marks/3001', { cookie, origin: 'http://evil.example' }))).toEqual({
			status: 403,
			body: { error: 'cross-site' }
		});
		expect(await state()).toMatchObject({ marked: false, can: true });

		expect(await answer(await call(ready.url, 'PUT', '/api/batocera/marks/3001', { cookie }))).toEqual({ status: 204, body: null });
		expect(await answer(await call(ready.url, 'PUT', '/api/batocera/marks/3001', { cookie }))).toEqual({ status: 204, body: null });
		expect(await state()).toMatchObject({ marked: true, can: false });
		expect(await notRunning()).toEqual(['3001']);

		expect(await answer(await call(ready.url, 'DELETE', '/api/batocera/marks/3001', { cookie }))).toEqual({ status: 204, body: null });
		expect(await state()).toMatchObject({ marked: false, can: true });
		expect(await notRunning()).toEqual([]);
	});
});

describe('sending a game to Batocera', () => {
	/** A request of the page, with what the browser adds. */
	const call = (at: string, method: string, path: string, headers: Record<string, string> = {}) => fetch(`${at}${path}`, { method, headers });
	type Job = { id: string; state: string; step: string; stepNumber: number; steps: number } | null;
	const job = async (id: string): Promise<{ job: Job; onBox: string }> => (await answer(await call(ready.url, 'GET', `/api/batocera/games/${id}`))).body as { job: Job; onBox: string };
	const jobs = async (): Promise<number> => ((await (await fetch(`${ready.url}/healthz`)).json()) as { jobs: number }).jobs;

	/** Until `check` holds, 15 seconds at most. */
	async function within15s(check: () => Promise<boolean>, what: string): Promise<void> {
		const deadline = Date.now() + 15_000;
		while (!(await check())) {
			if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}. Output of the app:\n${output}`);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}

	it('sends a game and shows its steps', async () => {
		// vangogh gives the files slowly, so that the send can be seen running.
		vangogh.slowFileDelayMs = 10;
		try {
			const sent = await answer(await call(ready.url, 'POST', '/api/batocera/games/3001/send'));
			expect(sent.status).toBe(202);
			expect(sent.body).toMatchObject({ state: 'running', step: 'copy', stepNumber: 1, steps: 3, reason: null });
			const id = (sent.body as { id: string }).id;
			expect((await job('3001')).job).toMatchObject({ id, state: 'running' });
			// Asked again, the same job.
			expect((await answer(await call(ready.url, 'POST', '/api/batocera/games/3001/send'))).body).toMatchObject({ id });

			await within15s(async () => (await job('3001')).job?.state === 'done', 'the send');
			expect(await job('3001')).toMatchObject({ job: { id, state: 'done' }, onBox: 'canvas' });
			expect(await readFile(join(box.root, 'userdata/roms/windows/Night Harbour.pc/autorun.cmd'), 'utf8')).toBe('DIR=bin\nCMD="Harbour.exe"\n');
		} finally {
			vangogh.slowFileDelayMs = 0;
		}
	});

	it('stops a send', async () => {
		vangogh.slowFileDelayMs = 50;
		try {
			const sent = await answer(await call(ready.url, 'POST', '/api/batocera/games/3003/send'));
			expect(sent.status).toBe(202);
			const id = (sent.body as { id: string }).id;
			expect(await answer(await call(ready.url, 'DELETE', `/api/batocera/jobs/${id}`, { origin: 'http://evil.example' }))).toEqual({
				status: 403,
				body: { error: 'cross-site' }
			});
			expect(await answer(await call(ready.url, 'DELETE', `/api/batocera/jobs/${id}`))).toEqual({ status: 204, body: null });
			expect((await job('3003')).job).toBeNull();
			expect(await answer(await call(ready.url, 'DELETE', `/api/batocera/jobs/${id}`))).toEqual({ status: 404, body: { error: 'no-such-job' } });
			await within15s(async () => (await jobs()) === 0, 'the stopped send to be cleaned up');
			expect(existsSync(join(box.root, 'userdata/roms/dos/Cellar Quest.pc.part'))).toBe(false);
			expect(existsSync(join(box.root, 'userdata/roms/dos/Cellar Quest.pc'))).toBe(false);
		} finally {
			vangogh.slowFileDelayMs = 0;
		}
	});

	it('refuses to send a marked game', async () => {
		const cookie = await unlock(ready.url);
		expect(await answer(await call(ready.url, 'PUT', '/api/batocera/marks/3001', { cookie }))).toEqual({ status: 204, body: null });
		try {
			expect(await answer(await call(ready.url, 'POST', '/api/batocera/games/3001/send'))).toEqual({ status: 409, body: { error: 'cannot-go' } });
		} finally {
			await call(ready.url, 'DELETE', '/api/batocera/marks/3001', { cookie });
		}
		// No Windows files; not in the library; Batocera not set up; from another site.
		expect(await answer(await call(ready.url, 'POST', '/api/batocera/games/3004/send'))).toEqual({ status: 409, body: { error: 'cannot-go' } });
		expect(await answer(await call(ready.url, 'POST', '/api/batocera/games/9999/send'))).toEqual({ status: 404, body: { error: 'not-in-library' } });
		expect(await answer(await call(off.url, 'POST', '/api/batocera/games/3001/send'))).toEqual({ status: 404, body: { error: 'batocera-off' } });
		expect(await answer(await call(off.url, 'DELETE', '/api/batocera/jobs/some-job'))).toEqual({ status: 404, body: { error: 'batocera-off' } });
		expect(await answer(await call(ready.url, 'POST', '/api/batocera/games/3001/send', { origin: 'http://evil.example' }))).toEqual({
			status: 403,
			body: { error: 'cross-site' }
		});
	});

	it('counts the jobs in /healthz', async () => {
		expect(await jobs()).toBe(0);
		vangogh.slowFileDelayMs = 10;
		try {
			expect((await call(ready.url, 'POST', '/api/batocera/games/3003/send')).status).toBe(202);
			expect(await jobs()).toBe(1);
			await within15s(async () => (await job('3003')).job?.state === 'done', 'the send');
			expect(await jobs()).toBe(0);
		} finally {
			vangogh.slowFileDelayMs = 0;
		}
		expect(((await (await fetch(`${off.url}/healthz`)).json()) as { jobs: number }).jobs).toBe(0);
	});
});

describe('playing on the TV, and the shutdown after a send', () => {
	type State = { onBox: string; countdown: number | null; job: { state: string; waking: string } | null };
	const state = async (id: string): Promise<State> => (await answer(await fetch(`${waker.url}/api/batocera/games/${id}`))).body as State;
	const play = (at: string, id: string, body: unknown = { closeRunning: false }, headers: Record<string, string> = {}) =>
		send(at, `/api/batocera/games/${id}/play`, body, headers);

	/** Until `check` holds, `ms` at most. */
	async function within(ms: number, check: () => Promise<boolean>, what: string): Promise<void> {
		const deadline = Date.now() + ms;
		while (!(await check())) {
			if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}. Output of the app:\n${output}`);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}

	/** Sends Cellar Quest with the box off, so that Canvas wakes it, and answers its state once sent. */
	async function sendWoken(): Promise<State> {
		await box.off();
		expect((await send(waker.url, '/api/batocera/games/3003/send')).status).toBe(202);
		await within(15_000, async () => (await state('3003')).job?.state === 'done', 'the send');
		return state('3003');
	}

	it('plays a game that is on the box', async () => {
		await mkdir(join(box.root, 'userdata/roms/windows/Night Harbour.pc'), { recursive: true });
		await within(20_000, async () => (await state('3001')).onBox !== 'no', 'the look');
		const before = box.es.launched.length;
		expect(await answer(await play(waker.url, '3001'))).toEqual({ status: 200, body: { started: true } });
		expect(box.es.launched.slice(before)).toEqual(['/userdata/roms/windows/Night Harbour.pc']);
		// Not on the box; not in the library; Batocera not set up; from another site.
		expect(await answer(await play(waker.url, '3004'))).toEqual({ status: 409, body: { error: 'not-on-box' } });
		expect(await answer(await play(waker.url, '9999'))).toEqual({ status: 404, body: { error: 'not-in-library' } });
		expect(await answer(await play(off.url, '3001'))).toEqual({ status: 404, body: { error: 'batocera-off' } });
		expect(await answer(await play(waker.url, '3001', { closeRunning: false }, { origin: 'http://evil.example' }))).toEqual({
			status: 403,
			body: { error: 'cross-site' }
		});
		expect(box.es.launched.length).toBe(before + 1);
	});

	it('asks before closing a running game', async () => {
		box.es.running = 'Other Game';
		const killed = box.es.killed;
		expect(await answer(await play(waker.url, '3001'))).toEqual({ status: 409, body: { error: 'game-running', name: 'Other Game' } });
		expect(box.es.killed).toBe(killed);
		expect(await answer(await play(waker.url, '3001', { closeRunning: true }))).toEqual({ status: 200, body: { started: true } });
		expect(box.es.killed).toBe(killed + 1);
		// The game on the TV is now the one started.
		expect(box.es.running).toBe('Night Harbour');
	});

	it('shuts down after a send it woke the box for', async () => {
		const shutdowns = box.shutdowns;
		try {
			const sent = await sendWoken();
			expect(sent.job).toMatchObject({ state: 'done', waking: 'awake' });
			expect(sent.countdown).toEqual(expect.any(Number));
			await within(5000, async () => box.shutdowns === shutdowns + 1, 'the shutdown');
		} finally {
			// The box goes off after the shutdown; on again for what follows.
			await within(5000, async () => !box.isOn(), 'the box to go off');
			await box.on();
		}
	});

	it('keeps it on', async () => {
		const shutdowns = box.shutdowns;
		expect((await sendWoken()).countdown).toEqual(expect.any(Number));
		expect(await answer(await send(waker.url, '/api/batocera/keep-on', undefined, { origin: 'http://evil.example' }))).toEqual({
			status: 403,
			body: { error: 'cross-site' }
		});
		expect(await answer(await send(waker.url, '/api/batocera/keep-on'))).toEqual({ status: 204, body: null });
		expect((await state('3003')).countdown).toBeNull();
		expect(await answer(await send(off.url, '/api/batocera/keep-on'))).toEqual({ status: 404, body: { error: 'batocera-off' } });
		await new Promise((resolve) => setTimeout(resolve, 3000));
		expect(box.shutdowns).toBe(shutdowns);
		expect(box.isOn()).toBe(true);
	});
});
