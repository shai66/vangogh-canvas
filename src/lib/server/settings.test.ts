import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NO_SETTINGS, type Settings } from '../settings';
import { createLogger } from './log';
import { SETTINGS_FILE, SettingsStore } from './settings';

const chosen: Settings = { defaults: { os: ['macos'], sort: 'year', grouped: true, hide18: false }, theo: true };

let folder: string;
let lines: string[];
const store = (dir = folder) => new SettingsStore({ dir, log: createLogger((line) => lines.push(line)) });
const warnings = () => lines.filter((line) => line.includes(' WARN '));

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
		await writeFile(
			join(folder, SETTINGS_FILE),
			'{"version":1,"defaults":{"os":["linux","windows"],"sort":"recent","grouped":true,"hide18":true},"theo":true}'
		);
		const s = store();
		await s.load();
		// The platforms in the fixed order.
		expect(s.get()).toEqual({ defaults: { os: ['windows', 'linux'], sort: 'recent', grouped: true, hide18: true }, theo: true });
		expect(warnings()).toEqual([]);
	});

	// Review focus 3
	it('mends each part on its own', async () => {
		await writeFile(
			join(folder, SETTINGS_FILE),
			'{"defaults":{"os":["amiga"],"sort":"rating","grouped":"yes","hide18":true},"theo":1}'
		);
		const s = store();
		await s.load();
		expect(s.get()).toEqual({ defaults: { os: [], sort: 'title', grouped: false, hide18: true }, theo: false });
		expect(warnings().map((line) => line.match(/ part=(\S+)/)?.[1])).toEqual([
			'defaults.os',
			'defaults.sort',
			'defaults.grouped',
			'theo'
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
		// Neither the temporary file nor the probe is left.
		expect(await readdir(folder)).toEqual([SETTINGS_FILE]);
	});

	it('writes overlapping saves one after the other', async () => {
		const s = store();
		await s.load();
		const a = chosen;
		const b: Settings = { defaults: { os: [], sort: 'title', grouped: false, hide18: true }, theo: false };
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
