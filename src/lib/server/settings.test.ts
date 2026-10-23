import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NO_BATOCERA, NO_SERVER, NO_SETTINGS, type Settings } from '../settings';
import { createLogger } from './log';
import { SETTINGS_FILE, SettingsStore } from './settings';

const chosen: Settings = { ...NO_SETTINGS, defaults: { os: ['macos'], sort: 'year', grouped: true, hide18: false }, theo: true };

let folder: string;
let lines: string[];
const store = (dir = folder) => new SettingsStore({ dir, log: createLogger((line) => lines.push(line)) });
const warnings = () => lines.filter((line) => line.includes(' WARN '));
/** The parts the log names in its warnings, in order. */
const warned = () => warnings().map((line) => line.match(/ part=(\S+)/)?.[1]);
/** Writes a file of 0.12.0 with these parts, the parts of 0.12.0 at their defaults unless given. */
const writeParts = (parts: object) =>
	writeFile(join(folder, SETTINGS_FILE), JSON.stringify({ version: 1, preferred: 'auto', batocera: NO_BATOCERA, notRunning: [], ...parts }));

beforeEach(async () => {
	folder = await mkdtemp(join(tmpdir(), 'canvas-settings-'));
	lines = [];
});
afterEach(async () => {
	await rm(folder, { recursive: true, force: true });
});

describe('SettingsStore', () => {
	it('starts with no settings when there is no file', async () => {
		const s = store();
		await s.load();
		expect(s.get()).toEqual(NO_SETTINGS);
		expect(s.writable).toBe(true);
		expect(warnings()).toEqual([]);
	});

	it('reads a valid file', async () => {
		await writeParts({ defaults: { os: ['linux', 'windows'], sort: 'recent', grouped: true, hide18: true }, theo: true });
		const s = store();
		await s.load();
		// The platforms in the fixed order.
		expect(s.get()).toEqual({ ...NO_SETTINGS, defaults: { os: ['windows', 'linux'], sort: 'recent', grouped: true, hide18: true }, theo: true });
		expect(warnings()).toEqual([]);
	});

	it('reads the parts of 0.12.0', async () => {
		const parts: Settings = {
			...NO_SETTINGS,
			preferred: 'batocera',
			batocera: {
				on: true,
				address: '10.0.0.21',
				user: 'root',
				password: 'pa ss "$1"',
				ready: true,
				hostKey: 'SHA256:' + 'A'.repeat(43),
				mac: '02:00:00:aa:bb:cc',
				wake: true,
				shutdown: true
			},
			notRunning: ['1001'],
			server: { rebuildAt: '05:15', timeZone: 'Europe/Berlin', versionCheck: false }
		};
		await writeParts(parts);
		const s = store();
		await s.load();
		expect(s.get()).toEqual(parts);
		expect(warnings()).toEqual([]);
	});

	// Review focus 3
	it('mends each part on its own', async () => {
		await writeParts({ defaults: { os: ['amiga'], sort: 'rating', grouped: 'yes', hide18: true }, theo: 1 });
		const s = store();
		await s.load();
		expect(s.get()).toEqual({ ...NO_SETTINGS, defaults: { os: [], sort: 'title', grouped: false, hide18: true }, theo: false });
		expect(warnings().map((line) => line.match(/ part=(\S+)/)?.[1])).toEqual([
			'defaults.os',
			'defaults.sort',
			'defaults.grouped',
			'theo'
		]);
	});

	it('mends each new part on its own', async () => {
		await writeParts({
			defaults: NO_SETTINGS.defaults,
			theo: true,
			preferred: 'amiga',
			batocera: { ...NO_BATOCERA, on: true, address: 'a b', wake: 'yes', shutdown: true },
			notRunning: ['x']
		});
		const s = store();
		await s.load();
		expect(s.get()).toEqual({ ...NO_SETTINGS, theo: true, batocera: { ...NO_BATOCERA, on: true, shutdown: true } });
		expect(warned()).toEqual(['preferred', 'batocera.address', 'batocera.wake', 'notRunning']);
	});

	it("reads a file without a server part as the stack's values", async () => {
		await writeParts({ defaults: NO_SETTINGS.defaults, theo: false });
		const s = store();
		await s.load();
		expect(s.get().server).toEqual(NO_SERVER);
		expect(warnings()).toEqual([]);
	});

	it('mends each value of the server part on its own', async () => {
		await writeParts({ defaults: NO_SETTINGS.defaults, theo: false, server: { rebuildAt: '99:00', timeZone: 'Nowhere/Here', versionCheck: 1 } });
		const s = store();
		await s.load();
		expect(s.get().server).toEqual(NO_SERVER);
		expect(warned()).toEqual(['server.rebuildAt', 'server.timeZone', 'server.versionCheck']);
	});

	it('reads a preferred Batocera as Autoselect when the switch is off, and only then', async () => {
		for (const [on, preferred] of [[false, 'auto'], [true, 'batocera']] as const) {
			await writeParts({ defaults: NO_SETTINGS.defaults, theo: false, preferred: 'batocera', batocera: { ...NO_BATOCERA, on } });
			const s = store();
			await s.load();
			expect(s.get().preferred, String(on)).toBe(preferred);
		}
	});

	it('ends "set up" when a part it was tested with is mended, or no key was taken', async () => {
		const tested = { ...NO_BATOCERA, on: true, address: '10.0.0.21', ready: true, hostKey: 'SHA256:' + 'A'.repeat(43) };
		for (const part of [{ address: 'a b' }, { user: '' }, { password: 7 }, { hostKey: 'SHA1:x' }, { hostKey: null }]) {
			await writeParts({ defaults: NO_SETTINGS.defaults, theo: false, batocera: { ...tested, ...part } });
			const s = store();
			await s.load();
			expect(s.get().batocera.ready, JSON.stringify(part)).toBe(false);
		}
		// Tested with what is saved now: set up.
		await writeParts({ defaults: NO_SETTINGS.defaults, theo: false, batocera: tested });
		const s = store();
		await s.load();
		expect(s.get().batocera.ready).toBe(true);
	});

	it('applies overlapping updates to the settings the one before left', async () => {
		const s = store();
		await s.load();
		const first = s.update((current) => ({ ...current, theo: true }));
		const second = s.update((current) => ({ ...current, preferred: 'windows' }));
		expect(await Promise.all([first, second])).toEqual([true, true]);
		expect(s.get()).toEqual({ ...NO_SETTINGS, theo: true, preferred: 'windows' });
		expect(JSON.parse(await readFile(join(folder, SETTINGS_FILE), 'utf8'))).toEqual({ version: 1, ...NO_SETTINGS, theo: true, preferred: 'windows' });
	});

	it('reads a 0.11.0 file with the new parts at their defaults', async () => {
		await writeFile(
			join(folder, SETTINGS_FILE),
			'{"version":1,"defaults":{"os":["linux","windows"],"sort":"recent","grouped":true,"hide18":true},"theo":true}'
		);
		const s = store();
		await s.load();
		expect(s.get()).toEqual({ ...NO_SETTINGS, defaults: { os: ['windows', 'linux'], sort: 'recent', grouped: true, hide18: true }, theo: true });
		// Each part it lacks is named once.
		expect(warned()).toEqual([
			'preferred',
			'batocera.on',
			'batocera.address',
			'batocera.user',
			'batocera.password',
			'batocera.ready',
			'batocera.hostKey',
			'batocera.mac',
			'batocera.wake',
			'batocera.shutdown',
			'notRunning'
		]);
	});

	// Review focus 3
	it('starts with no settings when the file is not JSON', async () => {
		await writeFile(join(folder, SETTINGS_FILE), '{nope');
		const s = store();
		await s.load();
		expect(s.get()).toEqual(NO_SETTINGS);
		expect(warnings()).toHaveLength(1);
	});

	it('writes the whole settings and reads them back after a restart', async () => {
		const s = store();
		await s.load();
		expect(await s.save(chosen)).toBe(true);
		expect(s.get()).toEqual(chosen);
		expect(JSON.parse(await readFile(join(folder, SETTINGS_FILE), 'utf8'))).toEqual({ version: 1, ...chosen });
		const next = store();
		await next.load();
		expect(next.get()).toEqual(chosen);
		// A server part of nulls only is nothing to mend.
		expect(warnings()).toEqual([]);
		// Neither the temporary file nor the probe is left.
		expect(await readdir(folder)).toEqual([SETTINGS_FILE]);
	});

	it('writes overlapping saves one after the other', async () => {
		const s = store();
		await s.load();
		const a = chosen;
		const b: Settings = { ...NO_SETTINGS, defaults: { os: [], sort: 'title', grouped: false, hide18: true }, theo: false };
		const first = s.save(a);
		const second = s.save(b);
		expect(await Promise.all([first, second])).toEqual([true, true]);
		expect(s.writable).toBe(true);
		expect(s.get()).toEqual(b);
		expect(JSON.parse(await readFile(join(folder, SETTINGS_FILE), 'utf8'))).toEqual({ version: 1, ...b });
		expect(await readdir(folder)).toEqual([SETTINGS_FILE]);
	});

	describe('in a folder that cannot be written', () => {
		let s: SettingsStore;

		beforeEach(async () => {
			await writeFile(join(folder, 'a-file'), 'a file where a folder is expected');
			s = store(join(folder, 'a-file', 'settings'));
			await s.load();
		});

		it('knows at start when the folder cannot be written', async () => {
			expect(s.writable).toBe(false);
			expect(warnings()).toHaveLength(1);
			expect(await s.save(chosen)).toBe(false);
			expect(s.get()).toEqual(NO_SETTINGS);
		});

		it('says it is writable again after a write that works', async () => {
			await rm(join(folder, 'a-file'));
			expect(await s.save(chosen)).toBe(true);
			expect(s.writable).toBe(true);
			expect(s.get()).toEqual(chosen);
		});
	});
});
