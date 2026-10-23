import { describe, expect, it } from 'vitest';
import { NOTHING_REMEMBERED } from './remember';
import {
	applyBody,
	NO_BATOCERA,
	NO_SERVER,
	NO_SETTINGS,
	parseSettingsBody,
	serverInEffect,
	toAnswer,
	type Preferred,
	type ServerInEffect,
	type SettingsBody
} from './settings';

/** The stack's own values: its defaults. */
const STACK: ServerInEffect = { rebuildAt: '04:30', timeZone: 'UTC', versionCheck: true };

describe('the body of a change of the settings', () => {
	const valid = {
		defaults: { os: ['linux', 'windows'], sort: 'recent', grouped: true, hide18: false },
		theo: true,
		preferred: 'auto',
		batocera: { on: false, address: '', user: 'root', wake: false, shutdown: false }
	};
	const withDefaults = (part: Record<string, unknown>) => ({ ...valid, defaults: { ...valid.defaults, ...part } });

	it('takes a valid body and refuses any part that is not valid', () => {
		// The platforms in the fixed order.
		const settings = { ...valid, defaults: { os: ['windows', 'linux'], sort: 'recent', grouped: true, hide18: false } };
		expect(parseSettingsBody(valid)).toEqual(settings);
		expect(parseSettingsBody(withDefaults({ os: [] }))).toEqual({ ...settings, defaults: { ...settings.defaults, os: [] } });
		// A key it does not know is ignored.
		expect(parseSettingsBody({ ...withDefaults({ price: 'low' }), version: 2 })).toEqual(settings);

		for (const body of [null, undefined, 'settings', 1, true, [valid]]) expect(parseSettingsBody(body)).toBeNull();
		for (const part of [
			{ os: ['amiga'] },
			{ os: ['linux', 'linux'] },
			{ os: 'linux' },
			{ os: undefined },
			{ sort: 'price' },
			{ sort: undefined },
			{ grouped: 'yes' },
			{ hide18: 1 }
		]) {
			expect(parseSettingsBody(withDefaults(part)), JSON.stringify(part)).toBeNull();
		}
		expect(parseSettingsBody({ ...valid, defaults: null })).toBeNull();
		expect(parseSettingsBody({ ...valid, theo: 'true' })).toBeNull();
		expect(parseSettingsBody({ defaults: valid.defaults })).toBeNull();
	});
});

describe("Batocera's settings", () => {
	const KEY = 'SHA256:' + 'A'.repeat(43);
	const MAC = '02:00:00:aa:bb:cc';

	const body = (over: Partial<SettingsBody['batocera']> = {}, rest: Partial<SettingsBody> = {}): SettingsBody => ({
		defaults: NOTHING_REMEMBERED, theo: false, preferred: 'auto',
		batocera: { on: true, address: '10.0.0.21', user: 'root', wake: false, shutdown: false, ...over }, ...rest
	});

	it('takes a body without a password, and ignores ready, hostKey and mac in it', () => {
		const parsed = parseSettingsBody({ ...body(), batocera: { ...body().batocera, ready: true, hostKey: 'x', mac: 'y' } });
		expect(parsed?.batocera).toEqual(body().batocera);
	});

	it('refuses a body with an unknown platform, or a bad address, user or password', () => {
		expect(parseSettingsBody(body({}, { preferred: 'amiga' as Preferred }))).toBeNull();
		expect(parseSettingsBody(body({ address: 'ten dot zero' }))).toBeNull();
		expect(parseSettingsBody(body({ user: '' }))).toBeNull();
		expect(parseSettingsBody(body({ password: '' }))).toBeNull();
	});

	it('keeps the marks whatever a body says', () => {
		// Marks change through their own routes: a body that still carries them is taken without them.
		const parsed = parseSettingsBody({ ...body(), notRunning: ['x', 'x'] });
		expect(parsed).toEqual(body());
		const saved = { ...NO_SETTINGS, notRunning: ['1001'] };
		expect(applyBody(saved, { ...body(), notRunning: [] } as SettingsBody).notRunning).toEqual(['1001']);
	});

	it('keeps the saved password when the body has none', () => {
		const saved = { ...NO_SETTINGS, batocera: { ...NO_BATOCERA, password: 'pa ss' } };
		expect(applyBody(saved, body()).batocera.password).toBe('pa ss');
		expect(applyBody(saved, body({ password: 'new' })).batocera.password).toBe('new');
	});

	it('ends "set up" when the address, the user or the password change, and only then', () => {
		const saved = { ...NO_SETTINGS, batocera: { ...NO_BATOCERA, on: true, address: '10.0.0.21', ready: true, hostKey: KEY, mac: MAC } };
		expect(applyBody(saved, body({ wake: true, shutdown: true })).batocera.ready).toBe(true);
		expect(applyBody(saved, body({ address: '10.0.0.22' })).batocera.ready).toBe(false);
		expect(applyBody(saved, body({ user: 'canvas' })).batocera.ready).toBe(false);
		expect(applyBody(saved, body({ password: 'other' })).batocera.ready).toBe(false);
		expect(applyBody(saved, body({ address: '10.0.0.22' })).batocera).toMatchObject({ hostKey: KEY, mac: MAC });
	});

	it('turns a preferred Batocera into Autoselect when the switch is off, and only then', () => {
		expect(applyBody(NO_SETTINGS, body({ on: false }, { preferred: 'batocera' })).preferred).toBe('auto');
		expect(applyBody(NO_SETTINGS, body({ on: true }, { preferred: 'batocera' })).preferred).toBe('batocera');
		expect(applyBody(NO_SETTINGS, body({ on: false }, { preferred: 'linux' })).preferred).toBe('linux');
	});

	it('never puts the password into an answer', () => {
		const s = { ...NO_SETTINGS, batocera: { ...NO_BATOCERA, password: 'secret-word' } };
		const answer = toAnswer(s, '2026-11-19T00:00:00.000Z', true, STACK, STACK);
		expect(JSON.stringify(answer)).not.toContain('secret-word');
		expect(answer.batocera.passwordSaved).toBe(true);
	});
});

describe('the Server settings', () => {
	const chosen = { rebuildAt: '05:15', timeZone: 'Europe/Berlin', versionCheck: false };
	const body = (server?: unknown) => ({
		defaults: NOTHING_REMEMBERED,
		theo: false,
		preferred: 'auto',
		batocera: { on: false, address: '', user: 'root', wake: false, shutdown: false },
		...(server === undefined ? {} : { server })
	});

	it('takes a server part, and refuses one that is not valid', () => {
		expect(parseSettingsBody(body(chosen))?.server).toEqual(chosen);
		expect(parseSettingsBody(body(NO_SERVER))?.server).toEqual(NO_SERVER);
		for (const part of [{ rebuildAt: '5:15' }, { rebuildAt: '24:00' }, { timeZone: 'Mars/Olympus' }, { versionCheck: 'yes' }]) {
			expect(parseSettingsBody(body({ ...chosen, ...part })), JSON.stringify(part)).toBeNull();
		}
	});

	it('takes a body without a server part, as an older open page sends it', () => {
		const parsed = parseSettingsBody(body());
		expect(parsed).not.toBeNull();
		expect(parsed).not.toHaveProperty('server');
	});

	it("keeps the saved server part when the body has none, and takes the body's when it has one", () => {
		const saved = { ...NO_SETTINGS, server: chosen };
		expect(applyBody(saved, parseSettingsBody(body())!).server).toEqual(chosen);
		expect(applyBody(saved, parseSettingsBody(body(NO_SERVER))!).server).toEqual(NO_SERVER);
	});

	it("puts each stored value in effect, else the stack's", () => {
		expect(serverInEffect({ rebuildAt: null, timeZone: 'Asia/Tokyo', versionCheck: null }, STACK)).toEqual({
			rebuildAt: '04:30',
			timeZone: 'Asia/Tokyo',
			versionCheck: true
		});
	});

	it('answers the stored values and the ones in effect, and still no password', () => {
		const s = { ...NO_SETTINGS, server: chosen, batocera: { ...NO_BATOCERA, password: 'secret-word' } };
		const inEffect = serverInEffect(chosen, STACK);
		const answer = toAnswer(s, '2026-11-19T00:00:00.000Z', true, inEffect, STACK);
		expect(answer.server).toEqual(chosen);
		expect(answer.inEffect).toEqual(chosen);
		expect(JSON.stringify(answer)).not.toContain('secret-word');
	});
});
