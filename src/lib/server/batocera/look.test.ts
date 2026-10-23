import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger, silentLogger } from '../log';
import { startFakeBatocera, type FakeBatocera } from '../testing/fake-batocera';
import { openBox, type Box } from './box';
import { markerJson, type Marker } from './folder';
import { LookStore, onBoxOf, readLook, type Look } from './look';

const sent: Marker = {
	gameId: '3001',
	system: 'windows',
	files: ['setup_night_harbour_1.2.exe'],
	version: '1.2',
	sentAt: '2026-10-20T21:14:03Z',
	canvas: '0.12.0'
};

describe('readLook', () => {
	let fake: FakeBatocera;
	let box: Box;

	/** Writes a file on the fake box, the folders above it too. */
	async function put(path: string, text: string): Promise<void> {
		const file = join(fake.root, path);
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, text);
	}

	beforeEach(async () => {
		fake = await startFakeBatocera();
		box = await openBox({ address: '127.0.0.1', port: fake.port, user: fake.user, password: fake.password, hostKey: fake.fingerprint });
	});

	afterEach(async () => {
		box.close();
		await fake.close();
	});

	it('reads what is on the box', async () => {
		await put('userdata/roms/windows/Night Harbour.pc/canvas.json', markerJson(sent));
		await put('userdata/roms/windows/Night Harbour.pc/autorun.cmd', 'CMD="Harbour.exe"\n');
		await put('userdata/roms/dos/Cellar Quest.pc/CELLAR/cellar.exe', 'cellar');
		await put('userdata/roms/windows/Old.pc.part/canvas.json', markerJson({ ...sent, gameId: '3005' }));
		// Not a folder, though named like one: it does not stop the look.
		await put('userdata/roms/windows/Loose.pc', 'a file');
		await put('userdata/roms/windows/notes.txt', 'not a game');

		const seen = await readLook(box);
		expect(seen.markers).toEqual([{ ...sent, folder: 'Night Harbour.pc' }]);
		expect(seen.folders).toEqual({ windows: ['Loose.pc', 'Night Harbour.pc'], dos: ['Cellar Quest.pc'] });
		expect(seen.leftovers).toEqual(['/userdata/roms/windows/Old.pc.part']);
	});

	it('keeps a foreign .part out of the leftovers', async () => {
		await put('userdata/roms/windows/Mine.pc.part/game.exe', 'mine');
		await put('userdata/roms/windows/Damaged.pc.old/canvas.json', '{ "gameId": "3001"');
		// A marker of the other system: someone moved the folder.
		await put('userdata/roms/dos/Moved.pc.part/canvas.json', markerJson(sent));

		const seen = await readLook(box);
		expect(seen.leftovers).toEqual([]);
		expect(seen.markers).toEqual([]);
	});
});

describe('onBoxOf', () => {
	const look: Look = {
		at: '2026-10-20T21:20:00.000Z',
		up: true,
		markers: [{ ...sent, folder: 'Night Harbour.pc' }],
		folders: { windows: ['Night Harbour.pc'], dos: ['Cellar Quest.pc'] },
		leftovers: []
	};
	const harbour = { id: '3001', name: 'Night Harbour', system: 'windows' as const };
	const cellar = { id: '3003', name: 'Cellar Quest', system: 'dos' as const };

	it('knows each state of a game', () => {
		expect(onBoxOf(look, harbour, ['setup_night_harbour_1.2.exe']).onBox).toBe('canvas');
		expect(onBoxOf(look, harbour, ['setup_night_harbour_1.2.exe'])).toEqual({ onBox: 'canvas', marker: look.markers[0], newer: false });
		expect(onBoxOf(look, harbour, ['setup_night_harbour_1.3.exe']).newer).toBe(true);
		expect(onBoxOf(look, cellar, []).onBox).toBe('hand');
		expect(onBoxOf(look, { id: '9', name: 'Other', system: 'windows' }, []).onBox).toBe('no');
		// A folder of that name in the other system's folder is not the game's.
		expect(onBoxOf(look, { ...cellar, system: 'windows' }, []).onBox).toBe('no');
		expect(onBoxOf(null, harbour, []).onBox).toBe('no');
	});

	it('takes the folder of another game of the same title as not there, not as put there by hand', () => {
		const namesake = { id: '3009', name: 'Night Harbour', system: 'windows' as const };
		expect(onBoxOf(look, namesake, ['setup_night_harbour_1.2.exe'])).toEqual({ onBox: 'no', marker: null, newer: false });
	});
});

describe('LookStore', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'canvas-look-'));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('keeps the last look on disk', async () => {
		const look: Look = {
			at: '2026-10-20T21:20:00.000Z',
			up: true,
			markers: [{ ...sent, folder: 'Night Harbour.pc' }],
			folders: { windows: ['Night Harbour.pc'], dos: ['Cellar Quest.pc'] },
			leftovers: []
		};
		const fresh = new LookStore({ dir, log: silentLogger });
		await fresh.load();
		expect(fresh.get()).toBeNull();

		await fresh.set(look);
		expect(fresh.get()).toEqual(look);
		const again = new LookStore({ dir, log: silentLogger });
		await again.load();
		expect(again.get()).toEqual(look);

		// A look that did not reach the box keeps what the one before saw.
		await again.markDown('2026-10-20T21:30:00.000Z');
		const down = { ...look, at: '2026-10-20T21:30:00.000Z', up: false };
		expect(again.get()).toEqual(down);
		const third = new LookStore({ dir, log: silentLogger });
		await third.load();
		expect(third.get()).toEqual(down);
		expect(JSON.parse(await readFile(join(dir, 'batocera.json'), 'utf8'))).toMatchObject({ at: down.at, up: false });

		// A damaged file is no last look.
		await writeFile(join(dir, 'batocera.json'), '{ "at": 1 }');
		const logged: string[] = [];
		const damaged = new LookStore({ dir, log: createLogger((line) => logged.push(line)) });
		await damaged.load();
		expect(damaged.get()).toBeNull();
		expect(logged.join('\n')).toContain('WARN');
	});
});
