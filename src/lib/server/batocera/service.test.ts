import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameOnBox, TestLine } from '../../batocera';
import { NO_BATOCERA, NO_SETTINGS } from '../../settings';
import { loadConfig } from '../config';
import type { Index } from '../index-types';
import { buildIndex } from '../indexer';
import { createLogger, silentLogger } from '../log';
import { SettingsStore } from '../settings';
import { IndexStore } from '../store';
import { batoceraLibrary } from '../testing/batocera-library';
import { startFakeBatocera, type FakeBatocera } from '../testing/fake-batocera';
import { startFakeVangogh, type FakeVangogh } from '../testing/fake-vangogh';
import { VangoghClient } from '../vangogh/client';
import { openBox } from './box';
import { markerJson, type Marker } from './folder';
import { Batocera } from './service';

// The real login, counted: each call is a connection to the box.
vi.mock('./box', async (original) => {
	const box = await original<typeof import('./box')>();
	return { ...box, openBox: vi.fn(box.openBox) };
});

let fake: FakeBatocera;
let dir: string;
let settings: SettingsStore;
let service: Batocera;
/** Every line Canvas logged. */
let logged: string[];
/** The index of `batoceraLibrary()`. */
let index: Index;

beforeAll(async () => {
	const vangogh = await startFakeVangogh(batoceraLibrary());
	try {
		index = await buildIndex(new VangoghClient({ url: vangogh.url, username: 'api', password: 'secret' }), silentLogger);
	} finally {
		await vangogh.close();
	}
});

beforeEach(async () => {
	fake = await startFakeBatocera();
	dir = await mkdtemp(join(tmpdir(), 'canvas-service-'));
	logged = [];
	const log = createLogger((line) => logged.push(line));
	const config = loadConfig({
		VANGOGH_URL: 'http://vangogh.lan:1853/',
		VANGOGH_USERNAME: 'api',
		VANGOGH_PASSWORD: 'secret',
		SETTINGS_PIN: '2468',
		SETTINGS_DIR: dir,
		CACHE_DIR: dir,
		BATOCERA_PORT: String(fake.port)
	});
	settings = new SettingsStore({ dir, log });
	await settings.load();
	await settings.save({ ...NO_SETTINGS, batocera: { ...NO_BATOCERA, on: true } });
	const client = new VangoghClient({ url: config.vangoghUrl, username: config.username, password: config.password, log });
	const store = new IndexStore(dir, log);
	await store.set(index);
	service = new Batocera({ config, settings, store, client, log });
	await service.start();
});

afterEach(async () => {
	vi.useRealTimers();
	// No look is under way when the box goes: one a test started is waited for (or one is made).
	await service.look();
	await fake.close();
	await rm(dir, { recursive: true, force: true });
});

async function all<T>(lines: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const line of lines) out.push(line);
	return out;
}

describe('Batocera', () => {
	it('saves the key, the MAC and the login after a passed test, and is ready', async () => {
		expect(service.ready()).toBe(false);
		// No password: the saved one, Batocera's own default, which the fake box takes.
		const lines: TestLine[] = await all(service.testConnection({ address: '127.0.0.1', user: 'root' }));
		// The browser is told the MAC, never the key.
		expect(lines.at(-1)).toEqual({ done: true, ready: true, mac: '02:00:00:aa:bb:cc' });
		expect(settings.get().batocera).toEqual({
			...NO_BATOCERA,
			on: true,
			address: '127.0.0.1',
			user: 'root',
			password: 'linux',
			ready: true,
			hostKey: fake.fingerprint,
			mac: '02:00:00:aa:bb:cc'
		});
		expect(service.ready()).toBe(true);
	});

	it('is not ready after a failed test', async () => {
		await all(service.testConnection({ address: '127.0.0.1', user: 'root' }));
		expect(service.ready()).toBe(true);
		const lines = await all(service.testConnection({ address: '127.0.0.1', user: 'root', password: 'not the password' }));
		expect(lines.at(-1)).toEqual({ done: true, ready: false, mac: null });
		expect(service.ready()).toBe(false);
		// The log says why the login failed; the browser is not told.
		expect(logged.join('\n')).toContain('result="failed at 2" reason="Batocera refused the login"');
		// What the last passed test saved stays, the password typed for the failed one is not saved.
		expect(settings.get().batocera).toMatchObject({ password: 'linux', hostKey: fake.fingerprint, mac: '02:00:00:aa:bb:cc', ready: false });
	});

	it('logs in with a password that holds spaces, quotes and $, and never logs it', async () => {
		const password = `pa ss'"$word`;
		fake.password = password;
		const lines = await all(service.testConnection({ address: '127.0.0.1', user: 'root', password }));
		expect(lines.at(-1)).toMatchObject({ done: true, ready: true });
		expect(settings.get().batocera.password).toBe(password);
		// Written as typed into the settings file, and nowhere else.
		expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')).batocera.password).toBe(password);
		expect(logged.length).toBeGreaterThan(0);
		expect(logged.join('\n')).not.toContain('pa ss');
	});
});

const sent: Marker = {
	gameId: '3001',
	system: 'windows',
	files: ['setup_night_harbour_1.2.exe', 'setup_night_harbour_lighthouse_1.2.exe'],
	version: '1.2',
	sentAt: '2026-10-20T21:14:03Z',
	canvas: '0.12.0'
};

/** Writes a file on the fake box, the folders above it too. */
async function put(path: string, text: string): Promise<void> {
	const file = join(fake.root, path);
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, text);
}

/** Batocera set up with the fake box, as after a passed connection test. */
async function setUp(): Promise<void> {
	await settings.save({
		...NO_SETTINGS,
		batocera: { ...NO_BATOCERA, on: true, address: '127.0.0.1', ready: true, hostKey: fake.fingerprint, mac: fake.mac }
	});
}

describe('Batocera and the last look', () => {
	it('answers at once from the last look and looks again after a minute', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-10-20T20:00:00Z'));
		await setUp();
		const connections = vi.mocked(openBox);
		connections.mockClear();

		// No look yet: the answer comes at once, and a look starts.
		expect(await service.state('3001')).toMatchObject({ onBox: 'no', box: 'unknown', checkedAt: null });
		expect(connections).toHaveBeenCalledTimes(1);
		await service.look();
		expect(connections).toHaveBeenCalledTimes(1);

		await put('userdata/roms/windows/Night Harbour.pc/canvas.json', markerJson(sent));
		vi.setSystemTime(new Date('2026-10-20T20:00:59Z'));
		expect(await service.state('3001')).toMatchObject({ onBox: 'no', box: 'up', checkedAt: '2026-10-20T20:00:00.000Z' });
		expect(connections).toHaveBeenCalledTimes(1);

		vi.setSystemTime(new Date('2026-10-20T20:01:01Z'));
		// Still the last look's answer, while the new look is under way.
		expect(await service.state('3001')).toMatchObject({ onBox: 'no', box: 'up' });
		expect(await service.state('3003')).toMatchObject({ onBox: 'no', box: 'up' });
		expect(connections).toHaveBeenCalledTimes(2);
		await service.look();
		expect(connections).toHaveBeenCalledTimes(2);
		expect(await service.state('3001')).toMatchObject({
			onBox: 'canvas',
			version: '1.2',
			sentAt: '2026-10-20T21:14:03Z',
			newer: false,
			box: 'up',
			checkedAt: '2026-10-20T20:01:01.000Z'
		});
	});

	it('keeps the last look and says the box is down when it does not answer', async () => {
		await setUp();
		await put('userdata/roms/windows/Night Harbour.pc/canvas.json', markerJson(sent));
		await service.look();
		expect(await service.state('3001')).toMatchObject({ onBox: 'canvas', box: 'up' });

		await fake.off();
		await service.look();
		const down = await service.state('3001');
		expect(down).toMatchObject({ onBox: 'canvas', version: '1.2', box: 'down' });
		expect(down?.checkedAt).not.toBeNull();

		// A box whose key is not the saved one counts as not answering, with a warning.
		await fake.on();
		await settings.update((s) => ({ ...s, batocera: { ...s.batocera, hostKey: 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } }));
		await service.look();
		expect(await service.state('3001')).toMatchObject({ onBox: 'canvas', box: 'down' });
		expect(logged.some((line) => line.includes('WARN') && line.includes('key'))).toBe(true);
	});

	it("removes Canvas's leftovers at a look", async () => {
		await setUp();
		await put('userdata/roms/windows/Night Harbour.pc.part/canvas.json', markerJson(sent));
		await put('userdata/roms/dos/Cellar Quest.pc.old/canvas.json', markerJson({ ...sent, gameId: '3003', system: 'dos' }));
		await put('userdata/roms/windows/Mine.pc.part/game.exe', 'not Canvas');

		await service.look();
		const left = async (path: string) => readFile(join(fake.root, path)).then(() => true, () => false);
		expect(await left('userdata/roms/windows/Night Harbour.pc.part/canvas.json')).toBe(false);
		expect(await left('userdata/roms/dos/Cellar Quest.pc.old/canvas.json')).toBe(false);
		expect(await left('userdata/roms/windows/Mine.pc.part/game.exe')).toBe(true);
		expect(logged.filter((line) => line.includes('INFO') && line.includes('leftover'))).toHaveLength(2);
		// A leftover is not the game on the box.
		expect(await service.state('3001')).toMatchObject({ onBox: 'no', can: true });
	});

	it('cannot send a marked game, a game without Windows files, or one put there by hand', async () => {
		await setUp();
		await mkdir(join(fake.root, 'userdata/roms/dos/Cellar Quest.pc'), { recursive: true });
		await service.look();

		expect(await service.state('3001')).toMatchObject({ can: true, marked: false, onBox: 'no' });
		expect(await service.state('3003')).toMatchObject({ can: false, onBox: 'hand' });
		expect(await service.state('3004')).toMatchObject({ can: false, onBox: 'no', size: 0 });
		expect(await service.mark('3001', true)).toBe(true);
		expect(await service.state('3001')).toMatchObject({ can: false, marked: true });
		expect(settings.get().notRunning).toEqual(['3001']);
		expect(await service.state('9999')).toBeNull();
	});

	it("sizes the files to send, the game's and its DLC's", async () => {
		await setUp();
		expect(service.archiveFiles(index.details['3001']).map((f) => f.filename)).toEqual([
			'setup_night_harbour_1.2.exe',
			'setup_night_harbour_lighthouse_1.2.exe'
		]);
		// Only the Windows installer goes, not the macOS one.
		expect(service.archiveFiles(index.details['3003']).map((f) => f.filename)).toEqual(['setup_cellar_quest_1.0.exe']);
		expect(await service.state('3001')).toMatchObject({ system: 'windows', size: 2 * 1024 ** 2 });
		expect(await service.state('3003')).toMatchObject({ system: 'dos', size: 1024 ** 2 });
	});

	it('looks at the box after a passed connection test', async () => {
		await put('userdata/roms/windows/Night Harbour.pc/canvas.json', markerJson(sent));
		await all(service.testConnection({ address: '127.0.0.1', user: 'root' }));
		expect(await service.state('3001')).toMatchObject({ onBox: 'canvas', box: 'up' });
	});
});

describe('Batocera and a send', () => {
	it("keeps a running send's own folder out of a look", async () => {
		const vangogh = await startFakeVangogh(batoceraLibrary());
		const real = (await vi.importActual<typeof import('./box')>('./box')).openBox;
		try {
			await setUp();
			const config = loadConfig({
				VANGOGH_URL: vangogh.url,
				VANGOGH_USERNAME: 'api',
				VANGOGH_PASSWORD: 'secret',
				SETTINGS_PIN: '2468',
				SETTINGS_DIR: dir,
				CACHE_DIR: dir,
				BATOCERA_PORT: String(fake.port)
			});
			const log = createLogger((line) => logged.push(line));
			const store = new IndexStore(dir, log);
			await store.set(index);
			const client = new VangoghClient({ url: config.vangoghUrl, username: config.username, password: config.password, log });
			const sending = new Batocera({ config, settings, store, client, log });
			await sending.start();
			const part = join(fake.root, 'userdata/roms/windows/Night Harbour.pc.part/canvas.json');
			let keptDuringLook: boolean | null = null;
			// Once each installer is on the box, a look comes before the game is put in place.
			vi.mocked(openBox).mockImplementation(async (login, o) => {
				const box = await real(login, o);
				return {
					...box,
					put: async (file, from, p) => {
						await box.put(file, from, p);
						await sending.look();
						keptDuringLook = existsSync(part);
					}
				};
			});

			const job = sending.send('3001');
			expect(job).toMatchObject({ state: 'running', steps: 3 });
			expect(sending.send('3001')).toMatchObject({ id: (job as { id: string }).id });
			expect(sending.jobs()).toBe(1);
			const deadline = Date.now() + 15_000;
			while ((await sending.state('3001'))?.job?.state === 'running' && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));

			expect(keptDuringLook).toBe(true);
			// The look at the end of the job has the game.
			expect(await sending.state('3001')).toMatchObject({ job: { state: 'done' }, onBox: 'canvas', version: '1.2' });
			expect(await readFile(join(fake.root, 'userdata/roms/windows/Night Harbour.pc/autorun.cmd'), 'utf8')).toBe('DIR=bin\nCMD="Harbour.exe"\n');
			expect(sending.jobs()).toBe(0);
			// A game that cannot go, and one not in the library.
			expect(sending.send('3004')).toBe('cannot-go');
			expect(sending.send('9999')).toBeNull();
		} finally {
			vi.mocked(openBox).mockImplementation(real);
			await vangogh.close();
		}
	});
});

describe('Batocera, the countdown and play', () => {
	let vangogh: FakeVangogh;
	/** A Batocera that sends from the fake vangogh, with waking and shutting down on. */
	let sending: Batocera;

	beforeEach(async () => {
		vangogh = await startFakeVangogh(batoceraLibrary());
		await setUp();
		await settings.update((s) => ({ ...s, batocera: { ...s.batocera, wake: true, shutdown: true } }));
		const config = loadConfig({
			VANGOGH_URL: vangogh.url,
			VANGOGH_USERNAME: 'api',
			VANGOGH_PASSWORD: 'secret',
			SETTINGS_PIN: '2468',
			SETTINGS_DIR: dir,
			CACHE_DIR: dir,
			BATOCERA_PORT: String(fake.port),
			BATOCERA_WAKE_TO: `127.0.0.1:${fake.wakePort}`
		});
		const log = createLogger((line) => logged.push(line));
		const store = new IndexStore(dir, log);
		await store.set(index);
		const client = new VangoghClient({ url: config.vangoghUrl, username: config.username, password: config.password, log });
		sending = new Batocera({ config, settings, store, client, log });
		await sending.start();
	});

	afterEach(async () => {
		sending.keepOn();
		await until(async () => sending.jobs() === 0 && (await sending.state('3001'))?.play?.state !== 'waking');
		await sending.look();
		await vangogh.close();
	});

	async function until(check: () => Promise<boolean>): Promise<void> {
		const deadline = Date.now() + 10_000;
		while (!(await check())) {
			if (Date.now() > deadline) throw new Error(`timed out. The log:\n${logged.join('\n')}`);
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
	}

	/** The game's state once its send has ended, sent or failed. */
	async function ended(gameId: string): Promise<GameOnBox> {
		await until(async () => ['done', 'failed'].includes((await sending.state(gameId))?.job?.state ?? ''));
		return (await sending.state(gameId))!;
	}

	const counting = (state: GameOnBox | null) => {
		expect(state?.countdown).toBeGreaterThan(0);
		expect(state?.countdown).toBeLessThanOrEqual(600);
	};

	it('starts a countdown only when Canvas woke the box and shutdown is on', async () => {
		// The box answers: Canvas did not wake it.
		sending.send('3001');
		expect(await ended('3001')).toMatchObject({ job: { state: 'done', waking: 'no' }, countdown: null });

		await fake.off();
		sending.send('3001');
		const woken = await ended('3001');
		expect(woken.job).toMatchObject({ state: 'done', waking: 'awake' });
		counting(woken);
		// Only the detail of the game just sent shows it.
		expect((await sending.state('3003'))?.countdown).toBeNull();
		sending.keepOn();

		await settings.update((s) => ({ ...s, batocera: { ...s.batocera, shutdown: false } }));
		await fake.off();
		sending.send('3001');
		expect(await ended('3001')).toMatchObject({ job: { state: 'done', waking: 'awake' }, countdown: null });
	});

	it('counts a failed send it woke the box for', async () => {
		await fake.off();
		fake.freeBytes = 1024;
		sending.send('3001');
		const failed = await ended('3001');
		expect(failed.job).toMatchObject({ state: 'failed', waking: 'awake', reason: { code: 'box-room' } });
		counting(failed);
	});

	it('Play and Keep it on cancel the countdown', async () => {
		await fake.off();
		sending.send('3001');
		counting(await ended('3001'));
		expect(await sending.play('3001', false)).toEqual({ state: 'started' });
		expect((await sending.state('3001'))?.countdown).toBeNull();

		await fake.off();
		sending.send('3001');
		counting(await ended('3001'));
		sending.keepOn();
		expect((await sending.state('3001'))?.countdown).toBeNull();
	});

	it('a new send cancels it', async () => {
		await fake.off();
		sending.send('3001');
		counting(await ended('3001'));
		sending.send('3003');
		expect((await sending.state('3001'))?.countdown).toBeNull();
		// Canvas woke the box for the send before, so the new send's end starts it again, for the new game.
		counting(await ended('3003'));
		expect((await sending.state('3001'))?.countdown).toBeNull();
	});

	it('wakes the box to play when waking is on, and plays in the background', async () => {
		await put('userdata/roms/windows/Night Harbour.pc/canvas.json', markerJson(sent));
		await sending.look();
		await fake.off();
		expect(await sending.play('3001', false)).toEqual({ state: 'waking' });
		expect((await sending.state('3001'))?.play).toEqual({ state: 'waking' });
		// A play's result is its own game's.
		expect((await sending.state('3003'))?.play).toBeNull();
		await until(async () => (await sending.state('3001'))?.play?.state === 'started');
		expect(fake.es.launched).toEqual(['/userdata/roms/windows/Night Harbour.pc']);
	});

	it('forgets the last Play of a game when a send of it is queued', async () => {
		// Not on the box yet: Play says so, and the answer is kept with the game's state.
		expect(await sending.play('3001', false)).toEqual({ state: 'gone' });
		expect((await sending.state('3001'))?.play).toEqual({ state: 'gone' });
		sending.send('3001');
		expect((await sending.state('3001'))?.play).toBeNull();
		expect((await ended('3001')).play).toBeNull();
	});

	it('says the box is down to play when waking is off', async () => {
		await settings.update((s) => ({ ...s, batocera: { ...s.batocera, wake: false } }));
		await put('userdata/roms/windows/Night Harbour.pc/canvas.json', markerJson(sent));
		await sending.look();
		await fake.off();
		expect(await sending.play('3001', false)).toEqual({ state: 'box-down' });
		expect(fake.isOn()).toBe(false);
		expect(fake.es.launched).toEqual([]);
	});

	/** Fake time that also runs on by itself, so that the box and vangogh answer as they do; ten minutes can be skipped. */
	const fakeTime = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });

	it('stops the countdown when "Shut down after sending" is switched off', async () => {
		fakeTime();
		await fake.off();
		sending.send('3001');
		counting(await ended('3001'));
		await settings.update((s) => ({ ...s, batocera: { ...s.batocera, shutdown: false } }));
		expect((await sending.state('3001'))?.countdown).toBeNull();
		await sending.look();
		await vi.advanceTimersByTimeAsync(600_000);
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(fake.shutdowns).toBe(0);
	});

	it('shuts the box down at zero', async () => {
		fakeTime();
		await fake.off();
		sending.send('3001');
		counting(await ended('3001'));
		await vi.advanceTimersByTimeAsync(600_000);
		await until(async () => logged.some((line) => line.includes('shut down,') || line.includes('could not be shut down')));
		expect(logged.filter((line) => line.includes('shut down,') || line.includes('could not be shut down'))).toEqual([
			expect.stringContaining('batocera was shut down, as canvas woke it for the send')
		]);
		expect(fake.shutdowns).toBe(1);
	});

	it('stays on at zero while a game runs on the TV', async () => {
		fakeTime();
		await fake.off();
		sending.send('3001');
		counting(await ended('3001'));
		// A game was started on the TV meanwhile: `/isIdle` answers 201 with [ false ], as the box does.
		fake.es.idle = false;
		await vi.advanceTimersByTimeAsync(600_000);
		await until(async () => logged.some((line) => line.includes('a game runs on the tv, so batocera stays on')));
		expect(fake.shutdowns).toBe(0);
		expect(fake.isOn()).toBe(true);
	});

	it('does not shut down when Play is pressed while the countdown asks whether a game runs', async () => {
		fakeTime();
		await fake.off();
		sending.send('3001');
		counting(await ended('3001'));
		await sending.look();
		// The check at zero waits at `/isIdle` until let go.
		const real = (await vi.importActual<typeof import('./box')>('./box')).openBox;
		let reached!: () => void;
		const asked = new Promise<void>((resolve) => (reached = resolve));
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		vi.mocked(openBox).mockImplementation(async (login, o) => {
			const box = await real(login, o);
			return {
				...box,
				es: async (method, path, body) => {
					if (path === '/isIdle') {
						reached();
						await gate;
					}
					return box.es(method, path, body);
				}
			};
		});
		try {
			await vi.advanceTimersByTimeAsync(600_000);
			await asked;
			expect(await sending.play('3001', false)).toEqual({ state: 'started' });
			release();
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(fake.shutdowns).toBe(0);
			expect(fake.isOn()).toBe(true);
		} finally {
			release();
			vi.mocked(openBox).mockImplementation(real);
		}
	});
});
