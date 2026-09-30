import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE } from './search/state';
import { NOTHING_REMEMBERED, parseRemembered, nextRemembered, recall, rememberedCookie } from './remember';

describe('what the browser remembers', () => {
	it('is nothing without a cookie', () => {
		expect(parseRemembered(undefined)).toEqual(NOTHING_REMEMBERED);
		expect(parseRemembered('')).toEqual({ os: [], sort: 'title' });
	});

	it('reads back what was written', () => {
		const cookie = rememberedCookie({ os: ['linux', 'macos'], sort: 'recent' });
		expect(cookie).toBe('canvas-view=linux+macos|recent; Max-Age=31536000; Path=/; SameSite=Lax');
		const value = cookie.split(';')[0].split('=')[1];
		expect(parseRemembered(value)).toEqual({ os: ['macos', 'linux'], sort: 'recent' });
	});

	it('drops what it does not know', () => {
		expect(parseRemembered('amiga+linux+linux+constructor|price')).toEqual({ os: ['linux'], sort: 'title' });
		expect(parseRemembered('|')).toEqual({ os: [], sort: 'title' });
		expect(parseRemembered('<script>|recent|more')).toEqual({ os: [], sort: 'recent' });
	});

	it('recalls the cookie out of the whole cookie text', () => {
		const linux = { os: ['linux'], sort: 'recent' };
		expect(recall('canvas-view=linux|recent')).toEqual(linux);
		expect(recall('other=1; canvas-view=linux|recent')).toEqual(linux);
		expect(recall('canvas-view=linux|recent; other=1')).toEqual(linux);
		expect(recall('a=1; canvas-view=linux|recent; b=2')).toEqual(linux);
		expect(recall('')).toEqual(NOTHING_REMEMBERED);
		expect(recall('other=1')).toEqual(NOTHING_REMEMBERED);
		expect(recall('canvas-view=<script>|x')).toEqual(NOTHING_REMEMBERED);
		expect(recall('xcanvas-view=linux|recent')).toEqual(NOTHING_REMEMBERED);
		expect(recall('a=1; xcanvas-view=linux|recent')).toEqual(NOTHING_REMEMBERED);
	});

	it('changes only the part the visitor changed, and keeps the rest as it was remembered', () => {
		const kept = { os: ['macos' as const], sort: 'title' as const };
		const shared = { ...DEFAULT_STATE, os: ['linux' as const] };
		// A search, a genre or a way of playing changes nothing that is remembered.
		expect(nextRemembered(kept, shared, { ...shared, q: 'road' })).toBeNull();
		expect(nextRemembered(kept, shared, { ...shared, genres: ['Strategy'], together: ['coop'] })).toBeNull();
		// The order changes: the platform stays as it was remembered, not as the address had it.
		expect(nextRemembered(kept, shared, { ...shared, sort: 'recent' })).toEqual({ os: ['macos'], sort: 'recent' });
		// The platforms change: the order stays as it was remembered.
		const recent = { ...DEFAULT_STATE, sort: 'recent' as const };
		expect(nextRemembered(kept, recent, { ...recent, os: ['windows'] })).toEqual({ os: ['windows'], sort: 'title' });
		expect(nextRemembered(kept, shared, { ...shared, os: [] })).toEqual({ os: [], sort: 'title' });
	});
});
