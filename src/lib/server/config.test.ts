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
			cacheDir: '/cache'
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
