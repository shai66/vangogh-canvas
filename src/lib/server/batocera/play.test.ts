import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../log';
import { startFakeBatocera, type FakeBatocera } from '../testing/fake-batocera';
import { openBox, type Box } from './box';
import { listId } from './gamelist';
import { Countdown, playOnBox } from './play';

const HARBOUR = '/userdata/roms/windows/Night Harbour.pc';
/** The game's entry in EmulationStation's list. */
const ENTRY = `GET /systems/windows/games/${listId(HARBOUR)}`;

describe('playOnBox', () => {
	let fake: FakeBatocera;
	let box: Box;

	beforeEach(async () => {
		fake = await startFakeBatocera();
		box = await openBox({ address: '127.0.0.1', port: fake.port, user: fake.user, password: fake.password, hostKey: fake.fingerprint });
		await mkdir(join(fake.root, HARBOUR), { recursive: true });
	});

	afterEach(async () => {
		box.close();
		await fake.close();
	});

	/** The game in EmulationStation's list, as after a reload. */
	const listed = () => (fake.es.games.windows = [{ path: HARBOUR, desc: '' }]);

	/** The box, and each ask of its EmulationStation as it is made; an ask `fails` picks fails as one not answered in time. */
	const watched = (fails: (ask: string) => boolean = () => false) => {
		const asked: string[] = [];
		const watching: Box = {
			...box,
			es: async (method, path, body) => {
				const ask = `${method} ${path}`;
				asked.push(ask);
				if (fails(ask)) throw new Error('EmulationStation did not answer in time');
				return box.es(method, path, body);
			}
		};
		return { watching, asked };
	};

	it('starts the game', async () => {
		listed();
		expect(await playOnBox(box, HARBOUR, false)).toEqual({ state: 'started' });
		expect(fake.es.launched).toEqual(['/userdata/roms/windows/Night Harbour.pc']);
		expect(fake.es.reloads).toBe(0);
	});

	it('reloads the list and starts a game Batocera does not list yet', async () => {
		const { watching, asked } = watched();
		expect(await playOnBox(watching, HARBOUR, false)).toEqual({ state: 'started' });
		expect(fake.es.reloads).toBe(1);
		expect(fake.es.launched).toEqual([HARBOUR]);
		expect(asked).toEqual(['GET /runningGame', ENTRY, 'GET /reloadgames', ENTRY, 'POST /launch', 'GET /runningGame']);
	});

	it('keeps looking for the game in the list when a read of it fails meanwhile', async () => {
		// The read after the reload is dropped without an answer, as while EmulationStation is busy.
		fake.es.failGets = 1;
		expect(await playOnBox(box, HARBOUR, false)).toEqual({ state: 'started' });
		expect(fake.es.failGets).toBe(0);
		expect(fake.es.launched).toEqual([HARBOUR]);
	});

	it('keeps asking whether the game runs when a read fails meanwhile', async () => {
		listed();
		// The first ask after the start fails; the one before it asked whether another game runs.
		let reads = 0;
		const { watching, asked } = watched((ask) => ask === 'GET /runningGame' && ++reads === 2);
		expect(await playOnBox(watching, HARBOUR, false)).toEqual({ state: 'started' });
		expect(asked).toEqual(['GET /runningGame', ENTRY, 'POST /launch', 'GET /runningGame', 'GET /runningGame']);
	});

	it('says which game is running', async () => {
		fake.es.running = 'Other Game';
		expect(await playOnBox(box, HARBOUR, false)).toEqual({ state: 'running', name: 'Other Game' });
		expect(fake.es.launched).toEqual([]);
		expect(fake.es.killed).toBe(0);
	});

	it('closes the running game first when asked', async () => {
		listed();
		fake.es.running = 'Other Game';
		const { watching, asked } = watched();
		expect(await playOnBox(watching, HARBOUR, true)).toEqual({ state: 'started' });
		expect(fake.es.killed).toBe(1);
		expect(fake.es.launched).toEqual([HARBOUR]);
		expect(asked).toEqual(['GET /runningGame', 'GET /emukill', 'GET /isIdle', ENTRY, 'POST /launch', 'GET /runningGame']);
	});

	it('closes the running game and starts one sent meanwhile', async () => {
		// Sent while the other game ran: Canvas held the reload back, so Batocera does not list it yet.
		fake.es.running = 'Other Game';
		const { watching, asked } = watched();
		expect(await playOnBox(watching, HARBOUR, true)).toEqual({ state: 'started' });
		expect(fake.es.killed).toBe(1);
		expect(fake.es.reloads).toBe(1);
		expect(fake.es.launched).toEqual([HARBOUR]);
		expect(fake.es.running).toBe('Night Harbour');
		expect(asked).toEqual(['GET /runningGame', 'GET /emukill', 'GET /isIdle', ENTRY, 'GET /reloadgames', ENTRY, 'POST /launch', 'GET /runningGame']);
	});

	it('says the game did not start when Batocera does not run it', async () => {
		listed();
		fake.es.startIgnored = true;
		expect(await playOnBox(box, HARBOUR, false, { startWaitMs: 1000 })).toEqual({ state: 'not-started' });
		expect(fake.es.launched).toEqual([HARBOUR]);
		expect(fake.es.running).toBeNull();
	});

	it('says the game did not start when it does not show in the list', async () => {
		// The reload reads the folders only after the wait.
		fake.es.reloadMs = 60_000;
		expect(await playOnBox(box, HARBOUR, false, { listWaitMs: 1000 })).toEqual({ state: 'not-started' });
		expect(fake.es.reloads).toBe(1);
		expect(fake.es.launched).toEqual([]);
	});

	it('says when there is no screen', async () => {
		fake.primary = null;
		expect(await playOnBox(box, HARBOUR, false)).toEqual({ state: 'no-screen' });
		expect(fake.es.launched).toEqual([]);
	});

	it('says when the game is gone', async () => {
		expect(await playOnBox(box, '/userdata/roms/windows/Cellar Quest.pc', false)).toEqual({ state: 'gone' });
		expect(fake.es.launched).toEqual([]);
	});
});

describe('Countdown', () => {
	let logged: string[];

	beforeEach(() => {
		vi.useFakeTimers();
		logged = [];
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const make = (idle: boolean) => {
		const isIdle = vi.fn(async () => idle);
		const shutdown = vi.fn(async () => {});
		const countdown = new Countdown({ seconds: 600, isIdle, shutdown, log: createLogger((line) => logged.push(line)) });
		return { countdown, isIdle, shutdown };
	};

	it('shuts down at zero', async () => {
		const { countdown, shutdown } = make(true);
		expect(countdown.left()).toBeNull();
		countdown.start();
		expect(countdown.left()).toBe(600);
		// Whole seconds, rounded up.
		await vi.advanceTimersByTimeAsync(1500);
		expect(countdown.left()).toBe(599);
		await vi.advanceTimersByTimeAsync(598_000);
		expect(countdown.left()).toBe(1);
		expect(shutdown).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(500);
		expect(shutdown).toHaveBeenCalledTimes(1);
		expect(countdown.left()).toBeNull();
	});

	it('does not shut down while a game runs', async () => {
		const { countdown, isIdle, shutdown } = make(false);
		countdown.start();
		await vi.advanceTimersByTimeAsync(600_000);
		expect(isIdle).toHaveBeenCalledTimes(1);
		expect(shutdown).not.toHaveBeenCalled();
		expect(countdown.left()).toBeNull();
		expect(logged.some((line) => line.includes('INFO') && line.includes('stays on'))).toBe(true);
	});

	it('can be cancelled', async () => {
		const { countdown, isIdle, shutdown } = make(true);
		countdown.start();
		await vi.advanceTimersByTimeAsync(300_000);
		// It says whether one ran.
		expect(countdown.cancel()).toBe(true);
		expect(countdown.left()).toBeNull();
		await vi.advanceTimersByTimeAsync(600_000);
		expect(isIdle).not.toHaveBeenCalled();
		expect(shutdown).not.toHaveBeenCalled();
		expect(countdown.cancel()).toBe(false);
	});

	it('does not shut down when cancelled during its last check', async () => {
		let answer!: (idle: boolean) => void;
		const isIdle = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
		const shutdown = vi.fn(async () => {});
		const countdown = new Countdown({ seconds: 600, isIdle, shutdown, log: createLogger((line) => logged.push(line)) });
		countdown.start();
		await vi.advanceTimersByTimeAsync(600_000);
		expect(isIdle).toHaveBeenCalledTimes(1);
		// Asking the box whether a game runs: no seconds are left, but it still runs.
		expect(countdown.left()).toBeNull();
		expect(countdown.cancel()).toBe(true);
		answer(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(shutdown).not.toHaveBeenCalled();
		expect(countdown.cancel()).toBe(false);
	});
});
