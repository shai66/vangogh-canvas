import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE } from './search/state';
import { NOTHING_REMEMBERED, parseRemembered, nextRemembered, recall, rememberedCookie } from './remember';

describe('what the browser remembers', () => {
	it('remembers the sort order by release year', () => {
		expect(parseRemembered('linux|year')).toEqual({ os: ['linux'], sort: 'year', grouped: false, hide18: false });
	});

	it('is nothing without a cookie', () => {
		expect(parseRemembered(undefined)).toEqual(NOTHING_REMEMBERED);
		expect(parseRemembered('')).toEqual({ os: [], sort: 'title', grouped: false, hide18: false });
	});

	it('reads back what was written', () => {
		const cookie = rememberedCookie({ os: ['linux', 'macos'], sort: 'recent', grouped: false, hide18: false });
		expect(cookie).toBe('canvas-view=linux+macos|recent; Max-Age=31536000; Path=/; SameSite=Lax');
		const value = cookie.split(';')[0].split('=')[1];
		expect(parseRemembered(value)).toEqual({ os: ['macos', 'linux'], sort: 'recent', grouped: false, hide18: false });
	});

	// Review focus 2
	it('remembers the collections toggle as a third part, and reads a cookie of 0.8.0 or a strange third part as off', () => {
		expect(rememberedCookie({ os: ['linux'], sort: 'recent', grouped: true, hide18: false })).toBe(
			'canvas-view=linux|recent|collections; Max-Age=31536000; Path=/; SameSite=Lax'
		);
		expect(parseRemembered('linux|recent|collections')).toEqual({ os: ['linux'], sort: 'recent', grouped: true, hide18: false });
		expect(parseRemembered('||collections')).toEqual({ os: [], sort: 'title', grouped: true, hide18: false });
		expect(parseRemembered('linux|recent')).toEqual({ os: ['linux'], sort: 'recent', grouped: false, hide18: false });
		expect(parseRemembered('linux|recent|Collections')).toEqual({ os: ['linux'], sort: 'recent', grouped: false, hide18: false });
		expect(parseRemembered('linux|recent|<script>')).toEqual({ os: ['linux'], sort: 'recent', grouped: false, hide18: false });
	});

	it('drops what it does not know', () => {
		expect(parseRemembered('amiga+linux+linux+constructor|price')).toEqual({ os: ['linux'], sort: 'title', grouped: false, hide18: false });
		expect(parseRemembered('|')).toEqual({ os: [], sort: 'title', grouped: false, hide18: false });
		expect(parseRemembered('<script>|recent|more')).toEqual({ os: [], sort: 'recent', grouped: false, hide18: false });
	});

	it('recalls the cookie out of the whole cookie text', () => {
		const linux = { os: ['linux'], sort: 'recent', grouped: false, hide18: false };
		expect(recall('canvas-view=linux|recent')).toEqual(linux);
		expect(recall('other=1; canvas-view=linux|recent')).toEqual(linux);
		expect(recall('canvas-view=linux|recent; other=1')).toEqual(linux);
		expect(recall('a=1; canvas-view=linux|recent; b=2')).toEqual(linux);
		expect(recall('canvas-view=linux|recent|collections')).toEqual({ ...linux, grouped: true });
		expect(recall('')).toEqual(NOTHING_REMEMBERED);
		expect(recall('other=1')).toEqual(NOTHING_REMEMBERED);
		expect(recall('canvas-view=<script>|x')).toEqual(NOTHING_REMEMBERED);
		expect(recall('xcanvas-view=linux|recent')).toEqual(NOTHING_REMEMBERED);
		expect(recall('a=1; xcanvas-view=linux|recent')).toEqual(NOTHING_REMEMBERED);
	});

	it('changes only the part the visitor changed, and keeps the rest as it was remembered', () => {
		const kept = { os: ['macos' as const], sort: 'title' as const, grouped: false, hide18: false };
		const shared = { ...DEFAULT_STATE, os: ['linux' as const] };
		// A search, a genre or a way of playing changes nothing that is remembered.
		expect(nextRemembered(kept, shared, { ...shared, q: 'road' })).toBeNull();
		expect(nextRemembered(kept, shared, { ...shared, genres: ['Strategy'], together: ['coop'] })).toBeNull();
		// The order changes: the platform stays as it was remembered, not as the address had it.
		expect(nextRemembered(kept, shared, { ...shared, sort: 'recent' })).toEqual({ os: ['macos'], sort: 'recent', grouped: false, hide18: false });
		// The platforms change: the order stays as it was remembered.
		const recent = { ...DEFAULT_STATE, sort: 'recent' as const };
		expect(nextRemembered(kept, recent, { ...recent, os: ['windows'] })).toEqual({ os: ['windows'], sort: 'title', grouped: false, hide18: false });
		expect(nextRemembered(kept, shared, { ...shared, os: [] })).toEqual({ os: [], sort: 'title', grouped: false, hide18: false });
	});

	it('changes the toggle only when the visitor switches it, and keeps the rest as it was remembered', () => {
		const kept = { os: ['macos' as const], sort: 'recent' as const, grouped: false, hide18: false };
		// An address that has the toggle on does not change what is remembered of it.
		const shared = { ...DEFAULT_STATE, os: ['linux' as const], grouped: true };
		expect(nextRemembered(kept, shared, { ...shared, q: 'dusk' })).toBeNull();
		expect(nextRemembered(kept, shared, { ...shared, grouped: false })).toEqual({ os: ['macos'], sort: 'recent', grouped: false, hide18: false });
		expect(nextRemembered(kept, DEFAULT_STATE, { ...DEFAULT_STATE, grouped: true })).toEqual({ os: ['macos'], sort: 'recent', grouped: true, hide18: false });
	});

	// Review focus 3
	it('remembers the chip as a fourth flag, and reads a cookie of 0.9.0 with the chip off, and nonsense flags as off', () => {
		expect(rememberedCookie({ os: ['linux'], sort: 'recent', grouped: true, hide18: true })).toBe(
			'canvas-view=linux|recent|collections|hide18; Max-Age=31536000; Path=/; SameSite=Lax'
		);
		expect(rememberedCookie({ os: [], sort: 'title', grouped: false, hide18: true })).toBe(
			'canvas-view=|title|hide18; Max-Age=31536000; Path=/; SameSite=Lax'
		);
		expect(parseRemembered('linux|recent|collections|hide18')).toEqual({ os: ['linux'], sort: 'recent', grouped: true, hide18: true });
		expect(parseRemembered('|title|hide18')).toEqual({ os: [], sort: 'title', grouped: false, hide18: true });
		expect(parseRemembered('linux|recent|collections')).toEqual({ os: ['linux'], sort: 'recent', grouped: true, hide18: false });
		expect(parseRemembered('linux|recent')).toEqual({ os: ['linux'], sort: 'recent', grouped: false, hide18: false });
		expect(parseRemembered('linux|recent|Hide18|x')).toEqual({ os: ['linux'], sort: 'recent', grouped: false, hide18: false });
		// The flags are read by name wherever they stand.
		expect(parseRemembered('|title|hide18|collections')).toEqual({ os: [], sort: 'title', grouped: true, hide18: true });
	});

	it('changes the chip only when the visitor switches it, and keeps the rest as it was remembered', () => {
		const remembered = { os: ['macos' as const], sort: 'recent' as const, grouped: true, hide18: false };
		const before = { ...DEFAULT_STATE, q: 'road' };
		expect(nextRemembered(remembered, before, { ...before, hide18: true })).toEqual({ os: ['macos'], sort: 'recent', grouped: true, hide18: true });
		expect(nextRemembered(remembered, { ...before, hide18: true }, { ...before, hide18: false })).toEqual({ os: ['macos'], sort: 'recent', grouped: true, hide18: false });
		expect(nextRemembered(remembered, before, { ...before, q: 'dark' })).toBeNull();
	});
});
