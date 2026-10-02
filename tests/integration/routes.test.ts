import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Detail, IndexPayload } from '../../src/lib/types';
import {
	fixtureData,
	startFakeVangogh,
	type FakeVangogh
} from '../../src/lib/server/testing/fake-vangogh';
import { POSTER } from '../../src/lib/server/testing/fixtures';

const PASSWORD = 'pa55-w0rd-xyz';

let fake: FakeVangogh;
let child: ChildProcess;
let base: string;
let cacheDir: string;
let output = '';

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as { port: number };
			server.close(() => resolve(port));
		});
	});
}

function launch(env: Record<string, string>): ChildProcess {
	const started = spawn(process.execPath, ['build'], {
		env: { PATH: process.env.PATH ?? '', HOST: '127.0.0.1', ...env },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	started.stdout?.on('data', (chunk) => (output += chunk));
	started.stderr?.on('data', (chunk) => (output += chunk));
	return started;
}

function stop(started: ChildProcess | undefined): Promise<void> {
	return new Promise((resolve) => {
		if (!started || started.exitCode !== null || started.signalCode !== null) return resolve();
		started.once('exit', () => resolve());
		started.kill('SIGKILL');
	});
}

async function waitFor(check: () => Promise<boolean>, what: string): Promise<void> {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		if (await check().catch(() => false)) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`timed out waiting for ${what}. Output of the app:\n${output}`);
}

beforeAll(async () => {
	if (!existsSync('build/index.js')) throw new Error('run "npm run build" first');
	fake = await startFakeVangogh({ ...fixtureData(), password: PASSWORD });
	cacheDir = await mkdtemp(join(tmpdir(), 'canvas-it-'));
	const port = await freePort();
	base = `http://127.0.0.1:${port}`;
	child = launch({
		PORT: String(port),
		VANGOGH_URL: fake.url,
		VANGOGH_USERNAME: 'api',
		VANGOGH_PASSWORD: PASSWORD,
		CACHE_DIR: cacheDir
	});
	await waitFor(async () => (await fetch(`${base}/healthz`)).status === 200, 'the first index');
});

afterAll(async () => {
	await stop(child);
	await fake?.close();
	if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
});

async function firstFile(): Promise<string> {
	const detail = (await (await fetch(`${base}/api/games/1001`)).json()) as Detail;
	return detail.downloads.windows![0].fileId;
}

/** The key in `fake.data.files` of the first Windows file of 1001. */
const FIRST_FILE_KEY = '1001/installer/downloads/the_long_dark_road/en1installer0';

async function health(): Promise<{ login: string; rebuild: { running: boolean; lastResult: string } }> {
	return (await fetch(`${base}/healthz`)).json();
}

/** A request with the path exactly as given: nothing normalises it on the way. */
function rawRequest(method: string, path: string): Promise<number> {
	const { hostname, port } = new URL(base);
	return new Promise((resolve, reject) => {
		const req = httpRequest({ host: hostname, port, method, path }, (res) => {
			res.resume();
			res.on('end', () => resolve(res.statusCode ?? 0));
		});
		req.on('error', reject);
		req.end();
	});
}

describe('the pages, as the server draws them', () => {
	const page = async (path: string, headers: Record<string, string> = {}) => {
		const res = await fetch(`${base}${path}`, { headers });
		return { res, html: await res.text() };
	};

	/** The titles of the cards, in the order drawn. */
	const cards = (html: string) =>
		[...html.matchAll(/<h3 class="card-title"[^>]*><span>([^<]*)<\/span>/g)].map((m) => m[1]);

	it('draws the whole list without a script having run', async () => {
		const { res, html } = await page('/');
		expect(res.status).toBe(200);
		expect(cards(html)).toEqual(['Broken Record', 'Lonely Expansion', 'The Long Dark Road', 'Windows Only Game']);
		expect(html).toContain('<title>Canvas for vangogh</title>');
	});

	it('draws the view of the address', async () => {
		expect(cards((await page('/?q=road')).html)).toEqual(['The Long Dark Road']);
		expect(cards((await page('/?os=linux&sort=recent')).html)).toEqual(['The Long Dark Road']);
		expect(cards((await page('/?genre=Strategy&play=coop')).html)).toEqual([]);
	});

	it('draws the list as the browser remembers it, unless the address says otherwise', async () => {
		const cookie = { cookie: 'canvas-view=macos|recent' };
		expect(cards((await page('/', cookie)).html)).toEqual(['The Long Dark Road']);
		expect(cards((await page('/?q=record', cookie)).html)).toEqual(['Broken Record']);
		// A cookie that is not ours, or is nonsense, changes nothing.
		expect(cards((await page('/', { cookie: 'canvas-view=%3Cscript%3E|x; other=1' })).html)).toHaveLength(4);
	});

	it('shows what the visitor typed as text', async () => {
		const evil = '<img src=x onerror=alert(1)>';
		const { html } = await page(`/?q=${encodeURIComponent(evil)}`);
		expect(html).not.toContain(evil);
		expect(html).toContain('&lt;img src=x onerror=alert(1)');
	});

	it('draws a game with its detail, and the title of the page names it', async () => {
		const { res, html } = await page('/game/1001');
		expect(res.status).toBe(200);
		expect(html).toContain('<title>The Long Dark Road | Canvas for vangogh</title>');
		expect(html).toContain('A <b>long</b> road.');
		expect(cards(html)).toHaveLength(4);
	});

	it('draws the list with a note for a game that is not in the library', async () => {
		const { res, html } = await page('/game/424242');
		expect(res.status).toBe(200);
		expect(html).toContain('This game is not in the library.');
		expect(cards(html)).toHaveLength(4);
	});

	it('gives the name of the system the visitor sits at to the download block', async () => {
		const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
		// The button holds every label it can show. The one that is seen is marked.
		const button = (html: string) => html.match(/<span[^>]*\bclass="on"[^>]*>(Download [^<]*)<\/span>/)?.[1];

		const own = (await page('/game/1001', { 'user-agent': mac })).html;
		expect(button(own)).toBe('Download for macOS');
		expect(own).not.toContain('Not available for');

		// A game the visitor's system does not have, and a system Canvas cannot name:
		// a note, and the button for the first system the game has.
		const notOwn = (await page('/game/1002', { 'user-agent': mac })).html;
		expect(notOwn).toContain('Not available for macOS.');
		expect(button(notOwn)).toBe('Download for Windows');
		const unnamed = (await page('/game/1001', { 'user-agent': 'curl/8.7.1' })).html;
		expect(unnamed).toContain('Choose the files for your system.');
		expect(button(unnamed)).toBe('Download for Windows');
	});

	it('shows the year of the original release after the makers', async () => {
		const { html } = await page('/game/1001');
		expect(html.match(/<p class="detail-makers"[^>]*>([\s\S]*?)<\/p>/)?.[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).toBe(
			'Šťastný Studio, published by Road Works, 2002 · GOG.com'
		);
	});

	it('sends a security policy with every page, and no script of its own in the markup', async () => {
		const { res, html } = await page('/');
		expect(res.status).toBe(200);
		const policy = res.headers.get('content-security-policy') ?? '';
		expect(policy).toContain("default-src 'self'");
		expect(policy).toContain("script-src 'self' 'nonce-");
		expect(policy).toContain("object-src 'none'");
		expect(policy).toContain("frame-ancestors 'none'");
		// An `onload` or `onerror` in the markup would be refused by that policy.
		expect(html).not.toMatch(/ on[a-z]+="/);
	});

	it('answers an address that is not a page with a plain page', async () => {
		const { res, html } = await page('/no/such/page');
		expect(res.status).toBe(404);
		expect(html).toContain('This page does not exist');
		expect(html).toContain('Go to the library');
		expect(html).not.toContain('at file:');
	});
});

describe('the routes', () => {
	it('reports its health', async () => {
		const body = await (await fetch(`${base}/healthz`)).json();
		expect(body).toMatchObject({
			status: 'ok',
			index: { entries: 4 },
			rebuild: { lastResult: 'ok', lastError: null },
			login: 'ok',
			cache: 'written'
		});
		expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
		expect(body.index.ageSeconds).toBeLessThan(60);
	});

	it('serves the list with a version tag', async () => {
		const res = await fetch(`${base}/api/index`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as IndexPayload;
		expect(body.entries.map((e) => e.id)).toEqual(['1001', '1002', '2002', '1003']);
		expect(Object.keys(body).sort()).toEqual(['builtAt', 'entries', 'version']);
		expect(res.headers.get('etag')).toBe(`"${body.version}"`);

		const again = await fetch(`${base}/api/index`, {
			headers: { 'if-none-match': res.headers.get('etag')! }
		});
		expect(again.status).toBe(304);
		expect(res.headers.get('x-built-at')).toBe(body.builtAt);
		expect(again.headers.get('x-built-at')).toBe(body.builtAt);
	});

	it('tells a browser that got a 304 when the last rebuild was', async () => {
		const first = await fetch(`${base}/api/index`);
		const etag = first.headers.get('etag')!;
		const builtAt = first.headers.get('x-built-at');
		await first.body?.cancel();
		expect((await fetch(`${base}/api/rebuild`, { method: 'POST' })).status).toBe(202);
		await waitFor(async () => {
			const health = await (await fetch(`${base}/healthz`)).json();
			return health.rebuild.running === false && health.index.builtAt !== builtAt;
		}, 'the rebuild');
		const again = await fetch(`${base}/api/index`, { headers: { 'if-none-match': etag } });
		expect(again.status).toBe(304);
		expect(again.headers.get('etag')).toBe(etag);
		expect(again.headers.get('x-built-at')).not.toBe(builtAt);
		expect(Date.parse(again.headers.get('x-built-at')!)).toBeGreaterThan(Date.parse(builtAt!));
	});

	it('serves one detail', async () => {
		const res = await fetch(`${base}/api/games/1001`);
		expect(res.status).toBe(200);
		const detail = (await res.json()) as Detail;
		expect(detail.title).toBe('The Long Dark Road');
		expect(detail.downloads.windows).toHaveLength(3);
		expect(detail.partOf).toEqual(['Road Trilogy']);
	});

	it('answers 404 for a game that is not in the library', async () => {
		const res = await fetch(`${base}/api/games/424242`);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'not-in-library' });
	});

	it('leaves out the product that gog offers no installer for, and says of every entry whether it has files', async () => {
		const body = (await (await fetch(`${base}/api/index`)).json()) as IndexPayload;
		expect(body.entries.map((e) => e.id)).not.toContain('1004');
		expect(body.entries.length).toBeGreaterThan(0);
		for (const entry of body.entries) expect(typeof entry.hasFiles).toBe('boolean');
	});

	it('answers 404 for the game that was left out', async () => {
		const res = await fetch(`${base}/api/games/1004`);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'not-in-library' });
	});

	// The image route checks the format of an id only and does not look into the
	// index. An image id is not a secret, so the poster of a game that is left
	// out is served as any other.
	it('still serves the poster of the game that was left out', async () => {
		const res = await fetch(`${base}/img/${POSTER['1004']}`);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('poster 1004');
	});

	it('sends no address of vangogh to the browser', async () => {
		const list = await (await fetch(`${base}/api/index`)).text();
		const detail = await (await fetch(`${base}/api/games/1001`)).text();
		expect(list + detail).not.toContain('/downloads/');
		expect(list + detail).not.toContain(fake.url);
	});

	it('serves an image', async () => {
		const res = await fetch(`${base}/img/${POSTER['1001']}`);
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
		expect(await res.text()).toBe('poster 1001');
		expect((await fetch(`${base}/img/short`)).status).toBe(400);
	});

	it('serves a file, whole and in part', async () => {
		const id = await firstFile();
		const whole = await fetch(`${base}/download/1001/${id}`);
		expect(whole.status).toBe(200);
		expect(whole.headers.get('content-disposition')).toContain('setup_the_long_dark_road_2.1.exe');
		expect(await whole.text()).toContain('setup_the_long_dark_road_2.1.exe');

		const part = await fetch(`${base}/download/1001/${id}`, { headers: { range: 'bytes=0-6' } });
		expect(part.status).toBe(206);
		expect(await part.text()).toBe('content');
	});

	it('checks a file without sending it', async () => {
		const res = await fetch(`${base}/download/1001/${await firstFile()}`, { method: 'HEAD' });
		expect(res.status).toBe(200);
	});

	it('serves an extra, whole and in part, by the name vangogh gives it', async () => {
		const detail = (await (await fetch(`${base}/api/games/1001`)).json()) as Detail;
		expect(detail.extras.map((e) => e.kind)).toEqual(['manuals', 'audio', 'wallpapers']);
		const manual = detail.extras[0];
		const whole = await fetch(`${base}/download/1001/${manual.fileId}`);
		expect(whole.status).toBe(200);
		expect(whole.headers.get('content-disposition')).toContain('the_long_dark_road_manual.pdf');
		const part = await fetch(`${base}/download/1001/${manual.fileId}`, { headers: { range: 'bytes=0-6' } });
		expect(part.status).toBe(206);
		expect(await part.text()).toBe('content');
	});

	it('answers 404 for a file that is not in the index', async () => {
		const id = await firstFile();
		for (const path of [`/download/1001/0000000000000000`, `/download/1002/${id}`]) {
			const res = await fetch(`${base}${path}`);
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({ error: 'not-in-library' });
		}
	});

	it('does not expose the routes of vangogh', async () => {
		for (const path of [
			'/api/metadata/gog-other-record/1',
			'/api/metadata/gog-details/1001',
			'/api/available-products',
			'/api/gog/image/x'
		]) {
			expect((await fetch(`${base}${path}`)).status).toBe(404);
		}
	});

	it('serves the built-in logo', async () => {
		const res = await fetch(`${base}/logo`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/svg+xml');
		expect(await res.text()).toContain('<svg');
	});

	it('starts a rebuild on request, one at a time', async () => {
		const before = fake.requests.length;
		const first = await fetch(`${base}/api/rebuild`, { method: 'POST' });
		expect(first.status).toBe(202);
		expect(await first.json()).toEqual({ status: 'started' });
		const second = await fetch(`${base}/api/rebuild`, { method: 'POST' });
		expect([202, 409]).toContain(second.status);
		await waitFor(
			async () => (await (await fetch(`${base}/healthz`)).json()).rebuild.running === false,
			'the rebuild'
		);
		expect(fake.requests.length).toBeGreaterThan(before);
		expect((await fetch(`${base}/api/rebuild`)).status).toBe(405);
	});

	it('keeps serving the library when vangogh is down', async () => {
		fake.down = true;
		try {
			await fetch(`${base}/api/rebuild`, { method: 'POST' });
			await waitFor(
				async () => (await (await fetch(`${base}/healthz`)).json()).rebuild.lastResult === 'failed',
				'the failed rebuild'
			);
			const health = await fetch(`${base}/healthz`);
			expect(health.status).toBe(200);
			expect(((await (await fetch(`${base}/api/index`)).json()) as IndexPayload).entries).toHaveLength(4);
			const file = await fetch(`${base}/download/1001/${await firstFile()}`);
			expect(file.status).toBe(502);
			expect(await file.json()).toEqual({ error: 'archive-unreachable' });
		} finally {
			fake.down = false;
		}
	});

	it('checks a file that the index names and the archive does not have', async () => {
		const id = await firstFile();
		const saved = fake.data.files[FIRST_FILE_KEY];
		delete fake.data.files[FIRST_FILE_KEY];
		try {
			const head = await fetch(`${base}/download/1001/${id}`, { method: 'HEAD' });
			expect(head.status).toBe(404);
			const get = await fetch(`${base}/download/1001/${id}`);
			expect(get.status).toBe(404);
			expect(await get.json()).toEqual({ error: 'file-missing' });
		} finally {
			fake.data.files[FIRST_FILE_KEY] = saved;
		}
	});

	it('answers 502 to a check while vangogh is down', async () => {
		const id = await firstFile();
		fake.down = true;
		try {
			const head = await fetch(`${base}/download/1001/${id}`, { method: 'HEAD' });
			expect(head.status).toBe(502);
		} finally {
			fake.down = false;
		}
	});

	it('reports a rejected login, and recovers with the next rebuild', async () => {
		// As after a restart of vangogh with another password: the old token is gone.
		fake.data.password = 'changed-on-vangogh';
		fake.revokeTokens();
		try {
			expect((await fetch(`${base}/api/rebuild`, { method: 'POST' })).status).toBe(202);
			await waitFor(async () => (await health()).login === 'rejected', 'the rejected login');
			expect((await health()).rebuild.lastResult).toBe('failed');
		} finally {
			fake.data.password = PASSWORD;
			await waitFor(async () => (await health()).rebuild.running === false, 'the rebuild');
			await fetch(`${base}/api/rebuild`, { method: 'POST' });
			await waitFor(async () => {
				const now = await health();
				return now.login === 'ok' && now.rebuild.lastResult === 'ok';
			}, 'the login');
		}
	});

	it('refuses a rebuild asked for by another site', async () => {
		const idle = async () => (await health()).rebuild.running === false;
		for (const headers of [
			{ origin: 'http://evil.example' },
			{ origin: 'null' },
			{ origin: base.replace('127.0.0.1', 'localhost') },
			{ 'sec-fetch-site': 'cross-site' },
			{ 'sec-fetch-site': 'same-site' },
			{ origin: base, 'sec-fetch-site': 'cross-site' }
		] as Record<string, string>[]) {
			await waitFor(idle, 'no rebuild');
			const before = fake.requests.length;
			const res = await fetch(`${base}/api/rebuild`, { method: 'POST', headers });
			expect(res.status, JSON.stringify(headers)).toBe(403);
			expect(await res.json()).toEqual({ error: 'cross-site' });
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(fake.requests.slice(before)).toEqual([]);
			expect((await health()).rebuild.running).toBe(false);
		}
	});

	it('accepts a rebuild from its own page and from a tool', async () => {
		const idle = async () => (await health()).rebuild.running === false;
		for (const headers of [
			{ origin: base },
			{ origin: base, 'sec-fetch-site': 'same-origin' },
			{ 'sec-fetch-site': 'none' },
			{}
		] as Record<string, string>[]) {
			await waitFor(idle, 'no rebuild');
			const res = await fetch(`${base}/api/rebuild`, { method: 'POST', headers });
			expect(res.status, JSON.stringify(headers)).toBe(202);
		}
		await waitFor(idle, 'the rebuild');
	});

	it('logs a failed request as one plain line', async () => {
		const from = output.length;
		for (const path of ['/%E0%A4%A', '/img/%', '/download/%zz/x']) {
			const res = await fetch(`${base}${path}`);
			expect(res.status).toBe(400);
			await res.text();
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
		const written = output.slice(from);
		expect(written).toMatch(/ WARN request failed status=400 method=GET path=/);
		expect(written).not.toMatch(/^\s+at /m);
		expect(written).not.toContain('\x1b');
		expect(written).not.toMatch(/Error:|SvelteKitError/);
	});

	it('does not log a path that does not exist', async () => {
		const from = output.length;
		const res = await fetch(`${base}/no-such-page-anywhere`);
		expect(res.status).toBe(404);
		await res.text();
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(output.slice(from)).toBe('');
	});

	it('writes the index to the cache', () => {
		expect(existsSync(join(cacheDir, 'index.json'))).toBe(true);
	});

	it('never logs the password or a token', () => {
		expect(output).toContain('rebuild finished');
		expect(output).not.toContain(PASSWORD);
		expect(output).not.toMatch(/token-\d/);
	});
});

describe('what a browser cannot make Canvas do', () => {
	const VALID_IMAGE = POSTER['1001'];

	async function reachesNothing(send: () => Promise<number>, status: number): Promise<void> {
		const before = fake.requests.length;
		expect(await send()).toBe(status);
		expect(fake.requests.slice(before)).toEqual([]);
	}

	it.each([
		['/img/..%2f..%2fapi%2fmetadata%2fgog-other-record%2fgog-other-record', 400],
		['/img/%252e%252e%252fapi', 400],
		['/img/__proto__', 400],
		[`/img/${'a'.repeat(200)}`, 400],
		['/img/abc%0d%0aX-Evil:1', 400],
		['/img/%00aaaaaaaaaaaaaaaaaaaa', 400],
		['/download/__proto__/__proto__', 404],
		['/download/constructor/prototype', 404],
		['/download/1001/..%2f..%2fapi%2fmetadata%2fgog-other-record', 404],
		['/api/games/__proto__', 404],
		['/api/games/constructor', 404],
		['/api/games/toString', 404],
		['/api/metadata/gog-other-record/gog-other-record', 404]
	])('asks vangogh nothing for %s', async (path, status) => {
		await reachesNothing(async () => (await fetch(`${base}${path}`)).status, status);
	});

	it('asks vangogh nothing for a file of one game asked for under another', async () => {
		const id = await firstFile();
		await reachesNothing(async () => (await fetch(`${base}/download/1001%2f..%2f1002/${id}`)).status, 404);
		await reachesNothing(async () => (await fetch(`${base}/download/1002/${id}`)).status, 404);
	});

	it('asks vangogh nothing for a path with dot segments', async () => {
		// fetch would remove these segments before sending, so node:http sends them as they are.
		await reachesNothing(
			() => rawRequest('GET', '/img/../api/metadata/gog-other-record/gog-other-record'),
			404
		);
		await reachesNothing(
			() => rawRequest('GET', '/download/1001/../../api/metadata/gog-other-record/x'),
			404
		);
	});

	it('refuses other methods', async () => {
		const id = await firstFile();
		await reachesNothing(
			async () => (await fetch(`${base}/img/${VALID_IMAGE}`, { method: 'POST' })).status,
			405
		);
		await reachesNothing(
			async () => (await fetch(`${base}/download/1001/${id}`, { method: 'POST' })).status,
			405
		);
	});

	it('passes none of the headers of the browser to vangogh', async () => {
		const before = fake.seen.length;
		const res = await fetch(`${base}/img/${VALID_IMAGE}`, {
			headers: { authorization: 'Bearer stolen', cookie: 'a=b', 'x-evil': '1' }
		});
		expect(res.status).toBe(200);
		await res.body?.cancel();
		const asked = fake.seen.slice(before).filter((s) => s.path.startsWith('/api/gog/image/'));
		expect(asked).toHaveLength(1);
		expect(asked[0].headers.authorization).toMatch(/^Bearer /);
		expect(asked[0].headers.authorization).not.toBe('Bearer stolen');
		expect(asked[0].headers).not.toHaveProperty('cookie');
		expect(asked[0].headers).not.toHaveProperty('x-evil');
	});

	it('does not pass a malformed range on', async () => {
		const before = fake.seen.length;
		const res = await fetch(`${base}/download/1001/${await firstFile()}`, {
			headers: { range: 'bytes=abc' }
		});
		expect(res.status).toBe(200);
		await res.text();
		const asked = fake.seen.slice(before).filter((s) => s.path.startsWith('/api/gog/manual-url/'));
		expect(asked).toHaveLength(1);
		expect(asked[0].range).toBeNull();
	});

	it('stops the download in vangogh when the browser stops it', async () => {
		const id = await firstFile();
		fake.slowFileDelayMs = 500;
		const controller = new AbortController();
		try {
			const res = await fetch(`${base}/download/1001/${id}`, { signal: controller.signal });
			expect(res.status).toBe(200);
			const reader = res.body!.getReader();
			const first = await reader.read();
			expect(first.done).toBe(false);
			expect(fake.openFiles).toBe(1);
			controller.abort();
			const began = Date.now();
			while (fake.openFiles > 0 && Date.now() - began < 2000) {
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			expect(fake.openFiles).toBe(0);
		} finally {
			fake.slowFileDelayMs = 0;
		}
	});

	it('only ever asked vangogh for what Canvas needs', () => {
		const allowed = [
			'POST /api/auth-user',
			'GET /api/available-products',
			'GET /api/metadata/gog-api-products/',
			'GET /api/metadata/gog-details/',
			'GET /api/gog/filenames/',
			'GET /api/gog/image/',
			'GET /api/gog/manual-url/',
			// Whether an extra is on disk.
			'HEAD /api/gog/manual-url/'
		];
		expect(fake.requests.length).toBeGreaterThan(0);
		expect(fake.requests.filter((r) => r.includes('other-record'))).toEqual([]);
		expect(fake.requests.filter((r) => !allowed.some((a) => r.startsWith(a)))).toEqual([]);
	});
});

describe('the start', () => {
	it('serves the cached index at once, before vangogh answers', async () => {
		const port = await freePort();
		const silent = await startFakeVangogh({ ...fixtureData(), password: PASSWORD });
		silent.down = true;
		const second = launch({
			PORT: String(port),
			VANGOGH_URL: silent.url,
			VANGOGH_USERNAME: 'api',
			VANGOGH_PASSWORD: PASSWORD,
			CACHE_DIR: cacheDir
		});
		try {
			await waitFor(
				async () => (await fetch(`http://127.0.0.1:${port}/healthz`)).status === 200,
				'the cached index'
			);
			const body = (await (await fetch(`http://127.0.0.1:${port}/api/index`)).json()) as IndexPayload;
			expect(body.entries).toHaveLength(4);
		} finally {
			await stop(second);
			await silent.close();
		}
	});

	it('answers 503 while there is no index', async () => {
		const port = await freePort();
		const empty = await mkdtemp(join(tmpdir(), 'canvas-it-empty-'));
		const silent = await startFakeVangogh({ ...fixtureData(), password: PASSWORD });
		silent.down = true;
		const second = launch({
			PORT: String(port),
			VANGOGH_URL: silent.url,
			VANGOGH_USERNAME: 'api',
			VANGOGH_PASSWORD: PASSWORD,
			CACHE_DIR: empty
		});
		try {
			await waitFor(
				async () => (await fetch(`http://127.0.0.1:${port}/healthz`)).status === 503,
				'the app'
			);
			const res = await fetch(`http://127.0.0.1:${port}/api/index`);
			expect(res.status).toBe(503);
			expect(await res.json()).toEqual({ error: 'index-not-ready' });
			// vangogh was never reached: nothing is known of the password yet.
			expect((await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()).login).toBe('unknown');
			// Every page says so in plain words, and asks again by itself.
			for (const path of ['/', '/game/1001', '/?q=road']) {
				const page = await fetch(`http://127.0.0.1:${port}${path}`);
				expect(page.status).toBe(200);
				const html = await page.text();
				expect(html).toContain('The library is being prepared');
				expect(html).toContain('http-equiv="refresh"');
			}
		} finally {
			await stop(second);
			await silent.close();
			await rm(empty, { recursive: true, force: true });
		}
	});

	it('stops within a few seconds when asked to', async () => {
		const port = await freePort();
		let text = '';
		const started = spawn(process.execPath, ['build'], {
			env: {
				PATH: process.env.PATH ?? '',
				HOST: '127.0.0.1',
				PORT: String(port),
				SHUTDOWN_TIMEOUT: '2',
				VANGOGH_URL: fake.url,
				VANGOGH_USERNAME: 'api',
				VANGOGH_PASSWORD: PASSWORD,
				CACHE_DIR: cacheDir
			},
			stdio: ['ignore', 'pipe', 'pipe']
		});
		started.stdout?.on('data', (chunk) => (text += chunk));
		started.stderr?.on('data', (chunk) => (text += chunk));
		try {
			await waitFor(
				async () => (await fetch(`http://127.0.0.1:${port}/healthz`)).status === 200,
				'the app'
			);
			const began = Date.now();
			const exited = new Promise<number | null>((resolve) => started.once('exit', resolve));
			started.kill('SIGTERM');
			const code = await exited;
			expect(Date.now() - began).toBeLessThan(5000);
			expect(code).toBe(0);
			expect(text).toContain('canvas stopped');
		} finally {
			await stop(started);
		}
	});

	it('refuses to start without a required variable and names it', async () => {
		let text = '';
		const port = await freePort();
		const broken = spawn(process.execPath, ['build'], {
			env: {
				PATH: process.env.PATH ?? '',
				PORT: String(port),
				VANGOGH_URL: fake.url,
				VANGOGH_USERNAME: 'api'
			},
			stdio: ['ignore', 'pipe', 'pipe']
		});
		broken.stdout?.on('data', (chunk) => (text += chunk));
		broken.stderr?.on('data', (chunk) => (text += chunk));
		try {
			const code = await new Promise<number | null>((resolve) => broken.on('exit', resolve));
			expect(code).toBe(1);
			expect(text).toContain('VANGOGH_PASSWORD');
		} finally {
			await stop(broken);
		}
	});

	it('serves a custom logo, and the built-in one when the file is missing', async () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg"><title>custom</title></svg>';
		const logo = join(cacheDir, 'custom-logo.svg');
		await writeFile(logo, svg);
		for (const [file, expected] of [
			[logo, 'custom'],
			[join(cacheDir, 'missing-logo.svg'), 'built-in']
		] as const) {
			const port = await freePort();
			const second = launch({
				PORT: String(port),
				VANGOGH_URL: fake.url,
				VANGOGH_USERNAME: 'api',
				VANGOGH_PASSWORD: PASSWORD,
				CACHE_DIR: cacheDir,
				CUSTOM_LOGO: file
			});
			try {
				await waitFor(
					async () => (await fetch(`http://127.0.0.1:${port}/healthz`)).status === 200,
					'the app'
				);
				const res = await fetch(`http://127.0.0.1:${port}/logo`);
				expect(res.status).toBe(200);
				expect(res.headers.get('content-type')).toBe('image/svg+xml');
				const body = await res.text();
				if (expected === 'custom') expect(body).toBe(svg);
				else expect(body).not.toContain('custom');
				if (expected === 'built-in') expect(body).toContain('<svg');
			} finally {
				await stop(second);
			}
		}
	});
});
