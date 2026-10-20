import { describe, expect, it } from 'vitest';
import { isPin, UNLOCK_SECONDS, unlockedUntil, unlockValue } from './unlock';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const until = Math.floor(NOW / 1000) + UNLOCK_SECONDS;

describe('the unlock cookie', () => {
	it('unlocks with its own cookie until it expires', () => {
		const value = unlockValue('2468', until);
		expect(value).toMatch(/^\d+\.[0-9a-f]{64}$/);
		expect(unlockedUntil('2468', value, NOW)).toBe('2026-11-19T12:00:00.000Z');
		expect(unlockedUntil('2468', value, until * 1000)).toBeNull();
	});

	it('refuses a cookie of another PIN, a changed expiry or signature, and rubbish', () => {
		const value = unlockValue('2468', until);
		const [expiry, signature] = value.split('.');
		expect(unlockedUntil('1357', value, NOW)).toBeNull();
		expect(unlockedUntil('2468', `${Number(expiry) + 1}.${signature}`, NOW)).toBeNull();
		expect(unlockedUntil('2468', `${expiry}.${'0'.repeat(64)}`, NOW)).toBeNull();
		for (const rubbish of [undefined, '', 'abc', '1.2.3', `${expiry}.`, `.${signature}`]) expect(unlockedUntil('2468', rubbish, NOW)).toBeNull();
		expect(unlockedUntil(null, value, NOW)).toBeNull();
	});

	// Review focus 1
	it('accepts the PIN with spaces around it', () => {
		expect(isPin('2468', ' 2468\n')).toBe(true);
		expect(isPin('2468', '2469')).toBe(false);
		expect(isPin('2468', '24680')).toBe(false);
		expect(isPin('2468', 2468)).toBe(false);
		expect(isPin('2468', undefined)).toBe(false);
	});
});
