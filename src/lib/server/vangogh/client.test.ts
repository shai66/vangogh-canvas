import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POSTER, records } from '../testing/fixtures';
import { startFakeVangogh, type FakeVangogh } from '../testing/fake-vangogh';
import {
	VangoghAuthError,
	VangoghClient,
	VangoghHttpError,
	VangoghUnreachable,
	type MetadataType
} from './client';

let fake: FakeVangogh;

function client(
	overrides: Partial<{ url: string; username: string; password: string; timeoutMs: number }> = {}
) {
	return new VangoghClient({ url: fake.url, username: 'api', password: 'secret', ...overrides });
}

beforeEach(async () => {
	fake = await startFakeVangogh();
});
afterEach(async () => {
	await fake.close();
});

describe('VangoghClient', () => {
	it('logs in with form fields and reads the library', async () => {
		expect(await client().availableProducts()).toEqual(records.library);
		expect(fake.requests).toEqual(['POST /api/auth-user', 'GET /api/available-products']);
	});

	it('logs in once for many requests', async () => {
		const c = client();
		await c.availableProducts();
		await c.metadata('gog-details', '1001');
		await c.filenames('1001');
		expect(fake.logins).toBe(1);
	});

	it('logs in once when several requests start together', async () => {
		const c = client();
		await Promise.all([c.metadata('gog-details', '1001'), c.metadata('gog-details', '1002'), c.availableProducts()]);
		expect(fake.logins).toBe(1);
	});

	it('gives null for metadata that does not exist', async () => {
		expect(await client().metadata('gog-details', '1003')).toBeNull();
	});

	it('reads the file names', async () => {
		expect(await client().filenames('1002')).toEqual(records.filenames['1002']);
	});

	it('reports a failing call with its status', async () => {
		const error = await client().filenames('1003').catch((e) => e);
		expect(error).toBeInstanceOf(VangoghHttpError);
		expect(error.status).toBe(500);
	});

	it('logs in again when the token is rejected, and repeats the request', async () => {
		const c = client();
		await c.availableProducts();
		fake.revokeTokens();
		expect(await c.availableProducts()).toEqual(records.library);
		expect(fake.logins).toBe(2);
	});

	it('stops logging in after a rejected password', async () => {
		const c = client({ password: 'wrong' });
		await expect(c.availableProducts()).rejects.toBeInstanceOf(VangoghAuthError);
		await expect(c.availableProducts()).rejects.toBeInstanceOf(VangoghAuthError);
		await expect(c.metadata('gog-details', '1001')).rejects.toBeInstanceOf(VangoghAuthError);
		expect(fake.loginAttempts).toBe(1);
		expect(c.loginRejected).toBe(true);
	});

	it('tries to log in again after resetAuth', async () => {
		const c = client({ password: 'wrong' });
		await expect(c.availableProducts()).rejects.toBeInstanceOf(VangoghAuthError);
		c.resetAuth();
		expect(c.loginRejected).toBe(false);
		await expect(c.availableProducts()).rejects.toBeInstanceOf(VangoghAuthError);
		expect(fake.loginAttempts).toBe(2);
	});

	it('reports an unreachable vangogh', async () => {
		fake.down = true;
		await expect(client().availableProducts()).rejects.toBeInstanceOf(VangoghUnreachable);
	});

	it('does not take an unreachable vangogh for a rejected password', async () => {
		const c = client();
		fake.down = true;
		await expect(c.availableProducts()).rejects.toBeInstanceOf(VangoghUnreachable);
		fake.down = false;
		expect(await c.availableProducts()).toEqual(records.library);
	});

	it('does not put the password or the token into an error', async () => {
		const error: Error = await client({ password: 'wrong-secret' })
			.availableProducts()
			.then(() => new Error('the login was accepted'))
			.catch((e) => e);
		expect(error).toBeInstanceOf(VangoghAuthError);
		expect(`${error.message} ${error.stack}`).not.toContain('wrong-secret');
	});

	it('fetches an image', async () => {
		const res = await client().image(POSTER['1001']);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/jpeg');
		expect(await res.text()).toBe('poster 1001');
	});

	it('passes If-Modified-Since for an image', async () => {
		const res = await client().image(POSTER['1001'], {
			ifModifiedSince: 'Tue, 01 Sep 2026 10:00:00 GMT'
		});
		expect(res.status).toBe(304);
	});

	it('fetches a file, the leading slash of its address removed', async () => {
		const res = await client().file({
			productId: '1002',
			downloadType: 'installer',
			manualUrl: '/downloads/windows_only_game/en1installer0'
		});
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('setup_windows_only_game_1.0.exe');
		expect(fake.requests.at(-1)).toBe(
			'GET /api/gog/manual-url/1002/installer/downloads/windows_only_game/en1installer0'
		);
	});

	it('passes a range for a file', async () => {
		const res = await client().file(
			{
				productId: '1002',
				downloadType: 'installer',
				manualUrl: '/downloads/windows_only_game/en1installer0'
			},
			{ range: 'bytes=0-6' }
		);
		expect(res.status).toBe(206);
		expect(await res.text()).toBe('content');
		expect(fake.seen.at(-1)?.range).toBe('bytes=0-6');
	});

	it('sends If-Range for a file only together with a range', async () => {
		const address = {
			productId: '1002',
			downloadType: 'installer' as const,
			manualUrl: '/downloads/windows_only_game/en1installer0'
		};
		const ifRange = 'Tue, 01 Sep 2026 10:00:00 GMT';
		await (await client().file(address, { range: 'bytes=0-6', ifRange })).text();
		expect(fake.seen.at(-1)).toMatchObject({ range: 'bytes=0-6', ifRange });
		await (await client().file(address, { ifRange })).text();
		expect(fake.seen.at(-1)).toMatchObject({ range: null, ifRange: null });
	});

	it('gives the answer back as it is when a file is missing', async () => {
		const res = await client().file({ productId: '1002', downloadType: 'installer', manualUrl: '/nope' });
		expect(res.status).toBe(404);
	});

	it('stops a request when its signal is aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		const error = await client()
			.image(POSTER['1001'], { signal: controller.signal })
			.catch((e) => e);
		expect(error.name).toBe('AbortError');
	});

	it.each([
		['..'],
		['.'],
		[''],
		['a/b'],
		['a\\b'],
		['%2e%2e'],
		['%2E%2E'],
		['%zz']
	])('refuses the image id %j without asking vangogh', async (imageId) => {
		const error = await client().image(imageId).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(VangoghHttpError);
		expect((error as VangoghHttpError).status).toBe(400);
		expect(fake.requests).toEqual([]);
	});

	it.each([
		['/../../../metadata/gog-other-record/gog-other-record'],
		['/downloads/../../metadata/x'],
		['/downloads/./x'],
		['/downloads/%2e%2e/x'],
		['/downloads/a\\..\\b'],
		['/'],
		['']
	])('refuses the file address %j without asking vangogh', async (manualUrl) => {
		const error = await client()
			.file({ productId: '1002', downloadType: 'installer', manualUrl })
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(VangoghHttpError);
		expect(fake.requests).toEqual([]);
	});

	it.each([['..'], ['1002/..'], ['']])(
		'refuses the product id %j without asking vangogh',
		async (productId) => {
			const c = client();
			const asked = [
				c.file({ productId, downloadType: 'installer', manualUrl: '/downloads/x/en1installer0' }),
				c.metadata('gog-details', productId),
				c.metadata(productId as MetadataType, '1001'),
				c.filenames(productId)
			];
			for (const request of asked) {
				await expect(request).rejects.toBeInstanceOf(VangoghHttpError);
			}
			expect(fake.requests).toEqual([]);
		}
	);

	it('does not put a refused address into the error', async () => {
		const error = await client()
			.file({ productId: '1002', downloadType: 'installer', manualUrl: '/../secret-looking-path' })
			.catch((e: unknown) => e);
		expect(String((error as Error).message)).not.toContain('secret-looking-path');
	});

	it('still fetches a file whose name has dots in it', async () => {
		fake.data.files['1002/installer/downloads/game/setup_1.0..exe'] = {
			name: 'setup_1.0..exe',
			body: Buffer.from('dots')
		};
		const res = await client().file({
			productId: '1002',
			downloadType: 'installer',
			manualUrl: '/downloads/game/setup_1.0..exe'
		});
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('dots');
	});

	it('drops a token that is rejected twice', async () => {
		let loginCount = 0;
		const calls: string[] = [];
		const stub = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			if (init?.method === 'POST' && url.includes('/api/auth-user')) {
				loginCount++;
				calls.push('login');
				return new Response(JSON.stringify({ token: `t${loginCount}`, expires: 'x' }), {
					headers: { 'content-type': 'application/json' }
				});
			}
			calls.push(`get with t${loginCount}`);
			return new Response('no', { status: 401 });
		};

		const c = new VangoghClient({
			url: 'http://example.com',
			username: 'api',
			password: 'secret',
			fetch: stub
		});

		await expect(c.availableProducts()).rejects.toBeInstanceOf(VangoghAuthError);
		expect(calls).toEqual(['login', 'get with t1', 'login', 'get with t2']);
		await expect(c.availableProducts()).rejects.toBeInstanceOf(VangoghAuthError);
		// The second request starts with a login: the token rejected twice was dropped.
		expect(calls.slice(4)).toEqual(['login', 'get with t3', 'login', 'get with t4']);
	});

	it('refuses to ask for a metadata record of another type, and sends nothing', async () => {
		const c = client();
		for (const type of ['gog-other-record', 'gog-api-products/../gog-other-record', '']) {
			const error = await c.metadata(type as MetadataType, 'gog-other-record').catch((e) => e);
			expect(error).toBeInstanceOf(VangoghHttpError);
			expect((error as VangoghHttpError).status).toBe(400);
			expect((error as Error).message).not.toContain('other-record');
		}
		expect(fake.requests).toEqual([]);
	});

	it('has no public way to send a request of its own choosing', () => {
		expect('raw' in client()).toBe(false);
	});

	it('gives up on a vangogh that does not answer, as unreachable', async () => {
		fake.hang = true;
		const c = client({ timeoutMs: 100 });
		const began = Date.now();
		for (const call of [
			() => c.availableProducts(),
			() => c.metadata('gog-details', '1001'),
			() => c.filenames('1001')
		]) {
			await expect(call()).rejects.toBeInstanceOf(VangoghUnreachable);
		}
		expect(Date.now() - began).toBeLessThan(1000);
	});

	it('gives up on a JSON answer that stops half way, as unreachable', async () => {
		const c = new VangoghClient({
			url: 'http://vangogh.test',
			username: 'api',
			password: 'secret',
			timeoutMs: 100,
			fetch: async (input, init) => {
				if (init?.method === 'POST') return Response.json({ token: 't1' });
				const signal = init?.signal;
				const body = new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode('{"a":'));
						signal?.addEventListener('abort', () => controller.error(signal.reason));
					}
				});
				return new Response(body, { headers: { 'content-type': 'application/json' } });
			}
		});
		await expect(c.availableProducts()).rejects.toBeInstanceOf(VangoghUnreachable);
	});

	it('gives a file as long as it takes, without the timeout of JSON calls', async () => {
		fake.slowFileDelayMs = 40;
		const res = await client({ timeoutMs: 100 }).file({
			productId: '1002',
			downloadType: 'installer',
			manualUrl: '/downloads/windows_only_game/en1installer0'
		});
		const began = Date.now();
		expect(await res.text()).toContain('setup_windows_only_game_1.0.exe');
		expect(Date.now() - began).toBeGreaterThan(150);
	});
});
