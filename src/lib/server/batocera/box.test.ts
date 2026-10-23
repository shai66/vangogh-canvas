import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Client, type ClientCallback, type ClientChannel, type ExecOptions } from 'ssh2';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFakeBatocera, type FakeBatocera } from '../testing/fake-batocera';
import { BoxDown, BoxKeyChanged, BoxRefused, fingerprint, openBox, portOpen, type Box, type BoxLogin } from './box';
import { COMMANDS, INSTALLERS, bytesCommand, filesCommand, macFor, parseDf, parseFiles, parseKib, parsePrimary, removeCommand, removeInPartCommand, supportCommand, unpackCommand } from './commands';
import { sendWake } from './wake';

let fake: FakeBatocera;
let boxes: Box[];
let cleanup: (() => Promise<unknown>)[];

beforeEach(async () => {
	fake = await startFakeBatocera();
	boxes = [];
	cleanup = [];
});

afterEach(async () => {
	for (const box of boxes) box.close();
	for (const step of cleanup) await step();
	await fake.close();
});

const login = (over: Partial<BoxLogin> = {}): BoxLogin => ({
	address: '127.0.0.1',
	port: fake.port,
	user: fake.user,
	password: fake.password,
	hostKey: null,
	...over
});

async function open(over: Partial<BoxLogin> = {}): Promise<Box> {
	const box = await openBox(login(over));
	boxes.push(box);
	return box;
}

const until = async (check: () => boolean, ms = 2000) => {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error('timed out');
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
};

describe('openBox', () => {
	it("logs in and reports the host key's fingerprint", async () => {
		expect(fingerprint(Buffer.from('abc'))).toBe('SHA256:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0');
		expect(fake.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
		const box = await open();
		expect(box.hostKey).toBe(fake.fingerprint);
		const again = await open({ hostKey: fake.fingerprint });
		expect(again.hostKey).toBe(fake.fingerprint);
	});

	it('refuses a box whose key is not the one saved', async () => {
		await expect(openBox(login({ hostKey: `SHA256:${'A'.repeat(43)}` }))).rejects.toBeInstanceOf(BoxKeyChanged);
	});

	it('says the login was refused', async () => {
		await expect(openBox(login({ password: 'not the password' }))).rejects.toBeInstanceOf(BoxRefused);
		await expect(openBox(login({ user: 'pi' }))).rejects.toBeInstanceOf(BoxRefused);
	});

	it('says nothing answers', async () => {
		expect(await portOpen('127.0.0.1', fake.port, 1000)).toBe(true);
		await fake.off();
		expect(fake.isOn()).toBe(false);
		expect(await portOpen('127.0.0.1', fake.port, 1000)).toBe(false);
		let started = Date.now();
		await expect(openBox(login(), { timeoutMs: 1000 })).rejects.toBeInstanceOf(BoxDown);
		expect(Date.now() - started).toBeLessThan(2000);

		// A port that takes the connection and never speaks; it closes once the box gave up.
		const silent: Server = createServer((socket) => socket.resume());
		await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
		cleanup.push(() => new Promise((resolve) => { silent.close(resolve); }));
		const port = (silent.address() as { port: number }).port;
		started = Date.now();
		await expect(openBox(login({ port }), { timeoutMs: 1000 })).rejects.toBeInstanceOf(BoxDown);
		expect(Date.now() - started).toBeLessThan(2000);

		await fake.on();
		expect((await open()).hostKey).toBe(fake.fingerprint);
	});

	it('waits for a box that is slow to say its first line, and tells one too slow from a refused login', async () => {
		await fake.close();
		fake = await startFakeBatocera({ greetingDelayMs: 1000 });
		const box = await openBox(login(), { timeoutMs: 3000 });
		expect(box.hostKey).toBe(fake.fingerprint);
		box.close();

		await fake.close();
		fake = await startFakeBatocera({ greetingDelayMs: 3000 });
		const started = Date.now();
		await expect(openBox(login(), { timeoutMs: 1000 })).rejects.toBeInstanceOf(BoxDown);
		expect(Date.now() - started).toBeLessThan(2000);
	});
});

describe('Box', () => {
	it('writes, reads and lists files', async () => {
		const box = await open();
		await box.write('/userdata/roms/windows/note.txt', Buffer.from('hello box'));
		expect((await box.read('/userdata/roms/windows/note.txt'))?.toString()).toBe('hello box');
		expect(await readFile(join(fake.root, 'userdata/roms/windows/note.txt'), 'utf8')).toBe('hello box');
		expect(await box.read('/userdata/roms/windows/missing.txt')).toBeNull();
		await box.write('/userdata/roms/windows/empty.txt', Buffer.alloc(0));
		expect((await box.read('/userdata/roms/windows/empty.txt'))?.length).toBe(0);

		await box.mkdirs('/userdata/roms/windows/Night Harbour.pc/bin/deep');
		await box.mkdirs('/userdata/roms/windows/Night Harbour.pc/bin');
		expect(await box.list('/userdata/roms/windows')).toEqual(['Night Harbour.pc', 'empty.txt', 'note.txt']);
		expect(await box.list('/userdata/roms/windows/Night Harbour.pc/bin')).toEqual(['deep']);
		expect(await box.list('/userdata/roms/dos')).toEqual([]);
		expect(await box.list('/userdata/roms/snes')).toEqual([]);
		await expect(box.write('/../../outside.txt', Buffer.from('x'))).resolves.toBeUndefined();
		expect(await readFile(join(fake.root, 'outside.txt'), 'utf8')).toBe('x');
	});

	it('tells a folder from a file', async () => {
		const box = await open();
		await box.mkdirs('/userdata/roms/windows/Night Harbour.pc.part');
		await box.write('/userdata/roms/windows/Loose.pc.part', Buffer.from('a file'));
		expect(await box.isDir('/userdata/roms/windows/Night Harbour.pc.part')).toBe(true);
		expect(await box.isDir('/userdata/roms/windows/Loose.pc.part')).toBe(false);
		expect(await box.isDir('/userdata/roms/windows/Missing.pc.part')).toBe(false);
	});

	it('puts a stream into a file on the box', async () => {
		const body = Buffer.alloc(300_000);
		for (let i = 0; i < body.length; i++) body[i] = i % 251;
		const chunks: Buffer[] = [];
		for (let at = 0; at < body.length; at += 32 * 1024) chunks.push(body.subarray(at, at + 32 * 1024));
		const box = await open();
		const dir = `/userdata/roms/windows/Night Harbour.pc.part/${INSTALLERS}`;
		await box.mkdirs(dir);
		await box.put(`${dir}/setup.exe`, Readable.from(chunks), { signal: new AbortController().signal });
		expect((await box.read(`${dir}/setup.exe`))?.equals(body)).toBe(true);
	});

	it('stops a put when told to', async () => {
		const box = await open();
		const dir = `/userdata/roms/windows/Night Harbour.pc.part/${INSTALLERS}`;
		await box.mkdirs(dir);
		const stop = new AbortController();
		let reads = 0;
		// One chunk, then nothing and no end; told to stop once the first chunk is taken.
		const endless = new Readable({
			read() {
				if (reads++ === 0) this.push(Buffer.alloc(32 * 1024, 7));
				else stop.abort();
			}
		});
		await expect(box.put(`${dir}/setup.exe`, endless, { signal: stop.signal })).rejects.toMatchObject({ name: 'AbortError' });
		// What was written stays.
		expect(await box.list(dir)).toEqual(['setup.exe']);
	});

	it('runs a long command and ends it on the box when stopped', async () => {
		const box = await open();
		const part = '/userdata/roms/windows/Night Harbour.pc.part';
		const installer = `${part}/${INSTALLERS}/setup.exe`;
		await box.mkdirs(`${part}/${INSTALLERS}`);
		await box.write(installer, Buffer.from(JSON.stringify({ delayMs: 1500, files: { 'late.exe': 'x' } })));
		const stop = new AbortController();
		setTimeout(() => stop.abort(), 200);
		await expect(box.run(unpackCommand(installer, part), { signal: stop.signal })).rejects.toMatchObject({ name: 'AbortError' });
		expect(fake.unpacked).toEqual([installer]);
		await until(() => fake.unpacking === 0, 500);
		await new Promise((resolve) => setTimeout(resolve, 2000));
		expect(await box.list(part)).not.toContain('late.exe');
	});

	/** Each command's channel of `run`, handed to `each` as it opens; ssh2 is put back after the test. */
	function onChannel(each: (channel: ClientChannel) => void): void {
		const exec = Client.prototype.exec as (this: Client, command: string, options: ExecOptions, callback: ClientCallback) => Client;
		Client.prototype.exec = function (this: Client, command: string, options: ExecOptions, callback: ClientCallback) {
			return exec.call(this, command, options, (error, channel) => {
				if (channel) each(channel);
				callback(error, channel);
			});
		} as typeof Client.prototype.exec;
		cleanup.push(async () => {
			Client.prototype.exec = exec as typeof Client.prototype.exec;
		});
	}

	it('rejects a stopped command only once the box has closed its channel', async () => {
		// The box closes the channel once the command has ended there.
		const order: string[] = [];
		onChannel((channel) => channel.once('close', () => order.push('close')));
		const box = await open();
		const part = '/userdata/roms/windows/Night Harbour.pc.part';
		const installer = `${part}/${INSTALLERS}/setup.exe`;
		await box.mkdirs(`${part}/${INSTALLERS}`);
		await box.write(installer, Buffer.from(JSON.stringify({ delayMs: 1500, files: { 'late.exe': 'x' } })));
		const stop = new AbortController();
		const running = box.run(unpackCommand(installer, part), { signal: stop.signal }).catch((e: unknown) => {
			order.push('rejected');
			return e;
		});
		await until(() => fake.unpacking === 1);
		stop.abort();
		expect(await running).toMatchObject({ name: 'AbortError' });
		await until(() => order.length === 2);
		expect(order).toEqual(['close', 'rejected']);
	});

	it('rejects a stopped command after 5 seconds when the channel never closes', async () => {
		// The close is never sent, so the box never answers it: as a box that went away while the connection holds.
		onChannel((channel) => {
			channel.close = () => {};
		});
		const box = await open();
		const part = '/userdata/roms/windows/Night Harbour.pc.part';
		const installer = `${part}/${INSTALLERS}/setup.exe`;
		await box.mkdirs(`${part}/${INSTALLERS}`);
		await box.write(installer, Buffer.from(JSON.stringify({ delayMs: 8000, files: { 'late.exe': 'x' } })));
		const stop = new AbortController();
		const running = box.run(unpackCommand(installer, part), { signal: stop.signal }).catch((e: unknown) => e);
		await until(() => fake.unpacking === 1);
		const stopped = Date.now();
		stop.abort();
		expect(await running).toMatchObject({ name: 'AbortError' });
		expect(Date.now() - stopped).toBeGreaterThanOrEqual(4990);
		expect(Date.now() - stopped).toBeLessThan(6000);
	}, 10_000);

	it('says the box went away when the connection ends during a long command', async () => {
		const box = await open();
		const part = '/userdata/roms/windows/Night Harbour.pc.part';
		const installer = `${part}/${INSTALLERS}/setup.exe`;
		await box.mkdirs(`${part}/${INSTALLERS}`);
		await box.write(installer, Buffer.from(JSON.stringify({ delayMs: 1500, files: { 'late.exe': 'x' } })));
		const running = box.run(unpackCommand(installer, part), { signal: new AbortController().signal }).catch((e: unknown) => e);
		await until(() => fake.unpacking === 1);
		await fake.off();
		expect(await running).toBeInstanceOf(BoxDown);
		// The box hangs up on it too.
		await until(() => fake.unpacking === 0, 500);
	});

	it('renames and removes a folder', async () => {
		const box = await open();
		await box.mkdirs('/userdata/roms/windows/Night Harbour.pc.part/bin');
		await box.write('/userdata/roms/windows/Night Harbour.pc.part/canvas.json', Buffer.from('{}'));
		await box.rename('/userdata/roms/windows/Night Harbour.pc.part', '/userdata/roms/windows/Night Harbour.pc');
		expect(await box.list('/userdata/roms/windows')).toEqual(['Night Harbour.pc']);
		expect(await box.list('/userdata/roms/windows/Night Harbour.pc')).toEqual(['bin', 'canvas.json']);

		// As OpenSSH's sftp-server, a folder is not renamed onto one that exists.
		await box.mkdirs('/userdata/roms/windows/Night Harbour.pc.part');
		await expect(box.rename('/userdata/roms/windows/Night Harbour.pc.part', '/userdata/roms/windows/Night Harbour.pc')).rejects.toThrow();

		const removed = await box.exec(removeCommand('/userdata/roms/windows/Night Harbour.pc'));
		expect(removed.code).toBe(0);
		await box.exec(removeCommand('/userdata/roms/windows/Night Harbour.pc.part'));
		expect(await box.list('/userdata/roms/windows')).toEqual([]);
	});

	it('runs the fixed commands', async () => {
		const box = await open();
		const version = await box.exec(COMMANDS.version);
		expect(version).toEqual({ code: 0, stdout: '43.1 2026/05/29 00:00\n', stderr: '' });
		expect(parseDf((await box.exec(COMMANDS.df)).stdout)).toBe(fake.freeBytes);
		expect(macFor((await box.exec(COMMANDS.ip)).stdout, '10.0.0.21')).toBe(fake.mac);
		expect(parsePrimary((await box.exec(COMMANDS.primary)).stdout)).toBe('HDMI-1');
		fake.primary = null;
		expect(parsePrimary((await box.exec(COMMANDS.primary)).stdout)).toBeNull();
		expect((await box.exec('ls /userdata')).code).toBe(127);
		expect((await box.exec(`${COMMANDS.version}; reboot`)).code).toBe(127);
		expect((await box.exec("rm -rf -- '/userdata'")).code).toBe(127);

		// The shutdown turns the box off; a magic packet for its MAC turns it on again.
		expect((await box.exec(COMMANDS.shutdown)).code).toBe(11);
		expect(fake.shutdowns).toBe(1);
		await until(() => !fake.isOn());
		await sendWake('02:00:00:00:00:01', '127.0.0.1', `127.0.0.1:${fake.wakePort}`);
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(fake.isOn()).toBe(false);
		await sendWake(fake.mac, '127.0.0.1', `127.0.0.1:${fake.wakePort}`);
		await until(() => fake.isOn());
		expect((await open()).hostKey).toBe(fake.fingerprint);
	});

	it('answers the commands of the unpacking', async () => {
		await fake.close();
		fake = await startFakeBatocera({ control: true });
		const box = await open();
		const part = "/userdata/roms/windows/Night Harbour's.pc.part";
		const installer = `${part}/${INSTALLERS}/setup.exe`;
		const setup = Buffer.from(JSON.stringify({ files: { 'game.exe': 'x', '__support/app/game.ini': 'y' } }));
		await box.mkdirs(`${part}/${INSTALLERS}`);
		await box.write(installer, setup);

		expect((await box.exec(unpackCommand(installer, part))).code).toBe(0);
		expect(await box.list(part)).toContain('game.exe');
		expect(parseKib((await box.exec(bytesCommand(part))).stdout)).toBeGreaterThanOrEqual(setup.length + 2);
		expect(parseFiles((await box.exec(filesCommand(part))).stdout, part)).toEqual(['.canvas-installers/setup.exe', '__support/app/game.ini', 'game.exe']);
		expect((await box.exec(supportCommand(part))).code).toBe(0);
		expect((await box.read(`${part}/game.ini`))?.toString()).toBe('y');
		expect((await box.exec(removeInPartCommand(part, INSTALLERS))).code).toBe(0);
		expect(await box.list(part)).toEqual(['__support', 'game.exe', 'game.ini']);
		expect(fake.unpacked).toEqual([installer]);

		expect(await box.exec(COMMANDS.innoextract)).toEqual({ code: 0, stdout: '/usr/bin/innoextract\n', stderr: '' });
		const set = await fetch(fake.control ?? '', { method: 'POST', body: JSON.stringify({ innoextract: false }) });
		expect(set.status).toBe(204);
		expect(await box.exec(COMMANDS.innoextract)).toEqual({ code: 1, stdout: '', stderr: '' });
	});

	it('talks to EmulationStation through the box', async () => {
		const box = await open();
		const caps = await box.es('GET', '/caps');
		expect(caps.status).toBe(200);
		expect(JSON.parse(caps.body)).toHaveProperty('Version');
		expect(JSON.parse((await box.es('GET', '/isIdle')).body)).toEqual([true]);
		fake.es.idle = false;
		expect(JSON.parse((await box.es('GET', '/isIdle')).body)).toEqual([false]);

		expect(await box.es('GET', '/runningGame')).toEqual({ status: 201, body: '{"msg":"NO GAME RUNNING"}' });
		fake.es.running = 'Other Game';
		expect(await box.es('GET', '/runningGame')).toMatchObject({ status: 200 });
		expect(JSON.parse((await box.es('GET', '/runningGame')).body)).toEqual({ name: 'Other Game' });
		expect((await box.es('GET', '/emukill')).status).toBe(200);
		expect(fake.es).toMatchObject({ running: null, killed: 1 });

		// 43.1's /addgames adds nothing; a game joins the list at the reload after its folder came.
		const xml = '<?xml version="1.0"?>\n<gameList><game><path>./Night Harbour.pc</path><desc>A harbour.</desc></game></gameList>\n';
		expect((await box.es('POST', '/addgames/windows', xml)).status).toBe(204);
		expect(fake.es.added).toEqual([{ system: 'windows', xml }]);
		const id = '9df9dce506cfc4eb603451d8b1ae412d';
		const at = `/systems/windows/games/${id}`;
		expect((await box.es('GET', at)).status).toBe(404);
		await mkdir(join(fake.root, 'userdata/roms/windows/Night Harbour.pc'), { recursive: true });
		expect((await box.es('GET', '/reloadgames')).status).toBe(200);
		expect(fake.es.reloads).toBe(1);
		await until(() => (fake.es.games.windows ?? []).length > 0);
		const games = await box.es('GET', '/systems/windows/games');
		expect(JSON.parse(games.body)).toEqual([{ id, path: '/userdata/roms/windows/Night Harbour.pc', desc: '' }]);
		expect(JSON.parse((await box.es('GET', '/systems/dos/games')).body)).toEqual([]);

		// The details by their metadata keys, and the pictures where EmulationStation keeps its own.
		expect(await box.es('POST', at, JSON.stringify({ name: 'Night Harbour', desc: 'A harbour & a <light>.' }), 'application/json')).toEqual({ status: 200, body: '' });
		expect(await box.es('POST', `${at}/media/fanart`, Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')).toEqual({ status: 200, body: '' });
		expect(JSON.parse((await box.es('GET', at)).body)).toEqual({
			id,
			path: '/userdata/roms/windows/Night Harbour.pc',
			name: 'Night Harbour',
			desc: 'A harbour & a <light>.',
			fanart: '/userdata/roms/windows/images/Night Harbour-fanart.jpg'
		});
		expect(await readFile(join(fake.root, 'userdata/roms/windows/images/Night Harbour-fanart.jpg'))).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
		expect(fake.es.media).toEqual([{ system: 'windows', id, type: 'fanart', contentType: 'image/jpeg' }]);

		expect((await box.es('POST', '/launch', '/userdata/roms/windows/Night Harbour.pc')).status).toBe(200);
		expect(fake.es.launched).toEqual(['/userdata/roms/windows/Night Harbour.pc']);
		expect((await box.es('GET', '/nothing')).status).toBe(404);
	});

	it("reads EmulationStation's 204 with a body as 204, not as an error", async () => {
		const box = await open();
		// 43.1's /addgames answers so, with `Connection: close`: Node's strict parser calls the body "Data after `Connection: close`".
		expect(await box.es('POST', '/addgames/dos', './Cellar Quest.pc')).toEqual({ status: 204, body: '' });
		// The connection is not left in a bad way: the next call is answered.
		expect((await box.es('GET', '/caps')).status).toBe(200);
	});

	it('says when EmulationStation does not answer', async () => {
		const box = await open();
		fake.es.up = false;
		await expect(box.es('GET', '/caps')).rejects.toThrow();
		fake.es.up = true;
		expect((await box.es('GET', '/caps')).status).toBe(200);
	});
});
