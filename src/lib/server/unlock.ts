import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** The cookie that keeps a browser unlocked. Spec 0.11.0, section 2.4. */
export const UNLOCK_COOKIE = 'canvas-settings';

/** How long a browser stays unlocked: 30 days. */
export const UNLOCK_SECONDS = 2_592_000;

/** `<expiry>.<signature>`: up to 12 digits of Unix time, then the HMAC-SHA256 in hex. */
const VALUE = /^(\d{1,12})\.([0-9a-f]{64})$/;

/** The signature of an expiry, keyed with the PIN, so a new PIN locks every browser. */
function sign(pin: string, expiry: string): Buffer {
	return createHmac('sha256', pin).update(expiry).digest();
}

/** The value of the cookie for a browser unlocked until `expiry`, in seconds of Unix time. */
export function unlockValue(pin: string, expiry: number): string {
	return `${expiry}.${sign(pin, String(expiry)).toString('hex')}`;
}

/**
 * When the browser with this cookie stops being unlocked, as an ISO time, or null while it is
 * locked: no PIN, no cookie, a signature that does not match, or an expiry that has passed.
 */
export function unlockedUntil(pin: string | null, value: string | undefined, now = Date.now()): string | null {
	if (!pin || !value) return null;
	const match = VALUE.exec(value);
	if (!match) return null;
	const [, expiry, signature] = match;
	const given = Buffer.from(signature, 'hex');
	const expected = sign(pin, expiry);
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
	const until = Number(expiry) * 1000;
	return until > now ? new Date(until).toISOString() : null;
}

const digest = (text: string): Buffer => createHash('sha256').update(text).digest();

/** True when what was typed is the PIN, spaces around it aside. Compared in constant time. */
export function isPin(pin: string, typed: unknown): boolean {
	if (typeof typed !== 'string') return false;
	return timingSafeEqual(digest(pin), digest(typed.trim()));
}
