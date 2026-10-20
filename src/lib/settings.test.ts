import { describe, expect, it } from 'vitest';
import { parseSettingsBody } from './settings';

describe('the body of a change of the settings', () => {
	const valid = { defaults: { os: ['linux', 'windows'], sort: 'recent', grouped: true, hide18: false }, theo: true };
	const withDefaults = (part: Record<string, unknown>) => ({ ...valid, defaults: { ...valid.defaults, ...part } });

	it('takes a valid body and refuses any part that is not valid', () => {
		// The platforms in the fixed order.
		const settings = { defaults: { os: ['windows', 'linux'], sort: 'recent', grouped: true, hide18: false }, theo: true };
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
