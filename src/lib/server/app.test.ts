import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { silentLogger } from './log';
import { SettingsStore } from './settings';

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
});
