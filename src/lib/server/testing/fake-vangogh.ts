import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BACKDROP, BANNER, POSTER, SHOT, records } from './fixtures';

export interface FakeData {
	username: string;
	password: string;
	library: unknown;
	/** Keyed by `<type>/<id>`. */
	metadata: Record<string, unknown>;
	/** Keyed by product id. A missing key answers 500, as vangogh does. */
	filenames: Record<string, Record<string, string>>;
	images: Record<string, { type: string; body: Buffer }>;
	/** Keyed by `<id>/<downloadType>/<manualUrl without its leading slash>`. */
	files: Record<string, { name: string; body: Buffer }>;
}

export interface FakeVangogh {
	url: string;
	data: FakeData;
	/** Successful logins. */
	logins: number;
	/** All logins, rejected ones included. */
	loginAttempts: number;
	requests: string[];
	seen: {
		path: string;
		range: string | null;
		ifRange: string | null;
		/** Every header of the request, with lower-case names. */
		headers: Record<string, string>;
	}[];
	/** When true every connection is dropped, as if vangogh was stopped. */
	down: boolean;
	/** When true every request is accepted and never answered. */
	hang: boolean;
	/** When above 0, files are sent in small chunks with this delay between them. */
	slowFileDelayMs: number;
	/** File answers that were started and whose connection is still open. */
	openFiles: number;
	revokeTokens(): void;
	close(): Promise<void>;
}

/** The hand-made records, with bodies for the images and files. */
export function fixtureData(): FakeData {
	const metadata: Record<string, unknown> = {};
	for (const [id, record] of Object.entries(records.apiProducts)) {
		metadata[`gog-api-products/${id}`] = record;
	}
	for (const [id, record] of Object.entries(records.details)) {
		metadata[`gog-details/${id}`] = record;
	}
	const files: FakeData['files'] = {};
	for (const [id, names] of Object.entries(records.filenames)) {
		for (const [manualUrl, name] of Object.entries(names)) {
			const type = manualUrl.includes('road_expansion') ? 'downloadable-content' : 'installer';
			files[`${id}/${type}/${manualUrl.replace(/^\/+/, '')}`] = {
				name,
				body: Buffer.from(`content of ${name}, long enough to ask for a part of it`)
			};
		}
	}
	for (const [id, names] of Object.entries(records.extraFiles)) {
		for (const [manualUrl, name] of Object.entries(names)) {
			files[`${id}/extra/${manualUrl.replace(/^\/+/, '')}`] = { name, body: Buffer.from(`content of ${name}, long enough to ask for a part of it`) };
		}
	}
	const jpeg = (text: string) => ({ type: 'image/jpeg', body: Buffer.from(text) });
	return {
		username: 'api',
		password: 'secret',
		library: records.library,
		metadata,
		filenames: records.filenames,
		images: {
			[POSTER['1001']]: jpeg('poster 1001'),
			[POSTER['1002']]: jpeg('poster 1002'),
			[POSTER['2002']]: jpeg('poster 2002'),
			[POSTER['1004']]: jpeg('poster 1004'),
			[SHOT.one]: jpeg('shot one'),
			[BANNER['1001']]: jpeg('banner 1001'),
			[BANNER['1002']]: jpeg('banner 1002'),
			[BACKDROP['1001']]: jpeg('backdrop 1001')
		},
		files
	};
}

const LAST_MODIFIED = 'Tue, 01 Sep 2026 10:00:00 GMT';

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = '';
		req.on('data', (chunk) => (body += chunk));
		req.on('end', () => resolve(body));
		req.on('error', reject);
	});
}

function send(
	res: ServerResponse,
	status: number,
	body: string | Buffer = '',
	headers: Record<string, string> = {}
): void {
	res.writeHead(status, {
		'content-type': 'text/plain',
		'content-length': String(Buffer.byteLength(body)),
		...headers
	});
	res.end(body);
}

function sendJson(res: ServerResponse, body: unknown): void {
	send(res, 200, JSON.stringify(body), { 'content-type': 'application/json' });
}

const SLOW_CHUNK = 8;

/** Sends a file body in small chunks, stopping when the connection closes. */
function sendSlowly(
	res: ServerResponse,
	status: number,
	body: Buffer,
	headers: Record<string, string>,
	delayMs: number
): void {
	res.writeHead(status, { ...headers, 'content-length': String(body.length) });
	let offset = 0;
	const next = () => {
		if (res.destroyed || res.writableEnded) return;
		res.write(body.subarray(offset, offset + SLOW_CHUNK));
		offset += SLOW_CHUNK;
		if (offset >= body.length) res.end();
		else setTimeout(next, delayMs);
	};
	next();
}

function headersOf(req: IncomingMessage): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(req.headers)) {
		if (value !== undefined) out[name] = Array.isArray(value) ? value.join(', ') : value;
	}
	return out;
}

export interface FakeOptions {
	/** The address to listen on. 127.0.0.1 unless a container must reach the fake. */
	host?: string;
}

export async function startFakeVangogh(
	data: FakeData = fixtureData(),
	options: FakeOptions = {}
): Promise<FakeVangogh> {
	const tokens = new Set<string>();

	const server = createServer(async (req, res) => {
		const path = decodeURIComponent(new URL(req.url ?? '/', 'http://fake').pathname);
		fake.requests.push(`${req.method} ${path}`);
		fake.seen.push({
			path,
			range: req.headers.range ?? null,
			ifRange: headersOf(req)['if-range'] ?? null,
			headers: headersOf(req)
		});

		if (fake.down) {
			req.socket.destroy();
			return;
		}
		if (fake.hang) return;

		if (req.method === 'POST' && path === '/api/auth-user') {
			fake.loginAttempts++;
			const form = new URLSearchParams(await readBody(req));
			const typed = req.headers['content-type'] === 'application/x-www-form-urlencoded';
			if (!typed || form.get('username') !== data.username || form.get('password') !== data.password) {
				return send(res, 401, 'unauthorized');
			}
			fake.logins++;
			const token = `token-${fake.logins}`;
			tokens.add(token);
			return sendJson(res, { token, expires: '2099-01-01T00:00:00Z' });
		}

		const header = req.headers.authorization ?? '';
		if (!header.startsWith('Bearer ') || !tokens.has(header.slice(7))) {
			return send(res, 401, 'session is not valid');
		}
		// HEAD on the file route asks whether a file is on disk, as Go's router answers it for GET routes.
		const head = req.method === 'HEAD' && path.startsWith('/api/gog/manual-url/');
		if (req.method !== 'GET' && !head) return send(res, 405);

		if (path === '/api/available-products') return sendJson(res, data.library);

		let match = /^\/api\/metadata\/([^/]+)\/([^/]+)$/.exec(path);
		if (match) {
			const record = data.metadata[`${match[1]}/${match[2]}`];
			return record === undefined ? send(res, 404, 'not found') : sendJson(res, record);
		}

		match = /^\/api\/gog\/filenames\/([^/]+)$/.exec(path);
		if (match) {
			const names = data.filenames[match[1]];
			return names === undefined ? send(res, 500, 'no details') : sendJson(res, names);
		}

		match = /^\/api\/gog\/image\/([^/]+)$/.exec(path);
		if (match) {
			const image = data.images[match[1]];
			if (!image) return send(res, 404, 'not found');
			if (req.headers['if-modified-since'] === LAST_MODIFIED) {
				res.writeHead(304, { 'last-modified': LAST_MODIFIED });
				return res.end();
			}
			return send(res, 200, image.body, {
				'content-type': image.type,
				'cache-control': 'max-age=31536000',
				'last-modified': LAST_MODIFIED
			});
		}

		match = /^\/api\/gog\/manual-url\/(.+)$/.exec(path);
		if (match) {
			const found = data.files[match[1]];
			if (!found) return send(res, 404, 'not found');
			const headers = {
				'content-type': 'application/octet-stream',
				'content-disposition': `attachment; filename="${found.name}"`,
				'accept-ranges': 'bytes',
				'last-modified': LAST_MODIFIED
			};
			fake.openFiles++;
			res.once('close', () => fake.openFiles--);
			const ifRange = headersOf(req)['if-range'];
			// As vangogh (Go's http.ServeContent): a stale If-Range gets the whole file.
			const stale = ifRange !== undefined && ifRange !== LAST_MODIFIED;
			const range = stale ? null : /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
			if (!range) {
				if (fake.slowFileDelayMs > 0) {
					return sendSlowly(res, 200, found.body, headers, fake.slowFileDelayMs);
				}
				return send(res, 200, found.body, headers);
			}
			const size = found.body.length;
			const start = range[1] === '' ? size - Number(range[2]) : Number(range[1]);
			const end = range[1] === '' || range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
			if (start < 0 || start >= size || start > end) {
				return send(res, 416, 'invalid range: failed to overlap\n', { 'content-range': `bytes */${size}` });
			}
			return send(res, 206, found.body.subarray(start, end + 1), {
				...headers,
				'content-range': `bytes ${start}-${end}/${size}`
			});
		}

		send(res, 404, 'not found');
	});

	const host = options.host ?? '127.0.0.1';
	await new Promise<void>((resolve) => server.listen(0, host, resolve));
	const { port } = server.address() as AddressInfo;

	const fake: FakeVangogh = {
		url: `http://127.0.0.1:${port}`,
		data,
		logins: 0,
		loginAttempts: 0,
		requests: [],
		seen: [],
		down: false,
		hang: false,
		slowFileDelayMs: 0,
		openFiles: 0,
		revokeTokens: () => tokens.clear(),
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			})
	};
	return fake;
}
