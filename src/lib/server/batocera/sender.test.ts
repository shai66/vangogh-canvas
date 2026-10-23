import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline, Readable, Transform } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobView } from '../../batocera';
import type { FileTarget } from '../index-types';
import { createLogger } from '../log';
import { batoceraLibrary } from '../testing/batocera-library';
import { startFakeBatocera, type FakeBatocera } from '../testing/fake-batocera';
import { openBox, portOpen, type Box, type BoxLogin } from './box';
import { removeCommand } from './commands';
import { markerJson, type Marker } from './folder';
import type { ListDetails } from './gamelist';
import { readLook } from './look';
import { Sender, type SendRequest, type SenderDeps } from './sender';
import { sendWake } from './wake';

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
/** The poster and the backdrop of `batoceraLibrary()`. */
const POSTER = '6'.repeat(64);
const BACKDROP = '7'.repeat(64);

const lib = batoceraLibrary();
const md5 = (body: Buffer | string) => createHash('md5').update(body).digest('hex');

const details = (name: string): ListDetails => ({
	name,
	description: `${name}, a quiet game.`,
	releaseYear: 1999,
	developers: ['Tidewater Works'],
	publisher: 'Lantern Press',
	genres: ['Adventure']
});

const harbourFiles: FileTarget[] = [
	{ productId: '3001', downloadType: 'installer', manualUrl: '/downloads/night_harbour/en1installer0', filename: 'setup_night_harbour_1.2.exe' },
	{
		productId: '3001',
		downloadType: 'downloadable-content',
		manualUrl: '/downloads/night_harbour_lighthouse/en1installer0',
		filename: 'setup_night_harbour_lighthouse_1.2.exe'
	}
];

/** Night Harbour (3001), a Windows game with its DLC, 1 MiB each by the detail. */
const harbour: SendRequest = {
	gameId: '3001',
	name: 'Night Harbour',
	system: 'windows',
	version: '1.2',
	size: 2 * MiB,
	files: harbourFiles,
	details: details('Night Harbour'),
	poster: POSTER,
	backdrop: BACKDROP
};

/** Cellar Quest (3003), a DOS game without a backdrop. */
const cellar: SendRequest = {
	gameId: '3003',
	name: 'Cellar Quest',
	system: 'dos',
	version: '1.0',
	size: MiB,
	files: [{ productId: '3003', downloadType: 'installer', manualUrl: '/downloads/cellar_quest/en1installer0', filename: 'setup_cellar_quest_1.0.exe' }],
	details: details('Cellar Quest'),
	poster: POSTER,
	backdrop: null
};

const HARBOUR = 'userdata/roms/windows/Night Harbour.pc';
const CELLAR = 'userdata/roms/dos/Cellar Quest.pc';
/** EmulationStation's ids of the two games: the MD5 of their whole paths. */
const HARBOUR_ID = md5(`/${HARBOUR}`);
const CELLAR_ID = md5(`/${CELLAR}`);
/** The installers of the archive, as fake innoextract reads them. */
const HARBOUR_SETUP = lib.files['3001/installer/downloads/night_harbour/en1installer0'].body.toString('utf8');
const CELLAR_SETUP = lib.files['3003/installer/downloads/cellar_quest/en1installer0'].body.toString('utf8');

let fake: FakeBatocera;
let logged: string[];
let senders: Sender[];
/** The installers fetched, by file name, in order. */
let fetched: string[];
/** What the sender told at the end of each queue. */
let ended: { woke: boolean; failed: boolean; gameId: string }[];
let looks: number;
/** Installers that are not the archive's, by file name. */
let bodies: Record<string, string>;
/** Called, and waited for when it gives a promise, as each piece of an installer goes to the box. */
let onCopy: (() => unknown) | null;
/** Called before each installer is fetched. */
let beforeFetch: ((target: FileTarget) => Promise<void>) | null;

beforeEach(async () => {
	fake = await startFakeBatocera();
	logged = [];
	senders = [];
	fetched = [];
	ended = [];
	looks = 0;
	bodies = {};
	onCopy = null;
	beforeFetch = null;
});

afterEach(async () => {
	await until(() => senders.every((s) => s.running() === 0));
	await fake.close();
});

async function until(check: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
	const end = Date.now() + ms;
	while (!(await check())) {
		if (Date.now() > end) throw new Error(`timed out. The log:\n${logged.join('\n')}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

const login = (): BoxLogin => ({ address: '127.0.0.1', port: fake.port, user: fake.user, password: fake.password, hostKey: fake.fingerprint });
const onBox = (path: string) => existsSync(join(fake.root, path));
const text = (path: string) => readFile(join(fake.root, path), 'utf8');
/** The game's entry in EmulationStation's list. */
const entryOf = (path: string) => Object.values(fake.es.games).flat().find((g) => g.path === `/${path}`);

/** Writes a file on the fake box, the folders above it too. */
async function put(path: string, body: string): Promise<void> {
	const file = join(fake.root, path);
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, body);
}

/** A look as the service makes one: Canvas's leftovers removed, but never what the running job holds. */
async function lookAt(box: Box, sender: Sender): Promise<void> {
	const held = sender.holds();
	for (const path of (await readLook(box)).leftovers) if (!held.includes(path)) await box.exec(removeCommand(path));
}

/** A stream on its way to the box, with `each` run, and waited for when it gives a promise, as each piece passes. */
function pieces(from: Readable, each: () => unknown): Readable {
	const watch = new Transform({
		transform(chunk: Buffer, _encoding, done) {
			Promise.resolve(each()).then(() => done(null, chunk), done);
		}
	});
	return pipeline(from, watch, () => {});
}

/** The box with its copy watched: `onCopy` runs as each piece of an installer goes to the box. */
async function watchedBox(l: BoxLogin, o?: { timeoutMs?: number }): Promise<Box> {
	const box = await openBox(l, o);
	return { ...box, put: (file, from, p) => box.put(file, pieces(from, () => onCopy?.()), p) };
}

async function make(over: Partial<SenderDeps> = {}): Promise<Sender> {
	const sender: Sender = new Sender({
		login,
		wakeOn: () => false,
		mac: () => fake.mac,
		address: () => '127.0.0.1',
		openFile: async (target) => {
			fetched.push(target.filename);
			await beforeFetch?.(target);
			const body = bodies[target.filename] ?? lib.files[`${target.productId}/${target.downloadType}/${target.manualUrl.slice(1)}`]?.body;
			if (body === undefined) throw new Error('not in the archive');
			return Readable.from([Buffer.from(body)]);
		},
		checksums: async (productId) => lib.checksums?.[productId] ?? {},
		image: async (imageId) => lib.images[imageId]?.body ?? null,
		open: watchedBox,
		portOpen,
		wake: async () => {},
		idlePollMs: 50,
		log: createLogger((line) => logged.push(line)),
		version: '0.12.0',
		onLook: async (box) => {
			looks++;
			await lookAt(box, sender);
		},
		onEnd: (o) => ended.push(o),
		...over
	});
	senders.push(sender);
	return sender;
}

/** The job of the game once it has ended, sent or failed. */
async function finished(sender: Sender, gameId: string): Promise<JobView> {
	await until(() => ['done', 'failed'].includes(sender.jobOf(gameId)?.state ?? ''));
	return sender.jobOf(gameId)!;
}

describe('Sender', () => {
	it('sends a Windows game: copy the installers, unpack on the box, put in place, reload, details', async () => {
		// The job as each put of an installer, each unpacking and each rename on the box begins.
		const seen: JobView[] = [];
		const sender: Sender = await make({
			open: async (l, o) => {
				const box = await watchedBox(l, o);
				const look = () => void seen.push(sender.jobOf('3001')!);
				return {
					...box,
					put: (file, from, p) => {
						look();
						return box.put(file, from, p);
					},
					run: (command, r) => {
						look();
						return box.run(command, r);
					},
					rename: (from, to) => {
						look();
						return box.rename(from, to);
					}
				};
			}
		});
		const job = sender.send(harbour);
		expect(job).toMatchObject({ state: 'running', ahead: 0, steps: 3, reason: null, endedAt: null });

		const done = await finished(sender, '3001');
		expect(done).toMatchObject({ id: job.id, state: 'done', step: 'reload', stepNumber: 3, steps: 3, overall: 1, reason: null, listLater: false, waking: 'no' });
		expect(Date.parse(done.endedAt ?? '')).not.toBeNaN();
		// The three steps, in order, each said with its number.
		expect(seen.map((v) => v.step).filter((step, i, all) => step !== all[i - 1])).toEqual(['copy', 'unpack', 'reload']);
		for (const view of seen) expect(view).toMatchObject({ state: 'running', stepNumber: ['copy', 'unpack', 'reload'].indexOf(view.step) + 1, steps: 3 });
		// While it unpacked, the job was part of the way through.
		const unpacking = seen.find((v) => v.step === 'unpack')!;
		expect(unpacking.overall).toBeGreaterThan(0);
		expect(unpacking.overall).toBeLessThan(1);
		// The game's installer first, then its DLC's, each from the part's own folder for them.
		expect(fake.unpacked).toEqual([
			`/${HARBOUR}.part/.canvas-installers/setup_night_harbour_1.2.exe`,
			`/${HARBOUR}.part/.canvas-installers/setup_night_harbour_lighthouse_1.2.exe`
		]);

		expect(await text(`${HARBOUR}/autorun.cmd`)).toBe('DIR=bin\nCMD="Harbour.exe"\n');
		expect(JSON.parse(await text(`${HARBOUR}/canvas.json`))).toEqual({
			gameId: '3001',
			system: 'windows',
			files: ['setup_night_harbour_1.2.exe', 'setup_night_harbour_lighthouse_1.2.exe'],
			version: '1.2',
			sentAt: expect.any(String),
			canvas: '0.12.0'
		});
		expect(await text(`${HARBOUR}/dlc/lighthouse.pak`)).toBe('lighthouse');
		expect(await text(`${HARBOUR}/bin/Harbour.exe`)).toBe('harbour');
		// The installers are gone from the box, and nothing is left beside the folder.
		expect(onBox(`${HARBOUR}/.canvas-installers`)).toBe(false);
		expect(onBox(`${HARBOUR}.part`)).toBe(false);
		expect(onBox(`${HARBOUR}.old`)).toBe(false);

		expect(fake.es.reloads).toBe(1);
		// The details and the pictures through the game's own routes, which 43.1 takes; never /addgames, which it does not.
		expect(fake.es.added).toEqual([]);
		expect(fake.es.written.map((w) => [w.system, w.id])).toEqual([['windows', HARBOUR_ID]]);
		expect(entryOf(HARBOUR)).toEqual({
			path: `/${HARBOUR}`,
			name: 'Night Harbour',
			desc: 'Night Harbour, a quiet game.',
			releasedate: '19990101T000000',
			developer: 'Tidewater Works',
			publisher: 'Lantern Press',
			genre: 'Adventure',
			image: '/userdata/roms/windows/images/Night Harbour-image.jpg',
			thumbnail: '/userdata/roms/windows/images/Night Harbour-thumb.jpg',
			fanart: '/userdata/roms/windows/images/Night Harbour-fanart.jpg'
		});
		expect(fake.es.media.map((m) => [m.type, m.contentType])).toEqual([
			['image', 'image/jpeg'],
			['thumbnail', 'image/jpeg'],
			['fanart', 'image/jpeg']
		]);
		expect(await text('userdata/roms/windows/images/Night Harbour-image.jpg')).toBe('image');
		expect(await text('userdata/roms/windows/images/Night Harbour-fanart.jpg')).toBe('image');
		// The pictures are in EmulationStation's place, not in the game's folder.
		expect(onBox(`${HARBOUR}/canvas-media`)).toBe(false);
		// The program chosen, at every send.
		expect(logged.some((line) => line.includes('INFO') && line.includes('Harbour.exe') && line.includes('DIR=bin'))).toBe(true);
		expect(looks).toBe(1);
		expect(ended).toEqual([{ woke: false, failed: false, gameId: '3001' }]);
		expect(sender.running()).toBe(0);
	});

	it("sends a DOS game to dos with dosbox.bat and without GOG's DOSBOX folder", async () => {
		const sender = await make();
		sender.send(cellar);
		expect(await finished(sender, '3003')).toMatchObject({ state: 'done' });

		expect(await text(`${CELLAR}/dosbox.bat`)).toBe('imgmount d "C:\\cellar.cue" -t iso\r\nc:\r\ncd CELLAR\r\ncellar.exe\r\n');
		expect(await text(`${CELLAR}/CELLAR/cellar.exe`)).toBe('cellar');
		expect(onBox(`${CELLAR}/DOSBOX`)).toBe(false);
		expect(onBox(`${CELLAR}/autorun.cmd`)).toBe(false);
		expect(JSON.parse(await text(`${CELLAR}/canvas.json`))).toMatchObject({ gameId: '3003', system: 'dos', files: ['setup_cellar_quest_1.0.exe'] });
		expect(fake.es.written.map((w) => [w.system, w.id])).toEqual([['dos', CELLAR_ID]]);
		// No backdrop, so no fanart.
		expect(fake.es.media.map((m) => [m.system, m.type])).toEqual([
			['dos', 'image'],
			['dos', 'thumbnail']
		]);
		expect(entryOf(CELLAR)).toMatchObject({ name: 'Cellar Quest', image: '/userdata/roms/dos/images/Cellar Quest-image.jpg' });
		expect(entryOf(CELLAR)).not.toHaveProperty('fanart');
		expect(onBox(`${CELLAR}/canvas-media`)).toBe(false);
		expect(logged.some((line) => line.includes('INFO') && line.includes('dosbox.bat'))).toBe(true);
	});

	it("copies GOG's support files over the game folder before the program is written, as GOG's installer does", async () => {
		const sender = await make({ checksums: async () => ({}) });
		const installer = (key: string) => JSON.parse(lib.files[key].body.toString('utf8')) as { files: Record<string, string> };
		// The DOSBox configurations only in `__support/app`, and an older one of them at the root.
		const { 'dosboxcellar.conf': main, 'dosboxcellar_single.conf': single, ...rest } = installer('3003/installer/downloads/cellar_quest/en1installer0').files;
		bodies['setup_cellar_quest_1.0.exe'] = JSON.stringify({
			files: {
				...rest,
				'dosboxcellar_single.conf': '[autoexec]\r\nold.exe\r\n',
				'__support/app/dosboxcellar.conf': main,
				'__support/app/dosboxcellar_single.conf': single,
				'__support/app/saves/slot0.sav': 'slot'
			}
		});
		// A Windows game alike.
		const harbourGame = installer('3001/installer/downloads/night_harbour/en1installer0').files;
		bodies['setup_night_harbour_1.2.exe'] = JSON.stringify({ files: { ...harbourGame, '__support/app/bin/harbour.ini': 'support' } });
		sender.send(cellar);
		sender.send(harbour);
		expect(await finished(sender, '3003')).toMatchObject({ state: 'done' });
		expect(await finished(sender, '3001')).toMatchObject({ state: 'done' });

		expect(await text(`${CELLAR}/dosbox.bat`)).toBe('imgmount d "C:\\cellar.cue" -t iso\r\nc:\r\ncd CELLAR\r\ncellar.exe\r\n');
		expect(await text(`${CELLAR}/dosboxcellar_single.conf`)).toBe(single);
		expect(await text(`${CELLAR}/saves/slot0.sav`)).toBe('slot');
		expect(await text(`${HARBOUR}/bin/harbour.ini`)).toBe('support');
		expect(await text(`${HARBOUR}/autorun.cmd`)).toBe('DIR=bin\nCMD="Harbour.exe"\n');
	});

	it('never shows a half game: the copy goes to .part', async () => {
		const sender = await make();
		const seen: { part: boolean; pc: boolean }[] = [];
		onCopy = () => seen.push({ part: onBox(`${CELLAR}.part/canvas.json`), pc: onBox(CELLAR) });
		sender.send(cellar);
		expect(await finished(sender, '3003')).toMatchObject({ state: 'done' });
		expect(seen.length).toBeGreaterThan(0);
		expect(seen.every((s) => s.part && !s.pc)).toBe(true);
		expect(onBox(`${CELLAR}.part`)).toBe(false);
		expect(onBox(`${CELLAR}/canvas.json`)).toBe(true);
	});

	it('writes the marker into .part before the first installer', async () => {
		let atFirstPut: { part: string[]; installers: string[]; marker: unknown } | null = null;
		const sender = await make({
			open: async (l, o) => {
				const box = await watchedBox(l, o);
				return {
					...box,
					put: async (file, from, p) => {
						atFirstPut ??= {
							part: (await readdir(join(fake.root, `${CELLAR}.part`))).sort(),
							installers: await readdir(join(fake.root, `${CELLAR}.part/.canvas-installers`)),
							marker: JSON.parse(await text(`${CELLAR}.part/canvas.json`))
						};
						return box.put(file, from, p);
					}
				};
			}
		});
		sender.send(cellar);
		expect(await finished(sender, '3003')).toMatchObject({ state: 'done' });
		// The marker, and the installers' folder still empty: no other file. It is the marker the game keeps, written once.
		const marker: unknown = JSON.parse(await text(`${CELLAR}/canvas.json`));
		expect(marker).toMatchObject({ gameId: '3003', system: 'dos' });
		expect(atFirstPut).toEqual({ part: ['.canvas-installers', 'canvas.json'], installers: [], marker });
	});

	it('sends again: replaces the folder, and no .old is left', async () => {
		const sender = await make();
		const first = sender.send(harbour);
		await finished(sender, '3001');
		await put(`${HARBOUR}/only-in-the-old.txt`, 'old');

		const again = sender.send(harbour);
		expect(again.id).not.toBe(first.id);
		expect(await finished(sender, '3001')).toMatchObject({ id: again.id, state: 'done' });
		expect(onBox(`${HARBOUR}/only-in-the-old.txt`)).toBe(false);
		expect(onBox(`${HARBOUR}.old`)).toBe(false);
		expect(await text(`${HARBOUR}/autorun.cmd`)).toBe('DIR=bin\nCMD="Harbour.exe"\n');
		expect(fake.es.reloads).toBe(2);
		// The list has its details and pictures since the first send.
		expect(fake.es.written).toHaveLength(1);
		expect(fake.es.media).toHaveLength(3);
	});

	it("keeps the game's padto.keys when it is sent again", async () => {
		const sender = await make();
		sender.send(harbour);
		await finished(sender, '3001');
		await put(`${HARBOUR}/padto.keys`, '{"actions_player1":[]}');

		sender.send(harbour);
		expect(await finished(sender, '3001')).toMatchObject({ state: 'done' });
		expect(await text(`${HARBOUR}/padto.keys`)).toBe('{"actions_player1":[]}');
		expect(onBox(`${HARBOUR}.old`)).toBe(false);
	});

	it('writes no padto.keys for a game sent again without one', async () => {
		const sender = await make();
		sender.send(harbour);
		await finished(sender, '3001');
		sender.send(harbour);
		expect(await finished(sender, '3001')).toMatchObject({ state: 'done' });
		expect(onBox(`${HARBOUR}/padto.keys`)).toBe(false);
	});

	it('answers the same job when a game is asked for twice', async () => {
		const sender = await make();
		const one = sender.send(harbour);
		const two = sender.send(harbour);
		expect(two.id).toBe(one.id);
		expect(sender.running()).toBe(1);
		await finished(sender, '3001');
		expect(fetched).toEqual(['setup_night_harbour_1.2.exe', 'setup_night_harbour_lighthouse_1.2.exe']);
	});

	it('runs one job at a time, in order', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		let firstWhenSecondStarted: string | undefined;
		const sender = await make();
		beforeFetch = async (target) => {
			if (target.productId === '3001') await gate;
			else firstWhenSecondStarted ??= sender.jobOf('3001')?.state;
		};
		const first = sender.send(harbour);
		const second = sender.send(cellar);
		expect(first).toMatchObject({ state: 'running', ahead: 0 });
		expect(second).toMatchObject({ state: 'waiting', ahead: 1, overall: 0, minutesLeft: null });
		await until(() => fetched.length > 0);
		expect(sender.jobOf('3003')).toMatchObject({ state: 'waiting', ahead: 1 });
		expect(sender.running()).toBe(2);

		release();
		expect(await finished(sender, '3003')).toMatchObject({ state: 'done', ahead: 0 });
		expect(firstWhenSecondStarted).toBe('done');
		expect(fetched).toEqual(['setup_night_harbour_1.2.exe', 'setup_night_harbour_lighthouse_1.2.exe', 'setup_cellar_quest_1.0.exe']);
		// Told once, when the queue was empty.
		expect(ended).toEqual([{ woke: false, failed: false, gameId: '3003' }]);
	});

	it('stops a running job and leaves nothing on the box', async () => {
		// The job cleans up itself, without the look it ends with.
		const sender = await make({ onLook: async () => void looks++ });
		// A job that waits is gone at once.
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		beforeFetch = (target) => (target.productId === '3001' ? gate : Promise.resolve());
		sender.send(harbour);
		const waiting = sender.send(cellar);
		expect(sender.stop(waiting.id)).toBe(true);
		expect(sender.jobOf('3003')).toBeNull();
		release();
		await finished(sender, '3001');
		await until(() => sender.running() === 0);

		// A job that runs is broken off during its copy.
		let job: JobView | null = null;
		let stopped = false;
		onCopy = () => {
			if (job && !stopped) stopped = sender.stop(job.id);
		};
		job = sender.send(cellar);
		await until(() => sender.running() === 0);
		expect(stopped).toBe(true);
		expect(sender.jobOf('3003')).toBeNull();
		expect(onBox(`${CELLAR}.part`)).toBe(false);
		expect(onBox(CELLAR)).toBe(false);
		expect(sender.holds()).toEqual([]);
		// Gone: there is nothing to stop any more.
		expect(sender.stop(job.id)).toBe(false);
	});

	it('stops during the unpacking, ends innoextract on the box and leaves nothing', async () => {
		// innoextract writes the game only after 2 seconds.
		bodies['setup_cellar_quest_1.0.exe'] = JSON.stringify({ ...JSON.parse(CELLAR_SETUP), delayMs: 2000 });
		// The connection stays open after the job, so that only the stop can end innoextract on the box.
		const opened: Box[] = [];
		const sender = await make({
			checksums: async () => ({}),
			open: async (l, o) => {
				const box = await watchedBox(l, o);
				opened.push(box);
				return { ...box, close: () => {} };
			}
		});
		try {
			const job = sender.send(cellar);
			await until(() => sender.jobOf('3003')?.step === 'unpack' && fake.unpacking === 1);
			// Measured against the installers' bytes.
			expect(sender.jobOf('3003')).toMatchObject({ stepNumber: 2, steps: 3, bytesAll: Buffer.byteLength(bodies['setup_cellar_quest_1.0.exe']) });
			// Once innoextract has read its installer and waits.
			await new Promise((resolve) => setTimeout(resolve, 400));
			expect(sender.stop(job.id)).toBe(true);
			await until(() => sender.running() === 0 && fake.unpacking === 0, 1000);
			expect(sender.jobOf('3003')).toBeNull();
			expect(onBox(`${CELLAR}.part`)).toBe(false);
			// Past the time innoextract would have written the game: it was ended, so nothing came back.
			await new Promise((resolve) => setTimeout(resolve, 2200));
			expect(onBox(`${CELLAR}.part`)).toBe(false);
			expect(onBox(CELLAR)).toBe(false);
		} finally {
			for (const box of opened) box.close();
		}
	});

	it('removes the part once more a second later when the first removal fails', async () => {
		const removals: number[] = [];
		// The job cleans up itself, without the look it ends with.
		const sender = await make({
			checksums: async () => ({}),
			onLook: async () => void looks++,
			open: async (l, o) => {
				const box = await watchedBox(l, o);
				return {
					...box,
					exec: (command) => {
						if (command !== removeCommand(`/${CELLAR}.part`)) return box.exec(command);
						removals.push(Date.now());
						// The first fails as `rm -rf` does when a dying innoextract wrote into a folder it had read.
						if (removals.length === 1) return Promise.resolve({ code: 1, stdout: '', stderr: `rm: cannot remove '/${CELLAR}.part/CELLAR': Directory not empty\n` });
						return box.exec(command);
					}
				};
			}
		});
		bodies['setup_cellar_quest_1.0.exe'] = JSON.stringify({ fail: 'broken' });
		sender.send(cellar);
		expect(await finished(sender, '3003')).toMatchObject({ state: 'failed', reason: { code: 'unpack' } });
		expect(removals).toHaveLength(2);
		expect(removals[1] - removals[0]).toBeGreaterThanOrEqual(990);
		expect(onBox(`${CELLAR}.part`)).toBe(false);
	});

	it('fails before the copy when the box has less than 2.2 times the installers and 1 GB', async () => {
		const need = Math.ceil(2.2 * harbour.size) + 1024 ** 3;
		fake.freeBytes = need - 1;
		const sender = await make();
		sender.send(harbour);
		expect(await finished(sender, '3001')).toMatchObject({ state: 'failed', reason: { code: 'box-room', need } });
		expect(fetched).toEqual([]);
		expect(onBox(`${HARBOUR}.part`)).toBe(false);
		expect(ended).toEqual([{ woke: false, failed: true, gameId: '3001' }]);
	});

	it('fails at once when the box does not answer and waking is off', async () => {
		await fake.off();
		const sender = await make();
		sender.send(harbour);
		expect(await finished(sender, '3001')).toMatchObject({ state: 'failed', reason: { code: 'box-down' }, waking: 'no' });
		expect(fetched).toEqual([]);
		expect(ended).toEqual([{ woke: false, failed: true, gameId: '3001' }]);
	});

	it('wakes the box, then copies', async () => {
		await fake.off();
		let onWhenFetching: boolean | null = null;
		const sender = await make({
			wakeOn: () => true,
			wake: (mac) => sendWake(mac, '127.0.0.1', `127.0.0.1:${fake.wakePort}`)
		});
		beforeFetch = async () => {
			onWhenFetching ??= fake.isOn();
		};
		sender.send(harbour);
		await until(() => sender.jobOf('3001')?.waking === 'waking');
		const done = await finished(sender, '3001');
		expect(done).toMatchObject({ state: 'done', waking: 'awake' });
		expect(onWhenFetching).toBe(true);
		expect(onBox(`${HARBOUR}/canvas.json`)).toBe(true);
		expect(ended).toEqual([{ woke: true, failed: false, gameId: '3001' }]);
	});

	it('waits for a woken box before the copy: no minutes, and the bar holds still', async () => {
		await fake.close();
		// The box answers 2 seconds after the packet.
		fake = await startFakeBatocera({ bootMs: 2000 });
		await fake.off();
		const sender = await make({ wakeOn: () => true, wake: (mac) => sendWake(mac, '127.0.0.1', `127.0.0.1:${fake.wakePort}`) });
		sender.send(harbour);
		await until(() => sender.jobOf('3001')?.waking === 'waking');
		const first = sender.jobOf('3001')!;
		await new Promise((resolve) => setTimeout(resolve, 400));
		const second = sender.jobOf('3001')!;
		for (const view of [first, second]) {
			expect(view).toMatchObject({ state: 'running', step: 'copy', stepNumber: 1, waitingForBox: true, minutesLeft: null, waking: 'waking' });
		}
		expect(second.overall).toBe(first.overall);
		expect(fetched).toEqual([]);
		expect(await finished(sender, '3001')).toMatchObject({ state: 'done', waitingForBox: false, waking: 'awake' });
	});

	it("measures the copy's speed from the copy alone, without the wait for the box", async () => {
		await fake.close();
		fake = await startFakeBatocera({ bootMs: 2000 });
		await fake.off();
		// A game of about 20 kB.
		const installer = JSON.parse(lib.files['3001/installer/downloads/night_harbour/en1installer0'].body.toString('utf8')) as { files: Record<string, string> };
		bodies['setup_night_harbour_1.2.exe'] = JSON.stringify({ ...installer, files: { ...installer.files, 'data/harbour.pak': 'x'.repeat(20_000) } });
		let atFirstPiece: JobView | null = null;
		const sender: Sender = await make({
			checksums: async () => ({}),
			wakeOn: () => true,
			wake: (mac) => sendWake(mac, '127.0.0.1', `127.0.0.1:${fake.wakePort}`)
		});
		// vangogh answers a little after the copy began.
		beforeFetch = () => new Promise((resolve) => setTimeout(resolve, 10));
		onCopy = () => {
			atFirstPiece ??= sender.jobOf('3001');
		};
		sender.send(harbour);
		expect(await finished(sender, '3001')).toMatchObject({ state: 'done' });
		// Measured from the wait's start, the first piece would make 20 kB look like minutes.
		expect(atFirstPiece).toMatchObject({ step: 'copy', waitingForBox: false, minutesLeft: 1 });
	});

	it("says no wild minutes when the copy's first piece, the marker, comes after a slow start", async () => {
		const installer = JSON.parse(lib.files['3001/installer/downloads/night_harbour/en1installer0'].body.toString('utf8')) as { files: Record<string, string> };
		bodies['setup_night_harbour_1.2.exe'] = JSON.stringify({ ...installer, files: { ...installer.files, 'data/harbour.pak': 'x'.repeat(20_000) } });
		let atFirstPiece: JobView | null = null;
		const sender: Sender = await make({ checksums: async () => ({}) });
		// vangogh's answer, and so the copy's first piece, comes a while after the step began.
		beforeFetch = async (target) => {
			if (target.filename === 'setup_night_harbour_1.2.exe') await new Promise((resolve) => setTimeout(resolve, 1200));
		};
		onCopy = () => {
			atFirstPiece ??= sender.jobOf('3001');
		};
		sender.send(harbour);
		expect(await finished(sender, '3001')).toMatchObject({ state: 'done' });
		// A few bytes in over a second would make the 20 kB look like minutes.
		expect(atFirstPiece).toMatchObject({ step: 'copy', minutesLeft: 1 });
	});

	it('fails cleanly when the box goes away during the copy', async () => {
		const sender = await make();
		let gone = false;
		onCopy = () => {
			if (gone) return;
			gone = true;
			return fake.off();
		};
		sender.send(cellar);
		expect(await finished(sender, '3003')).toMatchObject({ state: 'failed', reason: { code: 'copy' } });
		// The marker went first, so what is left is Canvas's own leftover; never a half game in the list.
		expect(onBox(`${CELLAR}.part/canvas.json`)).toBe(true);
		expect(onBox(CELLAR)).toBe(false);
		expect(sender.holds()).toEqual([]);

		await fake.on();
		const box = await openBox(login());
		try {
			await lookAt(box, sender);
		} finally {
			box.close();
		}
		expect(onBox(`${CELLAR}.part`)).toBe(false);
	});

	it.each([
		['as innoextract ends', cellar, CELLAR, null],
		["at a DOS game's DOSBox configurations", cellar, CELLAR, /\.conf$/],
		["at a Windows game's info file", harbour, HARBOUR, /\/goggame-3001\.info$/]
	] as const)('fails as box-down when the box goes away %s, and the game is not in the list', async (_when, request, folder, at) => {
		const sender = await make({
			checksums: async () => ({}),
			open: async (l, o) => {
				const box = await watchedBox(l, o);
				return {
					...box,
					run: async (command, r) => {
						const answer = await box.run(command, r);
						if (at === null) await fake.off();
						return answer;
					}
				};
			}
		});
		// Else the box goes away as the finish opens the file to read it.
		if (at !== null) {
			fake.onSftp = (op, path) => {
				if (op !== 'OPEN' || !at.test(path)) return;
				fake.onSftp = null;
				void fake.off();
			};
		}
		sender.send(request);
		expect(await finished(sender, request.gameId)).toMatchObject({ state: 'failed', reason: { code: 'box-down' } });
		expect(onBox(folder)).toBe(false);
		expect(fake.es.reloads).toBe(0);
		expect(entryOf(folder)).toBeUndefined();
	});

	it('puts the marker into .part before anything of the game, so a box that goes away leaves a leftover the next look removes', async () => {
		const sender = await make();
		const part = `/${CELLAR}.part`;
		let gone = false;
		// The box goes away at the first folder or file of the game in .part.
		fake.onSftp = (_op, path) => {
			if (gone || !path.startsWith(`${part}/`) || path === `${part}/canvas.json`) return;
			gone = true;
			void fake.off();
		};
		sender.send(cellar);
		expect(await finished(sender, '3003')).toMatchObject({ state: 'failed', reason: { code: 'copy' } });
		expect(gone).toBe(true);
		expect(onBox(`${CELLAR}.part/canvas.json`)).toBe(true);
		expect(onBox(`${CELLAR}.part/CELLAR/cellar.exe`)).toBe(false);

		await fake.on();
		const box = await openBox(login());
		try {
			await lookAt(box, sender);
		} finally {
			box.close();
		}
		expect(onBox(`${CELLAR}.part`)).toBe(false);
	});

	it('clears its own .part that the box cut off before the marker, at the next send of the game', async () => {
		const sender = await make();
		const part = `/${CELLAR}.part`;
		let gone = false;
		// The box goes away as the marker is about to be written: .part is made, and holds no marker.
		fake.onSftp = (op, path) => {
			if (gone || op !== 'OPEN' || path !== `${part}/canvas.json`) return;
			gone = true;
			void fake.off();
		};
		sender.send(cellar);
		expect(await finished(sender, '3003')).toMatchObject({ state: 'failed', reason: { code: 'copy' } });
		expect(gone).toBe(true);
		// The folder alone, or with an empty file where the marker was to be.
		const left = await readdir(join(fake.root, `${CELLAR}.part`));
		expect(left.every((name) => name === 'canvas.json')).toBe(true);
		if (left.length > 0) expect(await text(`${CELLAR}.part/canvas.json`)).toBe('');

		fake.onSftp = null;
		await fake.on();
		const again = sender.send(cellar);
		expect(await finished(sender, '3003')).toMatchObject({ id: again.id, state: 'done' });
		expect(onBox(`${CELLAR}.part`)).toBe(false);
		expect(JSON.parse(await text(`${CELLAR}/canvas.json`))).toMatchObject({ gameId: '3003' });
	});

	it('clears a .part of the game that holds only an empty canvas.json', async () => {
		await put(`${CELLAR}.part/canvas.json`, '');
		const sender = await make();
		sender.send(cellar);
		expect(await finished(sender, '3003')).toMatchObject({ state: 'done' });
		expect(onBox(`${CELLAR}.part`)).toBe(false);
		expect(JSON.parse(await text(`${CELLAR}/canvas.json`))).toMatchObject({ gameId: '3003' });
	});

	it('leaves a .part it did not make, and fails with the folder in the way', async () => {
		await put(`${CELLAR}.part/notes.txt`, 'mine');
		// A file of that name is no folder of Canvas either.
		await put(`${HARBOUR}.part`, 'a file');
		const sender = await make();
		sender.send(cellar);
		expect(await finished(sender, '3003')).toMatchObject({ state: 'failed', reason: { code: 'in-the-way', path: `/${CELLAR}.part` } });
		sender.send(harbour);
		expect(await finished(sender, '3001')).toMatchObject({ state: 'failed', reason: { code: 'in-the-way', path: `/${HARBOUR}.part` } });
		expect(await text(`${CELLAR}.part/notes.txt`)).toBe('mine');
		expect(await text(`${HARBOUR}.part`)).toBe('a file');
		expect(onBox(CELLAR)).toBe(false);
		expect(onBox(HARBOUR)).toBe(false);
	});

	it("never replaces another game's folder of the same title", async () => {
		const first: Marker = { gameId: '3001', system: 'windows', files: ['setup_night_harbour_1.2.exe'], version: '1.2', sentAt: '2026-10-20T21:14:03Z', canvas: '0.12.0' };
		await put(`${HARBOUR}/canvas.json`, markerJson(first));
		await put(`${HARBOUR}/bin/Harbour.exe`, 'the first');
		const sender = await make();
		// Another game of the same title gets the same folder name (spec 2.2).
		sender.send({ ...harbour, gameId: '3009' });
		expect(await finished(sender, '3009')).toMatchObject({ state: 'failed', reason: { code: 'in-the-way', path: `/${HARBOUR}` } });
		expect(JSON.parse(await text(`${HARBOUR}/canvas.json`))).toEqual(first);
		expect(await text(`${HARBOUR}/bin/Harbour.exe`)).toBe('the first');
		expect(onBox(`${HARBOUR}.part`)).toBe(false);
	});

	it('fails on a damaged file', async () => {
		const sender = await make({
			checksums: async (productId) => ({ ...lib.checksums?.[productId], '/downloads/night_harbour/en1installer0': '0'.repeat(32) })
		});
		sender.send(harbour);
		expect(await finished(sender, '3001')).toMatchObject({ state: 'failed', reason: { code: 'checksum' } });
		expect(onBox(`${HARBOUR}.part`)).toBe(false);
		expect(onBox(HARBOUR)).toBe(false);
	});

	it('fails with fetch when vangogh breaks off in the middle of a file, and leaves nothing on the box', async () => {
		const sender = await make({
			openFile: async (target) => {
				fetched.push(target.filename);
				let given = false;
				// The first piece, then vangogh's answer ends with an error.
				return new Readable({
					read() {
						if (given) this.destroy(new Error('vangogh broke off'));
						else this.push(Buffer.alloc(64 * 1024, 1));
						given = true;
					}
				});
			}
		});
		sender.send(harbour);
		expect(await finished(sender, '3001')).toMatchObject({ state: 'failed', reason: { code: 'fetch' } });
		expect(fetched).toEqual(['setup_night_harbour_1.2.exe']);
		expect(logged.some((line) => line.includes('WARN') && line.includes('vangogh broke off'))).toBe(true);
		expect(onBox(`${HARBOUR}.part`)).toBe(false);
		expect(onBox(HARBOUR)).toBe(false);
	});

	it('sends without the check when vangogh gives no checksums', async () => {
		const sender = await make({
			checksums: async () => {
				throw new Error('vangogh answered 500 for /api/gog/checksums/3001');
			}
		});
		sender.send(harbour);
		expect(await finished(sender, '3001')).toMatchObject({ state: 'done' });
		expect(logged.some((line) => line.includes('WARN') && line.includes('checksums'))).toBe(true);
	});

	it('says when an installer cannot be unpacked, or needs unrar', async () => {
		const sender = await make({ checksums: async () => ({}) });
		bodies['setup_cellar_quest_1.0.exe'] = JSON.stringify({ fail: 'broken' });
		sender.send(cellar);
		expect(await finished(sender, '3003')).toMatchObject({ state: 'failed', reason: { code: 'unpack' } });
		// innoextract's own words go to the log.
		expect(logged.some((line) => line.includes('broken'))).toBe(true);

		bodies['setup_cellar_quest_1.0.exe'] = JSON.stringify({ fail: 'needs RAR support' });
		sender.send(cellar);
		await until(() => sender.jobOf('3003')?.state === 'failed' && sender.jobOf('3003')?.reason?.code === 'unrar');
		expect(onBox(`${CELLAR}.part`)).toBe(false);
	});

	it('runs innoextract once for an installer with .bin parts', async () => {
		const sender = await make({ checksums: async () => ({}) });
		bodies['setup_x.exe'] = HARBOUR_SETUP;
		bodies['setup_x-1.bin'] = 'the second part of the installer';
		const target = (manualUrl: string, filename: string): FileTarget => ({ productId: '3001', downloadType: 'installer', manualUrl, filename });
		sender.send({ ...harbour, files: [target('/downloads/x/en1installer0', 'setup_x.exe'), target('/downloads/x/en1installer1', 'setup_x-1.bin')] });
		expect(await finished(sender, '3001')).toMatchObject({ state: 'done' });
		expect(fetched).toEqual(['setup_x.exe', 'setup_x-1.bin']);
		// The .bin beside it is innoextract's to find.
		expect(fake.unpacked).toEqual([`/${HARBOUR}.part/.canvas-installers/setup_x.exe`]);
		expect(await text(`${HARBOUR}/bin/Harbour.exe`)).toBe('harbour');
		expect(onBox(`${HARBOUR}/.canvas-installers`)).toBe(false);
	});

	it("unpacks an installer whose name holds a quote and spaces", async () => {
		const sender = await make();
		const name = "setup it's 1.0.exe";
		bodies[name] = HARBOUR_SETUP;
		sender.send({ ...harbour, files: [{ ...harbourFiles[0], filename: name }] });
		expect(await finished(sender, '3001')).toMatchObject({ state: 'done' });
		expect(fake.unpacked).toEqual([`/${HARBOUR}.part/.canvas-installers/${name}`]);
		expect(await text(`${HARBOUR}/bin/Harbour.exe`)).toBe('harbour');
		expect(await text(`${HARBOUR}/autorun.cmd`)).toBe('DIR=bin\nCMD="Harbour.exe"\n');
		expect(JSON.parse(await text(`${HARBOUR}/canvas.json`))).toMatchObject({ files: [name] });
	});

	it('keeps the older version when the unpacking of an update fails', async () => {
		const older: Marker = { gameId: '3001', system: 'windows', files: ['setup_night_harbour_1.1.exe'], version: '1.1', sentAt: '2026-10-20T21:14:03Z', canvas: '0.12.0' };
		await put(`${HARBOUR}/canvas.json`, markerJson(older));
		await put(`${HARBOUR}/bin/Harbour.exe`, 'the older');
		const sender = await make({ checksums: async () => ({}) });
		bodies['setup_night_harbour_1.2.exe'] = JSON.stringify({ fail: 'broken' });
		sender.send(harbour);
		expect(await finished(sender, '3001')).toMatchObject({ state: 'failed', reason: { code: 'unpack' } });
		expect(JSON.parse(await text(`${HARBOUR}/canvas.json`))).toEqual(older);
		expect(await text(`${HARBOUR}/bin/Harbour.exe`)).toBe('the older');
		expect(onBox(`${HARBOUR}.part`)).toBe(false);
		expect(onBox(`${HARBOUR}.old`)).toBe(false);
	});

	it("fails when the box's key has changed", async () => {
		const sender = await make({ login: () => ({ ...login(), hostKey: `SHA256:${'A'.repeat(43)}` }) });
		sender.send(harbour);
		expect(await finished(sender, '3001')).toMatchObject({ state: 'failed', reason: { code: 'key-changed' } });
		expect(fetched).toEqual([]);
	});

	it('fails with a reason of its own when Batocera refuses the login', async () => {
		const saved = login();
		fake.password = 'changed at the box';
		const sender = await make({ login: () => saved });
		sender.send(harbour);
		expect(await finished(sender, '3001')).toMatchObject({ state: 'failed', reason: { code: 'login' } });
		expect(fetched).toEqual([]);
	});

	it('writes the details only for a game new in the list', async () => {
		fake.es.games.windows = [{ path: `/${HARBOUR}`, desc: 'Changed at the TV', name: 'Harbour at Night' }];
		// An entry without a description counts as new.
		fake.es.games.dos = [{ path: `/${CELLAR}`, desc: '' }];
		const sender = await make();
		sender.send(harbour);
		sender.send(cellar);
		await finished(sender, '3003');
		expect(fake.es.reloads).toBe(2);
		expect(fake.es.written.map((w) => w.system)).toEqual(['dos']);
		expect(fake.es.media.map((m) => m.system)).toEqual(['dos', 'dos']);
		expect(fake.es.games.windows).toEqual([{ path: `/${HARBOUR}`, desc: 'Changed at the TV', name: 'Harbour at Night' }]);
		expect(entryOf(CELLAR)).toMatchObject({ desc: 'Cellar Quest, a quiet game.' });
	});

	it("waits for the game to show in the list, which EmulationStation reloads after it answered", async () => {
		// The reload reads the folders only a while after its answer, as 43.1's does on its own thread.
		fake.es.reloadMs = 1200;
		const sender = await make();
		sender.send(cellar);
		expect(await finished(sender, '3003')).toMatchObject({ state: 'done' });
		expect(fake.es.written.map((w) => w.id)).toEqual([CELLAR_ID]);
		expect(entryOf(CELLAR)).toMatchObject({ name: 'Cellar Quest', image: '/userdata/roms/dos/images/Cellar Quest-image.jpg' });
	});

	it('keeps waiting for the game when a read of it fails meanwhile', async () => {
		fake.es.failGets = 2;
		const sender = await make();
		sender.send(cellar);
		expect(await finished(sender, '3003')).toMatchObject({ state: 'done' });
		expect(fake.es.written.map((w) => w.id)).toEqual([CELLAR_ID]);
	});

	it('ends as sent when the game does not show in the list in time', async () => {
		fake.es.reloadMs = 60_000;
		const sender = await make({ listWaitMs: 300 });
		sender.send(cellar);
		expect(await finished(sender, '3003')).toMatchObject({ state: 'done', reason: null });
		expect(onBox(`${CELLAR}/canvas.json`)).toBe(true);
		expect(fake.es.written).toEqual([]);
		expect(logged.some((line) => line.includes('WARN') && line.includes("did not show in batocera's list"))).toBe(true);
	});

	it('sends the game when EmulationStation does not answer', async () => {
		fake.es.up = false;
		const sender = await make();
		sender.send(harbour);
		expect(await finished(sender, '3001')).toMatchObject({ state: 'done', listLater: false });
		expect(onBox(`${HARBOUR}/canvas.json`)).toBe(true);
		expect(fake.es.reloads).toBe(0);
		expect(logged.some((line) => line.includes('WARN') && line.includes('not reloaded'))).toBe(true);
	});

	it('waits for the game on the TV before reloading', async () => {
		fake.es.idle = false;
		const sender = await make({ idlePollMs: 50 });
		sender.send(harbour);
		expect(await finished(sender, '3001')).toMatchObject({ state: 'done', listLater: true });
		expect(onBox(`${HARBOUR}/canvas.json`)).toBe(true);
		expect(fake.es.reloads).toBe(0);
		expect(fake.es.written).toHaveLength(0);
		// The end of the sends waits for the reload, as a shutdown countdown must (spec 3.6).
		expect(ended).toEqual([]);

		fake.es.idle = true;
		await until(() => sender.jobOf('3001')?.listLater === false);
		expect(fake.es.reloads).toBe(1);
		// The details and the pictures the job kept, once the game on the TV was closed.
		expect(fake.es.written.map((w) => w.system)).toEqual(['windows']);
		expect(fake.es.media.map((m) => m.type)).toEqual(['image', 'thumbnail', 'fanart']);
		expect(await text('userdata/roms/windows/images/Night Harbour-thumb.jpg')).toBe('image');
		expect(ended).toEqual([{ woke: false, failed: false, gameId: '3001' }]);
	});

	it('ends the wait for the reload when the game is sent again', async () => {
		fake.es.idle = false;
		const sender = await make({ idlePollMs: 50 });
		sender.send(harbour);
		expect(await finished(sender, '3001')).toMatchObject({ state: 'done', listLater: true });
		const again = sender.send(harbour);
		await until(() => sender.jobOf('3001')?.id === again.id && sender.jobOf('3001')?.state === 'done');
		expect(sender.jobOf('3001')).toMatchObject({ listLater: true });
		expect(ended).toEqual([]);

		fake.es.idle = true;
		await until(() => sender.jobOf('3001')?.listLater === false);
		// Only the new send reloads; the end of the sends comes once.
		expect(fake.es.reloads).toBe(1);
		expect(ended).toEqual([{ woke: false, failed: false, gameId: '3001' }]);
	});

	it("keeps a game's last result until its next send", async () => {
		fake.freeBytes = 1024;
		const sender = await make();
		expect(sender.jobOf('3001')).toBeNull();
		const failed = sender.send(harbour);
		expect(await finished(sender, '3001')).toMatchObject({ id: failed.id, state: 'failed', reason: { code: 'box-room' } });

		// Another game's send does not touch it.
		fake.freeBytes = 400 * GiB;
		sender.send(cellar);
		await finished(sender, '3003');
		expect(sender.jobOf('3001')).toMatchObject({ id: failed.id, state: 'failed' });

		const again = sender.send(harbour);
		expect(again.id).not.toBe(failed.id);
		expect(sender.jobOf('3001')).toMatchObject({ id: again.id, reason: null, endedAt: null });
		expect(await finished(sender, '3001')).toMatchObject({ id: again.id, state: 'done' });
	});
});
