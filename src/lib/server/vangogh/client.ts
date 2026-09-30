import { silentLogger, type Logger } from '../log';

/** vangogh did not answer at all. */
export class VangoghUnreachable extends Error {
	constructor(cause?: unknown) {
		super('vangogh is not reachable', { cause });
		this.name = 'VangoghUnreachable';
	}
}

/** vangogh refused the login, or a token it had just issued. */
export class VangoghAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'VangoghAuthError';
	}
}

/** vangogh answered with a status that the call cannot use. */
export class VangoghHttpError extends Error {
	readonly status: number;
	constructor(status: number, path: string) {
		super(`vangogh answered ${status} for ${path}`);
		this.name = 'VangoghHttpError';
		this.status = status;
	}
}

export type DownloadType = 'installer' | 'downloadable-content';

export interface FileAddress {
	productId: string;
	downloadType: DownloadType;
	manualUrl: string;
}

/** The only metadata records Canvas reads. It asks for no other. */
export type MetadataType = 'gog-api-products' | 'gog-details';

const METADATA_TYPES: readonly string[] = ['gog-api-products', 'gog-details'];

export interface VangoghSource {
	availableProducts(): Promise<unknown>;
	metadata(type: MetadataType, id: string): Promise<unknown | null>;
	filenames(id: string): Promise<Record<string, string>>;
}

export interface VangoghFiles {
	image(
		imageId: string,
		options?: { ifModifiedSince?: string | null; signal?: AbortSignal }
	): Promise<Response>;
	file(address: FileAddress, options?: FileOptions): Promise<Response>;
}

export interface FileOptions {
	range?: string | null;
	/** Sent only together with a range. */
	ifRange?: string | null;
	signal?: AbortSignal;
}

export interface ClientOptions {
	url: string;
	username: string;
	password: string;
	fetch?: typeof fetch;
	log?: Logger;
	/** How long the login and a call that returns JSON may take. */
	timeoutMs?: number;
}

const TIMEOUT_MS = 30_000;

interface RequestOptions {
	headers?: Record<string, string>;
	signal?: AbortSignal;
}

const LOGIN = '/api/auth-user';

function isAbort(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

function isTimeout(error: unknown): boolean {
	return error instanceof Error && error.name === 'TimeoutError';
}

function segments(path: string): string {
	return path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

/** Validates a single ID component (type, id, imageId, productId, downloadType). */
function validateId(id: string): void {
	if (id === '' || id === '.' || id === '..') {
		throw new VangoghHttpError(400, '<refused address>');
	}
	if (id.includes('/') || id.includes('\\')) {
		throw new VangoghHttpError(400, '<refused address>');
	}
	try {
		const decoded = decodeURIComponent(id);
		if (decoded === '.' || decoded === '..') {
			throw new VangoghHttpError(400, '<refused address>');
		}
	} catch {
		throw new VangoghHttpError(400, '<refused address>');
	}
}

/** Validates a manualUrl path. */
function validateManualUrl(manualUrl: string): void {
	const parts = manualUrl.split('/').filter(Boolean);
	if (parts.length === 0) {
		throw new VangoghHttpError(400, '<refused address>');
	}
	for (const part of parts) {
		if (part.includes('\\')) {
			throw new VangoghHttpError(400, '<refused address>');
		}
		try {
			const decoded = decodeURIComponent(part);
			if (decoded === '.' || decoded === '..') {
				throw new VangoghHttpError(400, '<refused address>');
			}
		} catch {
			throw new VangoghHttpError(400, '<refused address>');
		}
	}
}

/** The only code that knows vangogh's addresses. */
export class VangoghClient implements VangoghSource, VangoghFiles {
	readonly #url: string;
	readonly #username: string;
	readonly #password: string;
	readonly #fetch: typeof fetch;
	readonly #log: Logger;
	readonly #timeoutMs: number;
	#currentToken: string | null = null;
	#pendingLogin: Promise<string> | null = null;
	#rejected = false;

	constructor(options: ClientOptions) {
		this.#url = options.url.replace(/\/+$/, '');
		this.#username = options.username;
		this.#password = options.password;
		this.#fetch = options.fetch ?? fetch;
		this.#log = options.log ?? silentLogger;
		this.#timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
	}

	/** True after vangogh refused the password, until `resetAuth`. */
	get loginRejected(): boolean {
		return this.#rejected;
	}

	/** Allows one more login after a refused password. */
	resetAuth(): void {
		this.#rejected = false;
	}

	async #send(path: string, init: RequestInit): Promise<Response> {
		try {
			return await this.#fetch(`${this.#url}${path}`, init);
		} catch (error) {
			if (isAbort(error)) throw error;
			throw new VangoghUnreachable(error);
		}
	}

	async #logIn(): Promise<string> {
		const signal = AbortSignal.timeout(this.#timeoutMs);
		const res = await this.#send(LOGIN, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				username: this.#username,
				password: this.#password
			}).toString(),
			signal
		});
		if (res.status === 401 || res.status === 403) {
			await res.body?.cancel();
			this.#rejected = true;
			this.#log.error('vangogh rejected the login', { username: this.#username });
			throw new VangoghAuthError('vangogh rejected the login');
		}
		if (!res.ok) {
			await res.body?.cancel();
			throw new VangoghHttpError(res.status, LOGIN);
		}
		const body = (await res.json().catch((error: unknown) => {
			if (isTimeout(error)) throw new VangoghUnreachable(error);
			return null;
		})) as { token?: unknown } | null;
		if (typeof body?.token !== 'string' || body.token === '') {
			throw new VangoghHttpError(res.status, LOGIN);
		}
		this.#currentToken = body.token;
		return body.token;
	}

	#ensureToken(): Promise<string> {
		if (this.#currentToken) return Promise.resolve(this.#currentToken);
		if (this.#rejected) {
			return Promise.reject(
				new VangoghAuthError('the login was rejected; not trying again until the next rebuild')
			);
		}
		this.#pendingLogin ??= this.#logIn().finally(() => {
			this.#pendingLogin = null;
		});
		return this.#pendingLogin;
	}

	/** A request with the token. Logs in again once when the token is refused. */
	async #raw(path: string, options: RequestOptions = {}): Promise<Response> {
		const attempt = async () => {
			const token = await this.#ensureToken();
			const res = await this.#send(path, {
				headers: { ...options.headers, authorization: `Bearer ${token}` },
				signal: options.signal
			});
			return { res, token };
		};

		const first = await attempt();
		if (first.res.status !== 401) return first.res;
		await first.res.body?.cancel();
		if (this.#currentToken === first.token) this.#currentToken = null;

		const second = await attempt();
		if (second.res.status !== 401) return second.res;
		await second.res.body?.cancel();
		if (this.#currentToken === second.token) this.#currentToken = null;
		throw new VangoghAuthError('vangogh rejected a token it had just issued');
	}

	async #json(path: string): Promise<unknown | null> {
		const res = await this.#raw(path, { signal: AbortSignal.timeout(this.#timeoutMs) });
		if (res.status === 404) {
			await res.body?.cancel();
			return null;
		}
		if (!res.ok) {
			await res.body?.cancel();
			throw new VangoghHttpError(res.status, path);
		}
		try {
			return await res.json();
		} catch (error) {
			if (isTimeout(error)) throw new VangoghUnreachable(error);
			throw new VangoghHttpError(res.status, path);
		}
	}

	async availableProducts(): Promise<unknown> {
		const path = '/api/available-products';
		const body = await this.#json(path);
		if (body === null) throw new VangoghHttpError(404, path);
		return body;
	}

	async metadata(type: MetadataType, id: string): Promise<unknown | null> {
		// The type is checked when the program runs too: no other record may ever be asked for.
		if (!METADATA_TYPES.includes(type)) throw new VangoghHttpError(400, '<refused address>');
		validateId(id);
		return this.#json(`/api/metadata/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
	}

	async filenames(id: string): Promise<Record<string, string>> {
		validateId(id);
		const body = await this.#json(`/api/gog/filenames/${encodeURIComponent(id)}`);
		const names: Record<string, string> = {};
		if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
			for (const [manualUrl, name] of Object.entries(body)) {
				if (typeof name === 'string' && name !== '') names[manualUrl] = name;
			}
		}
		return names;
	}

	async image(
		imageId: string,
		options: { ifModifiedSince?: string | null; signal?: AbortSignal } = {}
	): Promise<Response> {
		validateId(imageId);
		return this.#raw(`/api/gog/image/${encodeURIComponent(imageId)}`, {
			headers: options.ifModifiedSince ? { 'if-modified-since': options.ifModifiedSince } : {},
			signal: options.signal
		});
	}

	async file(address: FileAddress, options: FileOptions = {}): Promise<Response> {
		validateId(address.productId);
		validateId(address.downloadType);
		validateManualUrl(address.manualUrl);
		const path = [
			'/api/gog/manual-url',
			encodeURIComponent(address.productId),
			encodeURIComponent(address.downloadType),
			segments(address.manualUrl)
		].join('/');
		const headers: Record<string, string> = {};
		if (options.range) {
			headers.range = options.range;
			if (options.ifRange) headers['if-range'] = options.ifRange;
		}
		return this.#raw(path, { headers, signal: options.signal });
	}
}
