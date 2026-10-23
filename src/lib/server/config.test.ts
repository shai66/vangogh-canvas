import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

const required = {
	VANGOGH_URL: 'http://vangogh.lan:1853/',
	VANGOGH_USERNAME: 'api',
	VANGOGH_PASSWORD: 'secret'
};

describe('loadConfig', () => {
	it('applies the defaults', () => {
		expect(loadConfig(required)).toEqual({
			vangoghUrl: 'http://vangogh.lan:1853',
			username: 'api',
			password: 'secret',
			rebuildAt: '04:30',
			timeZone: 'UTC',
			customLogo: null,
			cacheDir: '/cache',
			versionCheck: true,
			versionCheckUrl: 'https://api.github.com/repos/shai66/vangogh-canvas/releases/latest',
			settingsPin: null,
			settingsDir: '/settings',
			batoceraPort: 22,
			wakeTo: null,
			shutdownSeconds: 600
		});
	});

	it('ignores SOURCE_URL, a setting of versions before 0.6.0', () => {
		const config = loadConfig({ ...required, SOURCE_URL: 'javascript:alert(1)' });
		expect(config).not.toHaveProperty('sourceUrl');
	});

	it('reads the optional variables', () => {
		const config = loadConfig({
			...required,
			REBUILD_AT: '23:05',
			TZ: 'Europe/Bratislava',
			CUSTOM_LOGO: '/logo/vangog.svg',
			CACHE_DIR: '/tmp/cache'
		});
		expect(config).toMatchObject({
			rebuildAt: '23:05',
			timeZone: 'Europe/Bratislava',
			customLogo: '/logo/vangog.svg',
			cacheDir: '/tmp/cache'
		});
	});

	it('switches the version check off for off, false and 0, in any case, and keeps it on for anything else', () => {
		for (const value of ['off', 'OFF', 'false', 'False', '0']) {
			expect(loadConfig({ ...required, VERSION_CHECK: value }).versionCheck).toBe(false);
		}
		for (const value of ['on', 'true', '1', 'yes', '']) {
			expect(loadConfig({ ...required, VERSION_CHECK: value }).versionCheck).toBe(true);
		}
	});

	it('takes another address for the version check, for the tests', () => {
		expect(loadConfig({ ...required, VERSION_CHECK_URL: 'http://127.0.0.1:9/releases/latest' }).versionCheckUrl).toBe('http://127.0.0.1:9/releases/latest');
		expect(() => loadConfig({ ...required, VERSION_CHECK_URL: 'ftp://x' })).toThrow(ConfigError);
		expect(loadConfig({ ...required, VERSION_CHECK: 'off', VERSION_CHECK_URL: 'ftp://x' }).versionCheck).toBe(false);
	});

	it('reads the address of the version check with the check off too, and checks it only while the check is on', () => {
		expect(loadConfig({ ...required, VERSION_CHECK: 'off', VERSION_CHECK_URL: 'http://127.0.0.1:9/latest' }).versionCheckUrl).toBe('http://127.0.0.1:9/latest');
		// The settings may switch the check on later: then it asks GitHub.
		expect(loadConfig({ ...required, VERSION_CHECK: 'off', VERSION_CHECK_URL: 'ftp://x' }).versionCheckUrl).toBe(
			'https://api.github.com/repos/shai66/vangogh-canvas/releases/latest'
		);
		expect(() => loadConfig({ ...required, VERSION_CHECK_URL: 'ftp://x' })).toThrow('VERSION_CHECK_URL must be an http or https address');
	});

	it('leaves settings off when SETTINGS_PIN is unset or empty', () => {
		expect(loadConfig(required).settingsPin).toBeNull();
		expect(loadConfig({ ...required, SETTINGS_PIN: '  ' }).settingsPin).toBeNull();
	});

	it('reads a SETTINGS_PIN of 4 to 8 digits, trimmed', () => {
		expect(loadConfig({ ...required, SETTINGS_PIN: '2468' }).settingsPin).toBe('2468');
		expect(loadConfig({ ...required, SETTINGS_PIN: ' 12345678 ' }).settingsPin).toBe('12345678');
	});

	it('refuses a SETTINGS_PIN that is not 4 to 8 digits', () => {
		for (const pin of ['123', '123456789', 'abcd', '12 34', '-1234'])
			expect(() => loadConfig({ ...required, SETTINGS_PIN: pin }), pin).toThrow('SETTINGS_PIN must be 4 to 8 digits');
	});

	it('keeps the settings in /settings unless SETTINGS_DIR says otherwise', () => {
		expect(loadConfig(required).settingsDir).toBe('/settings');
		expect(loadConfig({ ...required, SETTINGS_DIR: '/data/canvas' }).settingsDir).toBe('/data/canvas');
	});

	it("reads the settings of Batocera's work and of its tests", () => {
		const config = loadConfig({
			...required,
			BATOCERA_PORT: '2222',
			BATOCERA_WAKE_TO: '127.0.0.1:40009',
			BATOCERA_SHUTDOWN_SECONDS: '4'
		});
		expect(config).toMatchObject({
			batoceraPort: 2222,
			wakeTo: '127.0.0.1:40009',
			shutdownSeconds: 4
		});
	});

	it('refuses a BATOCERA_PORT that is not a port number', () => {
		for (const port of ['70000', 'abc', '0'])
			expect(() => loadConfig({ ...required, BATOCERA_PORT: port }), port).toThrow('BATOCERA_PORT must be a port number');
	});

	it('refuses a BATOCERA_SHUTDOWN_SECONDS that is not a whole number of at least 1', () => {
		for (const seconds of ['0', '1.5', 'abc'])
			expect(() => loadConfig({ ...required, BATOCERA_SHUTDOWN_SECONDS: seconds }), seconds).toThrow(
				'BATOCERA_SHUTDOWN_SECONDS must be a whole number of seconds'
			);
	});

	it('refuses a BATOCERA_SHUTDOWN_SECONDS above a day, which a timer cannot wait', () => {
		expect(loadConfig({ ...required, BATOCERA_SHUTDOWN_SECONDS: '86400' }).shutdownSeconds).toBe(86400);
		for (const seconds of ['86401', '99999999999'])
			expect(() => loadConfig({ ...required, BATOCERA_SHUTDOWN_SECONDS: seconds }), seconds).toThrow(
				'BATOCERA_SHUTDOWN_SECONDS must be a whole number of seconds'
			);
	});

	it('names every missing required variable', () => {
		expect(() => loadConfig({ VANGOGH_URL: 'http://x' })).toThrow(
			'Missing required environment variable(s): VANGOGH_USERNAME, VANGOGH_PASSWORD'
		);
	});

	it('treats a blank value as missing', () => {
		expect(() => loadConfig({ ...required, VANGOGH_PASSWORD: '  ' })).toThrow(ConfigError);
	});

	it('rejects an address that is not http or https', () => {
		expect(() => loadConfig({ ...required, VANGOGH_URL: 'ftp://x' })).toThrow(
			'VANGOGH_URL must be an http or https address'
		);
		expect(() => loadConfig({ ...required, VANGOGH_URL: 'not an address' })).toThrow(ConfigError);
	});

	it.each([['http://api:hunter2@vangogh.lan:1853'], ['http://api@vangogh.lan:1853'], ['http://:hunter2@vangogh.lan']])(
		'rejects an address with credentials, without repeating them: %s',
		(url) => {
			let message = '';
			try {
				loadConfig({ ...required, VANGOGH_URL: url });
			} catch (error) {
				expect(error).toBeInstanceOf(ConfigError);
				message = String(error);
			}
			expect(message).toContain('VANGOGH_URL must not contain a username or password');
			expect(message).not.toContain('hunter2');
			expect(message).not.toContain('api@');
		}
	);

	it('rejects a malformed time', () => {
		expect(() => loadConfig({ ...required, REBUILD_AT: '24:00' })).toThrow(
			'REBUILD_AT must be a time as HH:MM'
		);
		expect(() => loadConfig({ ...required, REBUILD_AT: '4:30' })).toThrow(ConfigError);
	});

	it('rejects an unknown time zone', () => {
		expect(() => loadConfig({ ...required, TZ: 'Mars/Olympus' })).toThrow(
			'TZ is not a known time zone'
		);
	});

	it('does not put the password into an error message', () => {
		try {
			loadConfig({ ...required, REBUILD_AT: 'x' });
			expect.unreachable();
		} catch (error) {
			expect(String(error)).not.toContain('secret');
		}
	});
});
