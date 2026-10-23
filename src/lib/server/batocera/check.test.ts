import { readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFakeBatocera, type FakeBatocera } from '../testing/fake-batocera';
import { openBox, portOpen, type Box, type BoxLogin } from './box';
import { isIdle, testConnection, testWake, type CheckDeps } from './check';
import { sendWake } from './wake';

let fake: FakeBatocera;

beforeEach(async () => {
	fake = await startFakeBatocera();
});

afterEach(async () => {
	await fake.close();
});

const deps = (over: Partial<CheckDeps> = {}): CheckDeps => ({
	port: fake.port,
	wakeTo: `127.0.0.1:${fake.wakePort}`,
	open: openBox,
	portOpen,
	wake: sendWake,
	...over
});

const input = (over: Partial<{ address: string; user: string; password: string }> = {}) => ({
	address: '127.0.0.1',
	user: fake.user,
	password: fake.password,
	...over
});

const login = (): BoxLogin => ({ address: '127.0.0.1', port: fake.port, user: fake.user, password: fake.password, hostKey: fake.fingerprint });

async function all<T>(lines: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const line of lines) out.push(line);
	return out;
}

describe('testConnection', () => {
	it('passes every check and reads the MAC', async () => {
		expect(await all(testConnection(input(), deps()))).toEqual([
			{ step: 1, result: 'ok', address: '127.0.0.1' },
			{ step: 2, result: 'ok' },
			{ step: 3, result: 'ok' },
			{ step: 4, result: 'ok', free: 400 * 1024 ** 3, version: '43.1' },
			{ step: 5, result: 'ok' },
			{ done: true, ready: true, mac: '02:00:00:aa:bb:cc', hostKey: fake.fingerprint }
		]);
		// The probes are gone again.
		expect(await readdir(join(fake.root, 'userdata/roms/windows'))).toEqual([]);
		expect(await readdir(join(fake.root, 'userdata/roms/dos'))).toEqual([]);
	});

	it('stops at a refused login', async () => {
		expect(await all(testConnection(input({ password: 'not the password' }), deps()))).toEqual([
			{ step: 1, result: 'ok', address: '127.0.0.1' },
			{ step: 2, result: 'fail', login: 'refused' },
			{ done: true, ready: false, mac: null, hostKey: null, error: 'Batocera refused the login' }
		]);
	});

	it('tells SSH that did not start in time from a refused login', async () => {
		await fake.close();
		// The box takes the connection at once and says its first line too late, as one that looks up the client's name.
		fake = await startFakeBatocera({ greetingDelayMs: 2000 });
		const open: CheckDeps['open'] = (login) => openBox(login, { timeoutMs: 500 });
		expect(await all(testConnection(input(), deps({ open })))).toEqual([
			{ step: 1, result: 'ok', address: '127.0.0.1' },
			{ step: 2, result: 'fail', login: 'no-ssh' },
			{ done: true, ready: false, mac: null, hostKey: null, error: 'timed out' }
		]);
	});

	it('stops when the box cannot be written', async () => {
		const windows = join(fake.root, 'userdata/roms/windows');
		await rm(windows, { recursive: true });
		await writeFile(windows, 'a file where the folder should be');
		expect(await all(testConnection(input(), deps()))).toEqual([
			{ step: 1, result: 'ok', address: '127.0.0.1' },
			{ step: 2, result: 'ok' },
			{ step: 3, result: 'fail', folder: '/userdata/roms/windows', reason: 'Failure' },
			{ done: true, ready: false, mac: null, hostKey: null }
		]);
	});

	it('fails line 3 when the box has no innoextract', async () => {
		fake.innoextract = false;
		expect(await all(testConnection(input(), deps()))).toEqual([
			{ step: 1, result: 'ok', address: '127.0.0.1' },
			{ step: 2, result: 'ok' },
			{ step: 3, result: 'fail', noInnoextract: true },
			{ done: true, ready: false, mac: null, hostKey: null }
		]);
		// The probes are gone all the same.
		expect(await readdir(join(fake.root, 'userdata/roms/windows'))).toEqual([]);
		expect(await readdir(join(fake.root, 'userdata/roms/dos'))).toEqual([]);
	});

	it('passes with a warning when EmulationStation does not answer', async () => {
		fake.es.up = false;
		const lines = await all(testConnection(input(), deps()));
		expect(lines[4]).toEqual({ step: 5, result: 'warn' });
		expect(lines[5]).toMatchObject({ done: true, ready: true });
	});

	it('says nothing answers', async () => {
		await fake.off();
		expect(await all(testConnection(input(), deps()))).toEqual([
			{ step: 1, result: 'fail', address: '127.0.0.1' },
			{ done: true, ready: false, mac: null, hostKey: null }
		]);
	});
});

describe('isIdle', () => {
	it('reads 201 as a game running, as the box answers then', async () => {
		const box = await openBox(login());
		try {
			expect(await isIdle(box)).toBe(true);
			fake.es.idle = false;
			expect(await isIdle(box)).toBe(false);
			fake.es.up = false;
			expect(await isIdle(box)).toBeNull();
		} finally {
			box.close();
		}
	});

	it('takes [ true ], [ false ], true or false with 200 or 201, and nothing else', async () => {
		const said = (status: number, body: string) => isIdle({ es: async () => ({ status, body }) } as unknown as Box);
		expect(await said(200, '[ true ]')).toBe(true);
		expect(await said(201, '[ false ]')).toBe(false);
		expect(await said(200, 'false')).toBe(false);
		expect(await said(201, 'true')).toBe(true);
		expect(await said(404, '[ true ]')).toBeNull();
		expect(await said(500, '[ false ]')).toBeNull();
		expect(await said(200, 'busy')).toBeNull();
		expect(await said(201, '[ "no" ]')).toBeNull();
	});
});

describe('testWake', () => {
	it('shuts the box down and wakes it', async () => {
		const lines = await all(testWake({ ...deps(), mac: fake.mac, address: '127.0.0.1', login: login() }));
		expect(lines).toEqual([
			{ step: 'down', result: 'ok' },
			{ step: 'waking', result: 'ok' },
			{ done: true, seconds: expect.any(Number) }
		]);
		expect(fake.shutdowns).toBe(1);
		expect(fake.isOn()).toBe(true);
	});

	it('wakes a box that is off already, without shutting it down', async () => {
		await fake.off();
		const lines = await all(testWake({ ...deps(), mac: fake.mac, address: '127.0.0.1', login: login() }));
		expect(lines).toEqual([
			{ step: 'down', result: 'ok' },
			{ step: 'waking', result: 'ok' },
			{ done: true, seconds: expect.any(Number) }
		]);
		expect(fake.shutdowns).toBe(0);
		expect(fake.isOn()).toBe(true);
	});

	it('says when the box does not wake', async () => {
		await fake.close();
		// It takes a minute to answer a packet: longer than the test waits.
		fake = await startFakeBatocera({ bootMs: 60_000 });
		const lines = await all(testWake({ ...deps({ upWaitMs: 500 }), mac: fake.mac, address: '127.0.0.1', login: login() }));
		expect(lines).toEqual([
			{ step: 'down', result: 'ok' },
			{ step: 'waking', result: 'fail' },
			{ done: true, seconds: null }
		]);
		expect(fake.isOn()).toBe(false);
	});

	it('will not shut down while a game runs', async () => {
		fake.es.idle = false;
		const lines = await all(testWake({ ...deps(), mac: fake.mac, address: '127.0.0.1', login: login() }));
		expect(lines).toEqual([{ step: 'down', result: 'busy' }, { done: true, seconds: null }]);
		expect(fake.shutdowns).toBe(0);
		expect(fake.isOn()).toBe(true);
	});
});
