import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { Socket } from 'node:net';
import { posix } from 'node:path';
import { Writable, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Client, type ClientChannel, type ServerHostKeyAlgorithm, type SFTPWrapper } from 'ssh2';

export interface BoxLogin {
	address: string;
	port: number;
	user: string;
	password: string;
	/** The fingerprint saved at the last passed connection test; null takes any key. */
	hostKey: string | null;
}

/** Nothing answers at the address, or not in time. */
export class BoxDown extends Error {
	constructor(cause?: unknown) {
		super('Batocera does not answer', { cause });
		this.name = 'BoxDown';
	}
}

/** The box refused the user or the password. */
export class BoxRefused extends Error {
	constructor() {
		super('Batocera refused the login');
		this.name = 'BoxRefused';
	}
}

/** The box's host key is not the one saved. */
export class BoxKeyChanged extends Error {
	constructor() {
		super("Batocera's key has changed");
		this.name = 'BoxKeyChanged';
	}
}

export interface Box {
	/** The fingerprint of the box's host key, as `fingerprint` writes it. */
	readonly hostKey: string;
	/** Runs a command; `code` is -1 when the box gave no exit status. */
	exec(command: string): Promise<{ code: number; stdout: string; stderr: string }>;
	/** The names in a folder, sorted; none for a folder that is not there. */
	list(dir: string): Promise<string[]>;
	/** Whether a path is a folder; false for a file or nothing. */
	isDir(path: string): Promise<boolean>;
	/** A file, or null when it is not there. */
	read(file: string): Promise<Buffer | null>;
	write(file: string, data: Buffer): Promise<void>;
	/** Makes a folder and the folders above it that are missing. */
	mkdirs(dir: string): Promise<void>;
	/**
	 * Writes a stream into a new file, with up to `CONCURRENCY` writes in flight at their offsets, as `fastPut`
	 * keeps them, the stream paused while they are. The stream is read to its end, or destroyed when the put
	 * fails; stopping rejects with an `AbortError` and leaves what was written.
	 */
	put(file: string, from: Readable, o: { signal: AbortSignal }): Promise<void>;
	/**
	 * Runs a long command on a terminal, so that it ends on the box when its channel closes; `output` is its
	 * stdout and stderr as the terminal mixed them, and `code` is -1 when a signal ended it. A channel that closes
	 * without the command's end, as when the connection ends, rejects with `BoxDown`. Stopping closes the
	 * channel and rejects with an `AbortError` once the box has closed it too, which it does when the command has
	 * ended there, so nothing writes any more; after 5 seconds it rejects anyway.
	 */
	run(command: string, o: { signal: AbortSignal }): Promise<{ code: number; output: string }>;
	rename(from: string, to: string): Promise<void>;
	/** EmulationStation's web interface, on the box's 127.0.0.1:1234; `type` is the body's content type. */
	es(method: 'GET' | 'POST', path: string, body?: string | Buffer, type?: string): Promise<{ status: number; body: string }>;
	close(): void;
}

/** A box that looks up the client's name can take 5 s or more before its first line; line 2 of the test names the 20 seconds. */
const CONNECT_MS = 20_000;
const ES_MS = 10_000;
const ES_PORT = 1234;
/** How long a stopped `run` waits for the box to close the command's channel. */
const STOP_MS = 5000;
/** Requests in flight per file, as the checks copied (spec 3.3). */
const CONCURRENCY = 64;
/** The bytes of one write request, as `fastPut` sends them. */
const CHUNK = 32 * 1024;
const NO_SUCH_FILE = 2;
/** ssh2 1.17.0's own order of host key types, pinned: a later ssh2 that reorders it could pick another of the box's keys and report "key changed". */
const HOST_KEY_TYPES: ServerHostKeyAlgorithm[] = ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa'];

/** OpenSSH's form: `SHA256:` and the base64 of the key's SHA-256, without `=`. */
export function fingerprint(key: Buffer): string {
	return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

/** Whether something takes a connection at the address and port. */
export function portOpen(address: string, port: number, timeoutMs: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = new Socket();
		const done = (open: boolean) => {
			clearTimeout(timer);
			socket.destroy();
			resolve(open);
		};
		const timer = setTimeout(() => done(false), timeoutMs);
		socket.once('connect', () => done(true));
		socket.once('error', () => done(false));
		socket.connect(port, address);
	});
}

function abortError(message = 'The upload was stopped'): Error {
	const error = new Error(message);
	error.name = 'AbortError';
	return error;
}

function missing(error: unknown): boolean {
	return (error as { code?: unknown })?.code === NO_SUCH_FILE;
}

type Done<T> = (err: Error | null | undefined, value: T) => void;

/** A callback of ssh2 as a promise; a closed connection throws instead of calling back. */
function call<T>(run: (done: Done<T>) => void): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		try {
			run((err, value) => (err ? reject(err) : resolve(value)));
		} catch (e) {
			reject(e);
		}
	});
}

/** The requests in flight on each SFTP channel; null once it closed. */
const inFlight = new WeakMap<SFTPWrapper, Set<(error: Error) => void> | null>();
const CHANNEL_CLOSED = 'the SFTP channel to Batocera closed';
const channelClosed = () => new Error(CHANNEL_CLOSED);
/** The SFTP channel's close above, and ssh2 1.17.0's own words for a call on a connection that ended. */
const LOST = new Set([CHANNEL_CLOSED, 'No response from server', 'Not connected']);

/** Whether a call on the box failed because its connection ended: `BoxDown`, or the words of `LOST`. */
export function connectionLost(error: unknown): boolean {
	return error instanceof BoxDown || (error instanceof Error && LOST.has(error.message));
}

function track(s: SFTPWrapper): SFTPWrapper {
	inFlight.set(s, new Set());
	s.once('close', () => {
		const waiting = inFlight.get(s);
		inFlight.set(s, null);
		for (const reject of waiting ?? []) reject(channelClosed());
	});
	return s;
}

/**
 * A request on an SFTP channel. ssh2 never calls back a request made after its channel closed,
 * so a closed channel fails it here.
 */
function op<T>(s: SFTPWrapper, run: (done: Done<T>) => void): Promise<T> {
	const waiting = inFlight.get(s);
	if (!waiting) return Promise.reject(channelClosed());
	return new Promise<T>((resolve, reject) => {
		waiting.add(reject);
		call(run)
			.then(resolve, reject)
			.finally(() => waiting.delete(reject));
	});
}

/**
 * An open file on an SFTP channel as a stream: each chunk goes out in requests of `CHUNK` bytes at their
 * offsets, up to `CONCURRENCY` in flight; a write waits while they are, which pauses the stream piped in.
 * It finishes once every request is answered, and a request that fails destroys it.
 */
function fileWriter(s: SFTPWrapper, handle: Buffer): Writable {
	let position = 0;
	let pending = 0;
	/** The write or the finish that waits for a request to be answered. */
	let waiting: (() => void) | null = null;
	const answered = () => {
		pending--;
		if (writer.destroyed) return;
		const next = waiting;
		waiting = null;
		next?.();
	};
	const writer = new Writable({
		write(chunk: Buffer, _encoding, callback) {
			let at = 0;
			const send = () => {
				while (at < chunk.length && pending < CONCURRENCY) {
					const piece = chunk.subarray(at, at + CHUNK);
					const offset = position;
					at += piece.length;
					position += piece.length;
					pending++;
					op<void>(s, (done) => s.write(handle, piece, 0, piece.length, offset, (err) => done(err, undefined))).then(answered, (error: Error) => writer.destroy(error));
				}
				if (at < chunk.length) waiting = send;
				else callback();
			};
			send();
		},
		final(callback) {
			const end = () => {
				if (pending === 0) callback();
				else waiting = end;
			};
			end();
		}
	});
	return writer;
}

async function isDir(s: SFTPWrapper, path: string): Promise<boolean> {
	try {
		return (await op<{ isDirectory(): boolean }>(s, (done) => s.stat(path, done))).isDirectory();
	} catch (error) {
		if (missing(error)) return false;
		throw error;
	}
}

async function mkdirs(s: SFTPWrapper, dir: string): Promise<void> {
	if (await isDir(s, dir)) return;
	const parent = posix.dirname(dir);
	if (parent !== dir) await mkdirs(s, parent);
	try {
		await op<void>(s, (done) => s.mkdir(dir, (err) => done(err, undefined)));
	} catch (error) {
		// Made meanwhile is fine; a file in its place is not.
		if (!(await isDir(s, dir))) throw error;
	}
}

/** Logs in to the box with its password, the host key checked against the saved one. */
export async function openBox(login: BoxLogin, o: { timeoutMs?: number } = {}): Promise<Box> {
	const timeoutMs = o.timeoutMs ?? CONNECT_MS;
	const client = new Client();
	let hostKey = '';
	let keyChanged = false;

	await new Promise<void>((resolve, reject) => {
		let settled = false;
		const fail = (error: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			client.destroy();
			reject(error);
		};
		const timer = setTimeout(() => fail(new BoxDown(new Error('timed out'))), timeoutMs);
		// Stays on after the login: an error then only ends the connection, and each call fails on its own.
		client.on('error', (err: Error & { level?: string }) => {
			if (keyChanged) fail(new BoxKeyChanged());
			else if (err.level === 'client-authentication') fail(new BoxRefused());
			else fail(new BoxDown(err));
		});
		client.once('close', () => fail(new BoxDown(new Error('the connection closed'))));
		client.once('ready', () => {
			settled = true;
			clearTimeout(timer);
			resolve();
		});
		client.connect({
			host: login.address,
			port: login.port,
			username: login.user,
			password: login.password,
			authHandler: ['password'],
			algorithms: { serverHostKey: HOST_KEY_TYPES },
			readyTimeout: timeoutMs,
			// A box that goes away (Wi-Fi drops, power off) ends the connection within about 15 s.
			keepaliveInterval: 5000,
			keepaliveCountMax: 3,
			hostVerifier: (key: Buffer): boolean => {
				hostKey = fingerprint(key);
				keyChanged = login.hostKey !== null && hostKey !== login.hostKey;
				return !keyChanged;
			}
		});
	});

	const openSftp = () => call<SFTPWrapper>((done) => client.sftp((err, s) => done(err, err ? s : track(s))));
	// One SFTP channel for the small calls, opened again when it closed.
	let shared: SFTPWrapper | null = null;
	let opening: Promise<SFTPWrapper> | null = null;
	const sftp = async () => {
		if (shared && inFlight.get(shared)) return shared;
		opening ??= openSftp().finally(() => (opening = null));
		shared = await opening;
		return shared;
	};

	return {
		hostKey,

		exec: (command) =>
			call((done) =>
				client.exec(command, (error, stream) => {
					if (error) return done(error, undefined as never);
					// At once: the exit status can come in the same packet as the channel.
					const out: Buffer[] = [];
					const err: Buffer[] = [];
					let code = -1;
					stream.on('data', (chunk: Buffer) => out.push(chunk));
					stream.stderr.on('data', (chunk: Buffer) => err.push(chunk));
					stream.on('exit', (status: number | null) => (code = status ?? -1));
					stream.on('close', () => done(null, { code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }));
				})
			),

		list: async (dir) => {
			const s = await sftp();
			try {
				const entries = await op<{ filename: string }[]>(s, (done) => s.readdir(dir, done));
				return entries.map((e) => e.filename).sort();
			} catch (error) {
				if (missing(error)) return [];
				throw error;
			}
		},

		isDir: async (path) => isDir(await sftp(), path),

		read: async (file) => {
			const s = await sftp();
			try {
				return await op<Buffer>(s, (done) => s.readFile(file, done));
			} catch (error) {
				if (missing(error)) return null;
				throw error;
			}
		},

		write: async (file, data) => {
			const s = await sftp();
			await op<void>(s, (done) => s.writeFile(file, data, (err) => done(err, undefined)));
		},

		mkdirs: async (dir) => mkdirs(await sftp(), dir),

		put: async (file, from, o) => {
			let opened: SFTPWrapper | undefined;
			const stop = () => opened?.end();
			o.signal.addEventListener('abort', stop, { once: true });
			try {
				if (o.signal.aborted) throw abortError();
				// A channel of its own, so that stopping ends what is in flight and nothing else.
				const s = (opened = await openSftp());
				if (o.signal.aborted) throw abortError();
				const handle = await op<Buffer>(s, (done) => s.open(file, 'w', done));
				await pipeline(from, fileWriter(s, handle), { signal: o.signal });
				await op<void>(s, (done) => s.close(handle, (err) => done(err, undefined)));
			} catch (error) {
				from.destroy();
				if (!o.signal.aborted) throw error;
			} finally {
				o.signal.removeEventListener('abort', stop);
				opened?.end();
			}
			if (o.signal.aborted) throw abortError();
		},

		run: (command, o) => {
			const stopped = () => abortError('The command was stopped');
			if (o.signal.aborted) return Promise.reject(stopped());
			return new Promise((resolve, reject) => {
				let channel: ClientChannel | undefined;
				let late: NodeJS.Timeout | undefined;
				let settled = false;
				// The box closes the channel once the command has ended there; a box that went away, only when the connection ends.
				const stop = () => {
					late = setTimeout(() => settle(stopped()), STOP_MS);
					channel?.close();
				};
				o.signal.addEventListener('abort', stop, { once: true });
				const settle = (error: Error | null, value?: { code: number; output: string }) => {
					if (settled) return;
					settled = true;
					clearTimeout(late);
					o.signal.removeEventListener('abort', stop);
					if (error) reject(error);
					else resolve(value as { code: number; output: string });
				};
				try {
					// A terminal: when its channel closes, the box ends the command, as sshd hangs up on it.
					client.exec(command, { pty: true }, (error, stream) => {
						if (error) return settle(o.signal.aborted ? stopped() : error);
						channel = stream;
						const out: Buffer[] = [];
						let code: number | null = null;
						stream.on('data', (chunk: Buffer) => out.push(chunk));
						stream.stderr.on('data', (chunk: Buffer) => out.push(chunk));
						// An exit status, or null and the signal's name when a signal ended it.
						stream.on('exit', (status: number | null) => (code = status ?? -1));
						stream.on('close', () => {
							if (o.signal.aborted) settle(stopped());
							// No `exit`: the connection ended, and the box with it, not the command.
							else if (code === null) settle(new BoxDown(new Error('the connection closed during a command')));
							else settle(null, { code, output: Buffer.concat(out).toString('utf8') });
						});
						if (o.signal.aborted) stream.close();
					});
				} catch (error) {
					settle(error as Error);
				}
			});
		},

		rename: async (from, to) => {
			const s = await sftp();
			await op<void>(s, (done) => s.rename(from, to, (err) => done(err, undefined)));
		},

		es: async (method, path, body, type) => {
			const held: { channel?: ClientChannel; over?: boolean } = {};
			let timer: NodeJS.Timeout | undefined;
			const answer = (async () => {
				const stream = await call<ClientChannel>((done) => client.forwardOut('127.0.0.1', 0, '127.0.0.1', ES_PORT, done));
				held.channel = stream;
				if (held.over) stream.destroy();
				return new Promise<{ status: number; body: string }>((resolve, reject) => {
					const headers: Record<string, string> = { connection: 'close' };
					if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(body));
					if (type !== undefined) headers['content-type'] = type;
					const req = request({ method, path, host: '127.0.0.1', port: ES_PORT, headers, createConnection: () => stream }, (res) => {
						// A 204 or 304 has no body by HTTP: it is read at its head. 43.1 writes a body after its 204 anyway,
						// which Node's parser then refuses, leniently or not, after the answer is in.
						if (res.statusCode === 204 || res.statusCode === 304) {
							res.resume();
							return resolve({ status: res.statusCode, body: '' });
						}
						const chunks: Buffer[] = [];
						res.on('data', (chunk: Buffer) => chunks.push(chunk));
						res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
						res.on('error', reject);
					});
					req.on('error', reject);
					req.end(body);
				});
			})();
			const late = new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error('EmulationStation did not answer in time')), ES_MS);
			});
			try {
				return await Promise.race([answer, late]);
			} finally {
				// A channel that opens after the time ran out is closed as it comes.
				held.over = true;
				clearTimeout(timer);
				held.channel?.destroy();
				answer.catch(() => {});
			}
		},

		close: () => {
			client.end();
		}
	};
}
