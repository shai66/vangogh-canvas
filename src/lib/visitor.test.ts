import { describe, expect, it } from 'vitest';
import { detectVisitor } from './visitor';

const UA = {
	windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
	mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
	linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
	android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
	iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
	chromeos: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
};

describe('detectVisitor', () => {
	it.each([
		[UA.windows, 'windows'],
		[UA.mac, 'macos'],
		[UA.linux, 'linux'],
		[UA.android, 'phone'],
		[UA.iphone, 'phone'],
		[UA.chromeos, 'other']
	])('reads %s as %s', (userAgent, visitor) => {
		expect(detectVisitor(userAgent)).toBe(visitor);
	});

	it('tells an iPad from a Mac by its touch screen', () => {
		expect(detectVisitor(UA.mac, 5)).toBe('phone');
		expect(detectVisitor(UA.mac, 0)).toBe('macos');
		// A Windows laptop with a touch screen stays a computer.
		expect(detectVisitor(UA.windows, 10)).toBe('windows');
	});

	it('gives "other" for a user agent it cannot read', () => {
		expect(detectVisitor('')).toBe('other');
		expect(detectVisitor('curl/8.7.1')).toBe('other');
	});
});
