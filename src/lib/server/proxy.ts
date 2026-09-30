import type { FileTarget } from './index-types';
import { fileId } from './indexer';
import { silentLogger, type Fields, type Logger } from './log';
import { IMAGE_ID } from './mapper/imageId';
import {
	VangoghAuthError,
	VangoghHttpError,
	VangoghUnreachable,
	type VangoghFiles
} from './vangogh/client';

const YEAR = 'public, max-age=31536000, immutable';
const RANGE = /^bytes=(\d+-\d*|-\d+)(,\s*(\d+-\d*|-\d+))*$/;
const IF_RANGE_MAX = 200;
const CONTROL = /[\u0000-\u001f\u007f]/;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const FILE_HEADERS = [
	'content-type',
	'content-length',
	'content-range',
	'accept-ranges',
	'last-modified',
	'etag'
];

/** An answer the UI can read: `{ "error": "<code>" }`. */
export function problem(status: number, error: string): Response {
	return new Response(JSON.stringify({ error }), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
	});
}

/** What the browser asked for, as the log may name it: never an address in vangogh. */
type Asked = { asked: 'image' } | { asked: 'file'; gameId: string; fileId: string };

type FailureKind = 'unreachable' | 'login-rejected' | 'status' | 'content-type';

function warn(log: Logger, kind: FailureKind, asked: Asked, extra: Fields = {}): void {
	log.warn('the archive could not serve a request', { kind, ...extra, ...asked });
}

/** The code of the network error behind an unreachable vangogh, like ECONNREFUSED. */
function causeCode(error: VangoghUnreachable): string | null {
	let cause: unknown = error.cause;
	for (let depth = 0; depth < 3 && cause instanceof Error; depth++) {
		const code = (cause as { code?: unknown }).code;
		if (typeof code === 'string') return code;
		if (cause.name === 'TimeoutError') return 'timeout';
		cause = cause.cause;
	}
	return null;
}

function failed(error: unknown, request: Request, log: Logger, asked: Asked): Response {
	if (request.signal.aborted) return new Response(null, { status: 499 });
	if (error instanceof VangoghUnreachable) {
		const code = causeCode(error);
		warn(log, 'unreachable', asked, code ? { code } : {});
	} else if (error instanceof VangoghAuthError) {
		warn(log, 'login-rejected', asked);
	} else if (error instanceof VangoghHttpError) {
		warn(log, 'status', asked, { status: error.status });
	} else {
		throw error;
	}
	return problem(502, 'archive-unreachable');
}

function copy(from: Headers, names: string[]): Headers {
	const headers = new Headers();
	for (const name of names) {
		const value = from.get(name);
		if (value !== null) headers.set(name, value);
	}
	return headers;
}

/** A header value that offers the file under its name and nothing else. */
export function contentDisposition(filename: string): string {
	// Make well-formed to handle lone surrogates
	const wellformed = 'toWellFormed' in String.prototype
		? (filename as { toWellFormed(): string }).toWellFormed()
		: filename;
	const name =
		wellformed
			.replace(/[\u0000-\u001f\u007f]/g, '')
			.replace(/[\\/]/g, '_')
			.trim() || 'download';
	const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_');
	const encoded = encodeURIComponent(name).replace(
		/['()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
	);
	return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function proxyImage(
	client: VangoghFiles,
	imageId: string,
	request: Request,
	log: Logger = silentLogger
): Promise<Response> {
	if (!IMAGE_ID.test(imageId)) return problem(400, 'bad-image-id');
	const asked: Asked = { asked: 'image' };

	let upstream: Response;
	try {
		upstream = await client.image(imageId, {
			ifModifiedSince: request.headers.get('if-modified-since'),
			signal: request.signal
		});
	} catch (error) {
		return failed(error, request, log, asked);
	}

	if (upstream.status === 304) {
		await upstream.body?.cancel();
		return new Response(null, { status: 304, headers: { 'cache-control': YEAR } });
	}
	if (upstream.status === 404) {
		await upstream.body?.cancel();
		return problem(404, 'image-missing');
	}
	if (upstream.status !== 200) {
		await upstream.body?.cancel();
		warn(log, 'status', asked, { status: upstream.status });
		return problem(502, 'archive-unreachable');
	}
	// Only a type a browser shows as a picture: never one it would run, like HTML or SVG.
	const type = (upstream.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
	if (!IMAGE_TYPES.includes(type)) {
		await upstream.body?.cancel();
		warn(log, 'content-type', asked);
		return problem(502, 'archive-unreachable');
	}

	const headers = copy(upstream.headers, ['content-type', 'content-length', 'last-modified']);
	headers.set('cache-control', YEAR);
	headers.set('x-content-type-options', 'nosniff');
	return new Response(upstream.body, { status: 200, headers });
}

export async function proxyFile(
	client: VangoghFiles,
	target: FileTarget,
	request: Request,
	options: { check?: boolean; log?: Logger } = {}
): Promise<Response> {
	const log = options.log ?? silentLogger;
	const asked: Asked = { asked: 'file', gameId: target.productId, fileId: fileId(target.manualUrl) };
	let range: string | null = null;
	let ifRange: string | null = null;
	if (options.check) {
		range = 'bytes=0-0';
	} else {
		const asked = request.headers.get('range')?.trim() ?? '';
		if (RANGE.test(asked)) {
			range = asked;
			const condition = request.headers.get('if-range');
			if (condition !== null) {
				// A condition that cannot be passed on safely: send the whole file.
				if (condition.length > IF_RANGE_MAX || CONTROL.test(condition)) range = null;
				else ifRange = condition;
			}
		}
	}

	let upstream: Response;
	try {
		upstream = await client.file(target, { range, ifRange, signal: request.signal });
	} catch (error) {
		return failed(error, request, log, asked);
	}

	if (upstream.status === 404) {
		await upstream.body?.cancel();
		return problem(404, 'file-missing');
	}
	if (![200, 206, 416].includes(upstream.status)) {
		await upstream.body?.cancel();
		warn(log, 'status', asked, { status: upstream.status });
		return problem(502, 'archive-unreachable');
	}

	// vangogh cannot give the first byte of an empty file: it exists all the same.
	if (options.check && upstream.status === 416) {
		await upstream.body?.cancel();
		return new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } });
	}

	// Handle 416 before building file headers
	if (upstream.status === 416) {
		await upstream.body?.cancel();
		const headers = new Headers();
		const contentRange = upstream.headers.get('content-range');
		if (contentRange) headers.set('content-range', contentRange);
		headers.set('accept-ranges', 'bytes');
		headers.set('cache-control', 'no-store');
		return new Response(null, { status: 416, headers });
	}

	if (options.check) {
		await upstream.body?.cancel();
		return new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } });
	}

	const headers = copy(upstream.headers, FILE_HEADERS);
	headers.set('content-disposition', contentDisposition(target.filename));
	headers.set('cache-control', 'no-store');
	headers.set('x-content-type-options', 'nosniff');
	return new Response(upstream.body, {
		status: upstream.status,
		headers
	});
}
