import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileTarget } from './index-types';
import { fileId } from './indexer';
import { createLogger } from './log';
import { contentDisposition, proxyFile, proxyImage } from './proxy';
import { startFakeVangogh, type FakeVangogh } from './testing/fake-vangogh';
import { POSTER } from './testing/fixtures';
import { VangoghClient, type VangoghFiles } from './vangogh/client';

let fake: FakeVangogh;
let client: VangoghClient;

const target: FileTarget = {
	productId: '1002',
	downloadType: 'installer',
	manualUrl: '/downloads/windows_only_game/en1installer0',
	filename: 'setup_windows_only_game_1.0.exe'
};

const request = (headers: Record<string, string> = {}, signal?: AbortSignal) =>
	new Request('http://canvas.test/x', { headers, signal });

beforeEach(async () => {
	fake = await startFakeVangogh();
	client = new VangoghClient({ url: fake.url, username: 'api', password: 'secret' });
});
afterEach(async () => {
	await fake.close();
});

describe('proxyImage', () => {
	it('passes an image through and lets the browser keep it', async () => {
		const res = await proxyImage(client, POSTER['1001'], request());
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/jpeg');
		expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
		expect(res.headers.get('last-modified')).toBe('Tue, 01 Sep 2026 10:00:00 GMT');
		expect(await res.text()).toBe('poster 1001');
	});

	it('refuses an id of another format without asking vangogh', async () => {
		for (const id of ['short', '../metadata/gog-other-record/1', 'a'.repeat(200), '']) {
			const res = await proxyImage(client, id, request());
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({ error: 'bad-image-id' });
		}
		expect(fake.requests).toEqual([]);
	});

	it('answers 404 for an image vangogh does not have, and does not let it be kept', async () => {
		const res = await proxyImage(client, 'f'.repeat(64), request());
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'image-missing' });
		expect(res.headers.get('cache-control')).toBe('no-store');
	});

	it('answers 304 when the browser already has the image', async () => {
		const res = await proxyImage(
			client,
			POSTER['1001'],
			request({ 'if-modified-since': 'Tue, 01 Sep 2026 10:00:00 GMT' })
		);
		expect(res.status).toBe(304);
		expect(await res.text()).toBe('');
	});

	it('answers 502 when vangogh is down', async () => {
		fake.down = true;
		const res = await proxyImage(client, POSTER['1001'], request());
		expect(res.status).toBe(502);
		expect(await res.json()).toEqual({ error: 'archive-unreachable' });
	});
});

describe('proxyFile', () => {
	it('sends the whole file as an attachment with its real name', async () => {
		const res = await proxyFile(client, target, request());
		expect(res.status).toBe(200);
		expect(res.headers.get('content-disposition')).toBe(
			`attachment; filename="setup_windows_only_game_1.0.exe"; filename*=UTF-8''setup_windows_only_game_1.0.exe`
		);
		expect(res.headers.get('accept-ranges')).toBe('bytes');
		expect(res.headers.get('content-type')).toBe('application/octet-stream');
		expect(res.headers.get('cache-control')).toBe('no-store');
		const body = await res.text();
		expect(body).toContain('setup_windows_only_game_1.0.exe');
		expect(res.headers.get('content-length')).toBe(String(body.length));
	});

	it('passes a range through, so a download can be resumed', async () => {
		const res = await proxyFile(client, target, request({ range: 'bytes=8-9' }));
		expect(res.status).toBe(206);
		expect(res.headers.get('content-range')).toMatch(/^bytes 8-9\/\d+$/);
		expect(await res.text()).toBe('of');
	});

	it('passes on that a range cannot be served', async () => {
		const res = await proxyFile(client, target, request({ range: 'bytes=99999-' }));
		expect(res.status).toBe(416);
		expect(res.headers.get('content-range')).toMatch(/^bytes \*\/\d+$/);
		expect(res.headers.get('accept-ranges')).toBe('bytes');
		expect(res.headers.get('content-length')).toBeNull();
		expect(res.headers.get('content-type')).toBeNull();
		expect(res.headers.get('content-disposition')).toBeNull();
		expect(await res.text()).toBe('');
	});

	it('closes the answer of vangogh when a range cannot be served', async () => {
		const cancel = vi.fn(async () => {});
		const upstream = new Response('invalid range', {
			status: 416,
			headers: { 'content-range': 'bytes */80', 'content-length': '13' }
		});
		Object.defineProperty(upstream, 'body', { value: { cancel } });
		const stub: VangoghFiles = { image: vi.fn(), file: vi.fn(async () => upstream) };
		const res = await proxyFile(stub, target, request({ range: 'bytes=99999-' }));
		expect(res.status).toBe(416);
		expect(cancel).toHaveBeenCalledOnce();
	});

	// Review focus 5
	it.each([['bytes=abc'], ['items=0-5'], ['bytes=0-5\r\nx-evil: 1'], ['bytes=-'], ['']])(
		'ignores the malformed range %j',
		async (range) => {
			const headers = new Headers();
			try {
				headers.set('range', range);
			} catch {
				// A header the platform refuses cannot reach the proxy at all.
			}
			const res = await proxyFile(
				client,
				target,
				new Request('http://canvas.test/x', { headers })
			);
			expect(res.status).toBe(200);
			expect(fake.seen.at(-1)?.range).toBeNull();
		}
	);

	it('resumes a download when the file is still the one the browser has', async () => {
		const res = await proxyFile(
			client,
			target,
			request({ range: 'bytes=8-9', 'if-range': 'Tue, 01 Sep 2026 10:00:00 GMT' })
		);
		expect(res.status).toBe(206);
		expect(await res.text()).toBe('of');
		expect(fake.seen.at(-1)).toMatchObject({
			range: 'bytes=8-9',
			ifRange: 'Tue, 01 Sep 2026 10:00:00 GMT'
		});
	});

	it('sends the whole file when it changed since the browser got its first part', async () => {
		const res = await proxyFile(
			client,
			target,
			request({ range: 'bytes=8-9', 'if-range': 'Mon, 01 Jan 2024 00:00:00 GMT' })
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-range')).toBeNull();
		expect(await res.text()).toBe(fake.data.files[`1002/installer/downloads/windows_only_game/en1installer0`].body.toString());
	});

	it('does not forward If-Range without a range', async () => {
		const res = await proxyFile(
			client,
			target,
			request({ 'if-range': 'Tue, 01 Sep 2026 10:00:00 GMT' })
		);
		expect(res.status).toBe(200);
		expect(fake.seen.at(-1)).toMatchObject({ range: null, ifRange: null });
	});

	it('does not forward If-Range with a malformed range', async () => {
		const res = await proxyFile(
			client,
			target,
			request({ range: 'bytes=abc', 'if-range': 'Tue, 01 Sep 2026 10:00:00 GMT' })
		);
		expect(res.status).toBe(200);
		expect(fake.seen.at(-1)).toMatchObject({ range: null, ifRange: null });
	});

	it.each([['x'.repeat(201)], ['"abc\u0001"'], ['Tue, 01 Sep\t2026 10:00:00 GMT']])(
		'drops the range together with the If-Range %j',
		async (ifRange) => {
			const res = await proxyFile(client, target, request({ range: 'bytes=8-9', 'if-range': ifRange }));
			expect(res.status).toBe(200);
			expect(fake.seen.at(-1)).toMatchObject({ range: null, ifRange: null });
		}
	);

	it('sends no If-Range when checking a file', async () => {
		const res = await proxyFile(
			client,
			target,
			request({ range: 'bytes=8-9', 'if-range': 'Mon, 01 Jan 2024 00:00:00 GMT' }),
			{ check: true }
		);
		expect(res.status).toBe(200);
		expect(fake.seen.at(-1)).toMatchObject({ range: 'bytes=0-0', ifRange: null });
	});

	it('checks an empty file as present', async () => {
		fake.data.files['1002/installer/downloads/windows_only_game/empty'] = {
			name: 'empty.txt',
			body: Buffer.alloc(0)
		};
		const res = await proxyFile(
			client,
			{ ...target, manualUrl: '/downloads/windows_only_game/empty' },
			request(),
			{ check: true }
		);
		expect(fake.seen.at(-1)?.range).toBe('bytes=0-0');
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(await res.text()).toBe('');
	});

	it('answers 404 for a file that is missing in the archive', async () => {
		const res = await proxyFile(client, { ...target, manualUrl: '/downloads/gone' }, request());
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'file-missing' });
	});

	it('answers 502 when vangogh is down', async () => {
		fake.down = true;
		const res = await proxyFile(client, target, request());
		expect(res.status).toBe(502);
		expect(await res.json()).toEqual({ error: 'archive-unreachable' });
	});

	it('answers 502 when the password was rejected', async () => {
		const wrong = new VangoghClient({ url: fake.url, username: 'api', password: 'wrong' });
		const res = await proxyFile(wrong, target, request());
		expect(res.status).toBe(502);
		expect(await res.json()).toEqual({ error: 'archive-unreachable' });
	});

	it('answers 502 and asks vangogh nothing for an address that would leave its route', async () => {
		const res = await proxyFile(
			client,
			{ ...target, manualUrl: '/../../metadata/gog-other-record/gog-other-record' },
			request()
		);
		expect(res.status).toBe(502);
		expect(await res.json()).toEqual({ error: 'archive-unreachable' });
		expect(fake.requests).toEqual([]);
	});

	it('checks a file without sending it', async () => {
		const res = await proxyFile(client, target, request(), { check: true });
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('');
		expect(fake.seen.at(-1)?.range).toBe('bytes=0-0');
	});

	it('reports a missing file when checking', async () => {
		const res = await proxyFile(client, { ...target, manualUrl: '/downloads/gone' }, request(), {
			check: true
		});
		expect(res.status).toBe(404);
	});

	// Review focus 4
	it('hands the signal of the browser to vangogh, so a cancelled download is cancelled there', async () => {
		const file = vi.fn<VangoghFiles['file']>(async () => new Response('x'));
		const stub: VangoghFiles = { image: vi.fn(), file };
		const controller = new AbortController();
		const req = request({}, controller.signal);
		await proxyFile(stub, target, req);
		expect(file.mock.calls[0][1]?.signal).toBe(req.signal);
	});

	it('answers quietly when the browser is already gone', async () => {
		const controller = new AbortController();
		controller.abort();
		const res = await proxyFile(client, target, request({}, controller.signal));
		expect(res.status).toBe(499);
	});
});

describe('what the proxy logs', () => {
	let lines: string[];
	const log = () => createLogger((line) => lines.push(line));
	beforeEach(() => {
		lines = [];
	});

	function expectNothingSecret(): void {
		const all = lines.join('\n');
		for (const secret of [fake.url, '/api/', 'manual-url', '/downloads/', 'Bearer', 'token-', 'secret']) {
			expect(all).not.toContain(secret);
		}
	}

	it('logs an unreachable vangogh, with the code of the cause', async () => {
		fake.down = true;
		const res = await proxyImage(client, POSTER['1001'], request(), log());
		expect(res.status).toBe(502);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatch(/ WARN .*kind=unreachable/);
		expect(lines[0]).toContain('asked=image');
		expect(lines[0]).toMatch(/code=\S+/);
		expectNothingSecret();
	});

	it('logs a rejected login with the game and the file', async () => {
		const wrong = new VangoghClient({ url: fake.url, username: 'api', password: 'wrong' });
		const res = await proxyFile(wrong, target, request(), { log: log() });
		expect(res.status).toBe(502);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatch(/ WARN .*kind=login-rejected/);
		expect(lines[0]).toContain('asked=file');
		expect(lines[0]).toContain('gameId=1002');
		expect(lines[0]).toContain(`fileId=${fileId(target.manualUrl)}`);
		expectNothingSecret();
	});

	it('logs a status vangogh should not have answered', async () => {
		const stub: VangoghFiles = {
			image: vi.fn(async () => new Response('broken', { status: 500 })),
			file: vi.fn(async () => new Response('broken', { status: 503 }))
		};
		expect((await proxyImage(stub, POSTER['1001'], request(), log())).status).toBe(502);
		expect((await proxyFile(stub, target, request(), { log: log() })).status).toBe(502);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatch(/ WARN .*kind=status status=500 asked=image/);
		expect(lines[1]).toMatch(/ WARN .*kind=status status=503 asked=file gameId=1002/);
	});

	it('logs an address that was refused, without the address', async () => {
		const res = await proxyFile(
			client,
			{ ...target, manualUrl: '/../../metadata/gog-other-record/x' },
			request(),
			{ log: log() }
		);
		expect(res.status).toBe(502);
		expect(lines[0]).toMatch(/kind=status status=400 asked=file/);
		expect(lines.join('\n')).not.toContain('other-record');
		expectNothingSecret();
	});

	it('logs nothing for an answer that is fine, missing, or no longer wanted', async () => {
		await proxyImage(client, POSTER['1001'], request(), log());
		await proxyImage(client, 'f'.repeat(64), request(), log());
		await proxyFile(client, { ...target, manualUrl: '/downloads/gone' }, request(), { log: log() });
		const controller = new AbortController();
		controller.abort();
		await proxyFile(client, target, request({}, controller.signal), { log: log() });
		expect(lines).toEqual([]);
	});

	it('passes on only the image types a browser shows', async () => {
		for (const type of ['image/png', 'image/webp', 'image/gif', 'image/avif', 'IMAGE/JPEG; q=1']) {
			fake.data.images[POSTER['1001']] = { type, body: Buffer.from('img') };
			expect((await proxyImage(client, POSTER['1001'], request(), log())).status).toBe(200);
		}
		expect(lines).toEqual([]);
	});

	it.each([['text/html'], ['image/svg+xml'], ['application/octet-stream']])(
		'refuses an image sent as %s, and logs it',
		async (type) => {
			fake.data.images[POSTER['1001']] = { type, body: Buffer.from('<script>x</script>') };
			const res = await proxyImage(client, POSTER['1001'], request(), log());
			expect(res.status).toBe(502);
			expect(await res.json()).toEqual({ error: 'archive-unreachable' });
			expect(lines).toHaveLength(1);
			expect(lines[0]).toMatch(/ WARN .*kind=content-type asked=image/);
			expect(lines[0]).not.toContain(type);
		}
	);

	it('closes the answer of vangogh when it refuses an image', async () => {
		const cancel = vi.fn(async () => {});
		const upstream = new Response('x', { headers: { 'content-type': 'text/html' } });
		Object.defineProperty(upstream, 'body', { value: { cancel } });
		const stub: VangoghFiles = { image: vi.fn(async () => upstream), file: vi.fn() };
		expect((await proxyImage(stub, POSTER['1001'], request())).status).toBe(502);
		expect(cancel).toHaveBeenCalledOnce();
	});
});

describe('contentDisposition', () => {
	it('writes a plain name twice', () => {
		expect(contentDisposition('setup.exe')).toBe(
			`attachment; filename="setup.exe"; filename*=UTF-8''setup.exe`
		);
	});

	// Review focus 5
	it('keeps letters outside ASCII in the second form only', () => {
		expect(contentDisposition('hra šťastie.exe')).toBe(
			`attachment; filename="hra __astie.exe"; filename*=UTF-8''hra%20%C5%A1%C5%A5astie.exe`
		);
	});

	it('cannot be used to add a header or to leave the folder', () => {
		const value = contentDisposition('a"b\r\nSet-Cookie: x=1\\..\\../c.exe');
		expect(value).not.toMatch(/[\r\n]/);
		expect(value).toMatch(/^attachment; filename="[^"\\/]*"; filename\*=UTF-8''[^\s"\\/]*$/);
	});

	it('has a name even when there is none', () => {
		expect(contentDisposition('')).toBe(`attachment; filename="download"; filename*=UTF-8''download`);
	});

	it('has a name even when the file name cannot be encoded', () => {
		const value = contentDisposition('setup\ud800.exe');
		expect(value).toMatch(/^attachment; filename="setup_\.exe"; filename\*=UTF-8''\S+$/);
		expect(() => new Headers({ 'content-disposition': value })).not.toThrow();
	});
});
