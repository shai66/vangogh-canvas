import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_SERVER, NO_SETTINGS, type ServerSettings, type Settings } from '../settings';
import { createApp } from './app';
import { Batocera } from './batocera/service';
import { createLogger, silentLogger, type Logger } from './log';
import { SettingsStore } from './settings';
import { FIRST_CHECK_MS } from './updates';

const required = {
	VANGOGH_URL: 'http://vangogh.lan:1853/',
	VANGOGH_USERNAME: 'api',
	VANGOGH_PASSWORD: 'secret'
};

describe('createApp', () => {
	// Without a PIN a saved file is never read: spec 0.11.0, section 2.1.
	it('creates a settings store only when a PIN is set', () => {
		expect(createApp(required, silentLogger).settings).toBeNull();
		expect(createApp({ ...required, SETTINGS_PIN: '2468' }, silentLogger).settings).toBeInstanceOf(SettingsStore);
	});

	// Everything of Batocera needs the settings: spec 0.12.0, section 10.1.
	it('creates the Batocera service whenever it creates a settings store', () => {
		expect(createApp(required, silentLogger).batocera).toBeNull();
		expect(createApp({ ...required, SETTINGS_PIN: '2468' }, silentLogger).batocera).toBeInstanceOf(Batocera);
	});
});

// Spec of the settings tabs, section 5.2: a changed Server setting applies at once.
describe('applyServer', () => {
	const DAY = 24 * 60 * 60_000;
	let folder: string;

	beforeEach(async () => {
		folder = await mkdtemp(join(tmpdir(), 'canvas-app-'));
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
	});
	afterEach(async () => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		await rm(folder, { recursive: true, force: true });
	});

	/** A Canvas with a PIN whose stack has the update check off, as `startApp` leaves it; `asked` has each request of the check. */
	async function started(env: Record<string, string> = {}, log: Logger = silentLogger) {
		const asked: string[] = [];
		vi.stubGlobal('fetch', async (url: unknown) => {
			asked.push(String(url));
			return new Response(JSON.stringify({ tag_name: 'v0.0.1' }), { status: 200 });
		});
		const app = createApp(
			{ ...required, SETTINGS_PIN: '2468', SETTINGS_DIR: folder, VERSION_CHECK: 'off', VERSION_CHECK_URL: 'http://127.0.0.1:9/latest', ...env },
			log
		);
		await app.settings!.load();
		app.applyServer();
		return { app, asked };
	}

	const withServer = (server: Partial<ServerSettings>, over: Partial<Settings> = {}): Settings => ({
		...NO_SETTINGS,
		...over,
		server: { ...NO_SERVER, ...server }
	});

	it('switching the check on starts it, off stops it', async () => {
		const { app, asked } = await started();
		expect(app.updatesOn()).toBe(false);
		await app.settings!.save(withServer({ versionCheck: true }));
		expect(app.updatesOn()).toBe(true);
		// It asks 10 seconds later, as at a start, at the stack's address.
		await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
		expect(asked).toEqual(['http://127.0.0.1:9/latest']);
		// A save of another setting leaves the running check as it is.
		await app.settings!.save(withServer({ versionCheck: true }, { theo: true }));
		expect(app.updatesOn()).toBe(true);
		await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
		expect(asked).toHaveLength(1);
		await app.settings!.save(withServer({ versionCheck: false }));
		expect(app.updatesOn()).toBe(false);
		await vi.advanceTimersByTimeAsync(2 * DAY);
		expect(asked).toHaveLength(1);
	});

	it('moves the daily rebuild when a save changes its time or zone', async () => {
		const { app } = await started();
		const reschedule = vi.spyOn(app.scheduler, 'reschedule');
		await app.settings!.save(withServer({ rebuildAt: '06:15' }));
		expect(reschedule).toHaveBeenLastCalledWith('06:15', 'UTC');
		await app.settings!.save(withServer({ rebuildAt: '06:15', timeZone: 'Asia/Tokyo' }));
		expect(reschedule).toHaveBeenLastCalledWith('06:15', 'Asia/Tokyo');
	});

	// The stack had the check off, so its address that is not one was replaced by GitHub's (Task 1 of plan 15).
	it('warns when the settings switch the check on and the address of the stack was replaced', async () => {
		const lines: string[] = [];
		const { app } = await started({ VERSION_CHECK_URL: 'ftp://x' }, createLogger((line) => lines.push(line)));
		await app.settings!.save(withServer({ versionCheck: true }));
		expect(lines.filter((line) => line.includes(' WARN ') && line.includes('VERSION_CHECK_URL'))).toHaveLength(1);
		app.updates.stop();
	});
});
