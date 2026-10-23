import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, open, readdir, rename, rm, rmdir, stat, unlink, writeFile, type FileHandle } from 'node:fs/promises';
import { createSocket } from 'node:dgram';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, posix, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ssh2, { type Attributes, type Connection, type SFTPWrapper } from 'ssh2';
import { COMMANDS, SYSTEM_DIR, bytesCommand, filesCommand, removeCommand, removeInPartCommand, supportCommand, unpackCommand } from '../batocera/commands';
import { magicPacket } from '../batocera/wake';

// ssh2 is CommonJS: Node's own loader, which the browser tests' setup runs in, has its parts only on the default export.
const { Server, utils } = ssh2;

/** A game in EmulationStation's list: its whole path on the box, and its details by their metadata keys. */
export interface FakeGame {
	path: string;
	desc: string;
	[key: string]: string;
}

/** The fake EmulationStation, reached through the box's forwarded port 127.0.0.1:1234, as 43.1 answers. */
export interface FakeEs {
	/** False: the forwarded port is refused, as when EmulationStation does not run. */
	up: boolean;
	/** What `/isIdle` says: 200 with `[ true ]`, or 201 with `[ false ]` while a game runs. */
	idle: boolean;
	/** The game `/runningGame` names; `/emukill` clears it. */
	running: string | null;
	/** The path `/runningGame` gives with the name, as 43.1 does: `/launch` sets it, `/emukill` clears it; null for a game set by its name only. */
	runningPath: string | null;
	/** True: `/launch` of a game in the list does nothing, as a start that does not happen. */
	startIgnored: boolean;
	reloads: number;
	/** How long after its answer `/reloadgames` reads the folders: 43.1 reloads on its own thread. */
	reloadMs: number;
	/** How many of the next `GET`s of a single game are dropped without an answer, as while EmulationStation is busy. */
	failGets: number;
	/** Each `POST /addgames/<system>`, its XML as sent; 43.1 adds nothing from it. */
	added: { system: string; xml: string }[];
	/** Each `POST /systems/<system>/games/<id>` of a game in the list, its JSON as sent. */
	written: { system: string; id: string; json: string }[];
	/** Each picture of a game in the list, `POST /systems/<system>/games/<id>/media/<type>`. */
	media: { system: string; id: string; type: string; contentType: string }[];
	/** The bodies of `POST /launch`, of games in the list or not. */
	launched: string[];
	killed: number;
	/** The list of each system, as EmulationStation keeps it: a game joins at the reload after its folder came. */
	games: Record<string, FakeGame[]>;
}

export interface FakeBatocera {
	port: number;
	/** The folder that stands for the box's `/`: `/userdata/x` is `<root>/userdata/x`. */
	root: string;
	/** The host key's fingerprint, as OpenSSH writes it. */
	fingerprint: string;
	user: string;
	password: string;
	/** The free bytes of `/userdata`; `df` shows them in KiB, rounded down. */
	freeBytes: number;
	/** What `xrandr --listPrimary` says; null for a box started while the TV was off. */
	primary: string | null;
	mac: string;
	/** The UDP port on 127.0.0.1 where a magic packet for `mac` turns the box on. */
	wakePort: number;
	/** The address of the control endpoint, with `control: true`. */
	control: string | null;
	shutdowns: number;
	/** Whether the box has innoextract: `command -v innoextract` finds it, and the box runs it. */
	innoextract: boolean;
	/** The paths on the box of the installers innoextract was run on, in order. */
	unpacked: string[];
	/** The unpackers running now. */
	unpacking: number;
	es: FakeEs;
	/** Told of each SFTP request that names a path, as it arrives: a test can turn the box off at a chosen moment. */
	onSftp: ((op: string, path: string) => void) | null;
	isOn(): boolean;
	/** Stops listening and drops every connection, as a box that goes away. */
	off(): Promise<void>;
	/** Listens again on the same port. */
	on(): Promise<void>;
	close(): Promise<void>;
}

export interface FakeBatoceraOptions {
	user?: string;
	password?: string;
	freeBytes?: number;
	mac?: string;
	/** How long the box takes to answer after a magic packet. */
	bootMs?: number;
	/** An HTTP endpoint that sets the fake's state, for the browser tests. */
	control?: boolean;
	/** How long the box takes a connection before it says its first line, as a box that looks up the client's name. */
	greetingDelayMs?: number;
	/** The program that stands for the box's innoextract, run by Node: `tests/fake-innoextract.mjs` by default. */
	unpacker?: string;
}

const VERSION = '43.1 2026/05/29 00:00';
const ES_PORT = 1234;
const ADDRESS = '10.0.0.21';
const USED_KIB = 60_000_000;
const { STATUS_CODE, flagsToString } = utils.sftp;
/** OpenSSH's sftp-server says no more than this. */
const MESSAGES: Record<number, string> = {
	[STATUS_CODE.NO_SUCH_FILE]: 'No such file',
	[STATUS_CODE.PERMISSION_DENIED]: 'Permission denied',
	[STATUS_CODE.FAILURE]: 'Failure',
	[STATUS_CODE.OP_UNSUPPORTED]: 'Operation unsupported'
};

type Handle = { kind: 'file'; fd: FileHandle } | { kind: 'dir'; path: string; names: string[] };

class Refused extends Error {
	constructor(readonly status: number) {
		super(MESSAGES[status]);
	}
}

function statusOf(error: unknown): number {
	if (error instanceof Refused) return error.status;
	const code = (error as { code?: unknown })?.code;
	if (code === 'ENOENT') return STATUS_CODE.NO_SUCH_FILE;
	if (code === 'EACCES' || code === 'EPERM') return STATUS_CODE.PERMISSION_DENIED;
	return STATUS_CODE.FAILURE;
}

function attrsOf(st: Stats): Attributes {
	return { mode: st.mode, uid: st.uid, gid: st.gid, size: st.size, atime: Math.floor(st.atimeMs / 1000), mtime: Math.floor(st.mtimeMs / 1000) };
}

function readBody(req: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', (chunk: Buffer) => chunks.push(chunk));
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}

/** The files under a local folder, as paths relative to it with `/`, as `find -type f` lists them. */
async function filesUnder(dir: string, at = ''): Promise<string[]> {
	const found: string[] = [];
	for (const entry of await readdir(join(dir, at), { withFileTypes: true })) {
		const path = at === '' ? entry.name : `${at}/${entry.name}`;
		if (entry.isDirectory()) found.push(...(await filesUnder(dir, path)));
		else if (entry.isFile()) found.push(path);
	}
	return found;
}

/** The bytes of the files under a local folder, which the box's `du` stands for. */
async function bytesUnder(dir: string): Promise<number> {
	let bytes = 0;
	for (const file of await filesUnder(dir)) bytes += (await lstat(join(dir, file))).size;
	return bytes;
}

/** A word of a command as `shellQuote` writes it; `words` gives what it says. */
const WORD = String.raw`'((?:[^']|'\\'')*)'`;

/** What the words of `command` say, when it has the shape of `pattern`, with `WORD` for each word; else null. */
function words(command: string, pattern: string): string[] | null {
	const match = new RegExp(`^${pattern}$`, 's').exec(command);
	return match ? match.slice(1).map((word) => word.replace(/'\\''/g, "'")) : null;
}

/** True when `build` gives `command` again; a builder that throws refuses it. */
function same(command: string, build: () => string): boolean {
	try {
		return build() === command;
	} catch {
		return false;
	}
}

/** EmulationStation's id of a game: the MD5 of its whole path, as hex. */
const idOf = (path: string) => createHash('md5').update(path).digest('hex');

/** Where 43.1 keeps a picture it is given (`Scraper::getSaveAsPath`), by the metadata key. */
const SUFFIX: Record<string, string> = { image: 'image', thumbnail: 'thumb', fanart: 'fanart' };
const EXTENSION: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png' };

function send(res: ServerResponse, status: number, body = '', type = 'text/plain'): void {
	res.writeHead(status, { 'content-type': type, 'content-length': String(Buffer.byteLength(body)) });
	res.end(body);
}

/** An ed25519 host key, and its public key as the box sends it. */
function makeHostKey(): { hostKey: string; publicKey: Buffer } {
	// ssh2 1.17 makes a key it cannot read once in 256: a public key that starts with a zero byte loses it.
	for (;;) {
		const hostKey = utils.generateKeyPairSync('ed25519').private;
		const parsed = utils.parseKey(hostKey);
		if (!(parsed instanceof Error)) return { hostKey, publicKey: parsed.getPublicSSH() };
	}
}

/** A box as Canvas sees it over SSH, in the test process: an `ssh2` server on 127.0.0.1. */
export async function startFakeBatocera(o: FakeBatoceraOptions = {}): Promise<FakeBatocera> {
	const { hostKey, publicKey } = makeHostKey();
	const root = await mkdtemp(join(tmpdir(), 'fake-batocera-'));
	const unpacker = o.unpacker ?? fileURLToPath(new URL('../../../../tests/fake-innoextract.mjs', import.meta.url));
	for (const dir of Object.values(SYSTEM_DIR)) await mkdir(join(root, dir), { recursive: true });

	/** The local path of a path on the box; nothing outside `root`. */
	const local = (path: string): string => {
		const mapped = join(root, posix.resolve('/', path));
		if (mapped !== root && !mapped.startsWith(root + sep)) throw new Refused(STATUS_CODE.PERMISSION_DENIED);
		return mapped;
	};

	const es: FakeEs = { up: true, idle: true, running: null, runningPath: null, startIgnored: false, reloads: 0, reloadMs: 0, failGets: 0, added: [], written: [], media: [], launched: [], killed: 0, games: {} };
	let tcp: TcpServer | null = null;
	let shutdownTimer: NodeJS.Timeout | undefined;
	let bootTimer: NodeJS.Timeout | undefined;
	let closed = false;
	let rescanTimer: NodeJS.Timeout | undefined;
	/** How long the box takes a connection before it greets; the control endpoint can change it. */
	let greetingDelayMs = o.greetingDelayMs ?? 0;
	/** How long the box takes to answer after a magic packet, and how long each SFTP write takes; the control endpoint can change them. */
	let bootMs = o.bootMs ?? 200;
	let writeDelayMs = 0;

	/** What `/reloadgames` finds: each `.pc` folder of a system joins its list, without details. */
	const rescan = async () => {
		for (const [system, dir] of Object.entries(SYSTEM_DIR)) {
			const list = (es.games[system] ??= []);
			for (const entry of await readdir(local(dir), { withFileTypes: true })) {
				const path = `${dir}/${entry.name}`;
				if (entry.isDirectory() && entry.name.endsWith('.pc') && !list.some((g) => g.path === path)) list.push({ path, desc: '' });
			}
		}
	};

	const answerEs = async (req: IncomingMessage, res: ServerResponse) => {
		const path = new URL(req.url ?? '/', 'http://es').pathname;
		const body = await readBody(req);
		const json = (status: number, value: unknown) => send(res, status, JSON.stringify(value), 'application/json');
		const get = req.method === 'GET';
		const post = req.method === 'POST';
		if (get && path === '/caps') return json(200, { Version: VERSION });
		// As 43.1: 200 while idle, 201 while a game runs.
		if (get && path === '/isIdle') return send(res, es.idle ? 200 : 201, `[ ${es.idle} ]`, 'application/json');
		if (get && path === '/runningGame') {
			if (es.running === null) return json(201, { msg: 'NO GAME RUNNING' });
			return json(200, es.runningPath === null ? { name: es.running } : { name: es.running, path: es.runningPath });
		}
		if (get && path === '/reloadgames') {
			es.reloads++;
			rescanTimer = setTimeout(() => void rescan().catch(() => {}), es.reloadMs);
			return send(res, 200, 'OK');
		}
		if (get && path === '/emukill') {
			es.running = es.runningPath = null;
			es.killed++;
			return send(res, 200, 'OK');
		}
		if (post && path === '/launch') {
			const launched = body.toString('utf8');
			es.launched.push(launched);
			// As 43.1: the path is looked up in the list, and one it does not list is answered 200 all the same.
			const game = Object.values(es.games).flat().find((g) => g.path === launched);
			if (game && !es.startIgnored) {
				es.running = game.name || posix.basename(launched, '.pc');
				es.runningPath = launched;
			}
			return send(res, 200, 'OK');
		}
		let match = /^\/addgames\/([^/]+)$/.exec(path);
		if (post && match) {
			// 43.1 reads the body as a file name, never as a list, and adds nothing; it says so in a body on its 204,
			// which a strict HTTP parser refuses, so the answer is written as it comes.
			es.added.push({ system: match[1], xml: body.toString('utf8') });
			const said = 'No game added / updated';
			res.socket?.end(`HTTP/1.1 204 No Content\r\nContent-Length: ${said.length}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${said}`);
			return;
		}
		match = /^\/systems\/([^/]+)\/games$/.exec(path);
		if (get && match) return json(200, (es.games[match[1]] ?? []).map((g) => ({ id: idOf(g.path), ...g })));
		const one = /^\/systems\/([^/]+)\/games\/([0-9a-f]+)(?:\/media\/([a-z]+))?$/.exec(path);
		if (!one) return send(res, 404, 'Not found');
		const [, system, id, type] = one;
		const game = (es.games[system] ?? []).find((g) => idOf(g.path) === id);
		if (!game) return send(res, 404, '404 game not found');
		if (get && !type) {
			if (es.failGets > 0) {
				es.failGets--;
				req.socket.destroy();
				return;
			}
			return json(200, { id, ...game });
		}
		if (post && !type) {
			// `ImportFromJson`: an object of metadata keys and string values.
			const text = body.toString('utf8');
			let fields: unknown;
			try {
				fields = JSON.parse(text);
			} catch {
				return send(res, 400, 'Bad JSON');
			}
			if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) return send(res, 400, 'Bad JSON');
			es.written.push({ system, id, json: text });
			for (const [key, value] of Object.entries(fields)) if (key !== 'path' && typeof value === 'string') game[key] = value;
			return send(res, 200);
		}
		if (post && type) {
			// `ImportMedia`: the picture goes where the scraper keeps its own, and the game records it.
			const contentType = req.headers['content-type'] ?? '';
			if (!SUFFIX[type] || !EXTENSION[contentType]) return send(res, 400, 'Bad media');
			const file = `/userdata/roms/${system}/images/${posix.basename(game.path, '.pc')}-${SUFFIX[type]}${EXTENSION[contentType]}`;
			await mkdir(dirname(local(file)), { recursive: true });
			await writeFile(local(file), body);
			game[type] = file;
			es.media.push({ system, id, type, contentType });
			return send(res, 200);
		}
		send(res, 404, 'Not found');
	};
	const esServer = createHttpServer((req, res) => void answerEs(req, res).catch(() => res.destroy()));

	/** innoextract on the box: the unpacker, run by Node as innoextract is called, on the local paths; `hangUp` ends it. */
	const unpack = (installer: string, part: string, hangUp: AbortSignal | undefined) =>
		new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
			fake.unpacked.push(installer);
			fake.unpacking++;
			const child = spawn(process.execPath, [unpacker, '--silent', '--exclude-temp', '--output-dir', local(part), local(installer)], { stdio: ['ignore', 'pipe', 'pipe'], signal: hangUp });
			const out: Buffer[] = [];
			const err: Buffer[] = [];
			child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
			child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
			child.once('error', reject);
			// Once the process is gone, also after a failed start or a hang-up.
			child.once('close', (code) => {
				fake.unpacking--;
				resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
			});
		});

	/**
	 * The commands of `commands.ts`, as the box answers them; any other exits 127. `hangUp` is the close of the
	 * command's channel when it runs on a terminal, which sshd hangs up on; without one a command runs on.
	 */
	const run = async (command: string, hangUp?: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }> => {
		const ok = (stdout: string) => ({ code: 0, stdout, stderr: '' });
		switch (command) {
			case COMMANDS.df: {
				const free = Math.floor(fake.freeBytes / 1024);
				return ok(`Filesystem     1024-blocks      Used Available Capacity Mounted on\n/dev/sda2      ${USED_KIB + free} ${USED_KIB} ${free}  13% /userdata\n`);
			}
			case COMMANDS.version:
				return ok(`${VERSION}\n`);
			case COMMANDS.ip:
				return ok(
					[
						'1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever preferred_lft forever',
						`2: eth0    inet ${ADDRESS}/24 brd 10.0.0.255 scope global eth0\\       valid_lft forever preferred_lft forever`,
						'1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\\    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00',
						`2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP mode DEFAULT group default qlen 1000\\    link/ether ${fake.mac} brd ff:ff:ff:ff:ff:ff`,
						'3: wlan0: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN mode DORMANT group default qlen 1000\\    link/ether 02:00:00:aa:bb:01 brd ff:ff:ff:ff:ff:ff',
						''
					].join('\n')
				);
			case COMMANDS.primary:
				return ok(fake.primary === null ? '' : `${fake.primary}\n`);
			case COMMANDS.shutdown:
				fake.shutdowns++;
				clearTimeout(shutdownTimer);
				shutdownTimer = setTimeout(() => void fake.off().catch(() => {}), 100);
				// As 43.1's batocera-es-swissknife, which ends with 11 once it has started the shutdown.
				return { code: 11, stdout: '', stderr: '' };
			case COMMANDS.innoextract:
				return fake.innoextract ? ok('/usr/bin/innoextract\n') : { code: 1, stdout: '', stderr: '' };
		}
		// Each command built by a function is parsed into its paths, built again from them, and answered only when the two are equal.
		const unpacking = words(command, `innoextract --silent --exclude-temp --output-dir ${WORD} ${WORD}`);
		if (unpacking && fake.innoextract) {
			const [part, installer] = unpacking;
			if (same(command, () => unpackCommand(installer, part))) return unpack(installer, part, hangUp);
		}
		const [bytesOf] = words(command, `du -sk -- ${WORD}`) ?? [];
		if (bytesOf !== undefined && same(command, () => bytesCommand(bytesOf))) {
			// `du` counts KiB, rounded up.
			return ok(`${Math.ceil((await bytesUnder(local(bytesOf))) / 1024)}\t${bytesOf}\n`);
		}
		const [filesOf] = words(command, `find ${WORD} -type f`) ?? [];
		if (filesOf !== undefined && same(command, () => filesCommand(filesOf))) {
			return ok((await filesUnder(local(filesOf))).map((file) => `${filesOf}/${file}\n`).join(''));
		}
		const [, , into] = words(command, `if \\[ -d ${WORD} \\]; then cp -a ${WORD} ${WORD}; fi`) ?? [];
		const supportOf = into?.slice(0, -1);
		if (supportOf !== undefined && same(command, () => supportCommand(supportOf))) {
			const app = local(`${supportOf}/__support/app`);
			if (await stat(app).then((st) => st.isDirectory(), () => false)) await cp(app, local(supportOf), { recursive: true, force: true });
			return ok('');
		}
		const [path] = words(command, `rm -rf -- ${WORD}`) ?? [];
		if (path !== undefined) {
			const at = path.lastIndexOf('/');
			if (same(command, () => removeCommand(path)) || same(command, () => removeInPartCommand(path.slice(0, at), path.slice(at + 1)))) {
				await rm(local(path), { recursive: true, force: true });
				return ok('');
			}
		}
		return { code: 127, stdout: '', stderr: `sh: ${command.split(' ')[0]}: not found\n` };
	};

	/** SFTP on the files under `root`, one request after another, as OpenSSH's sftp-server. */
	const serveSftp = (sftp: SFTPWrapper) => {
		const handles = new Map<number, Handle>();
		let last = 0;
		let queue = Promise.resolve();
		let gone = false;
		sftp.on('close', () => {
			gone = true;
			for (const h of handles.values()) if (h.kind === 'file') void h.fd.close().catch(() => {});
			handles.clear();
			// ssh2 does not answer the client's close of an SFTP channel itself; sshd does.
			sftp.end();
		});
		const handleFor = (h: Handle) => {
			handles.set(++last, h);
			const id = Buffer.alloc(4);
			id.writeUInt32BE(last);
			return id;
		};
		const held = (id: Buffer) => (id.length === 4 ? handles.get(id.readUInt32BE(0)) : undefined);
		const file = (id: Buffer) => {
			const h = held(id);
			if (h?.kind !== 'file') throw new Refused(STATUS_CODE.FAILURE);
			return h;
		};
		const serve = (event: string, work: (reqId: number, ...args: never[]) => Promise<void>) => {
			sftp.on(event, (reqId: number, ...args: never[]) => {
				const path: unknown = args[0];
				if (typeof path === 'string') fake.onSftp?.(event, path);
				queue = queue.then(async () => {
					if (gone) return;
					try {
						await work(reqId, ...args);
					} catch (error) {
						const status = statusOf(error);
						sftp.status(reqId, status, MESSAGES[status]);
					}
				});
			});
		};
		const done = (reqId: number) => sftp.status(reqId, STATUS_CODE.OK);

		serve('OPEN', async (reqId, path: string, flags: number) => {
			const mode = flagsToString(flags);
			if (mode === null) throw new Refused(STATUS_CODE.OP_UNSUPPORTED);
			const fd = await open(local(path), mode);
			if (gone) {
				await fd.close();
				return;
			}
			sftp.handle(reqId, handleFor({ kind: 'file', fd }));
		});
		serve('READ', async (reqId, id: Buffer, offset: number, length: number) => {
			const buffer = Buffer.alloc(Math.min(length, 256 * 1024));
			const { bytesRead } = await file(id).fd.read(buffer, 0, buffer.length, offset);
			if (bytesRead === 0) sftp.status(reqId, STATUS_CODE.EOF);
			else sftp.data(reqId, buffer.subarray(0, bytesRead));
		});
		serve('WRITE', async (reqId, id: Buffer, offset: number, data: Buffer) => {
			if (writeDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, writeDelayMs));
			await file(id).fd.write(data, 0, data.length, offset);
			done(reqId);
		});
		serve('FSTAT', async (reqId, id: Buffer) => sftp.attrs(reqId, attrsOf(await file(id).fd.stat())));
		serve('STAT', async (reqId, path: string) => sftp.attrs(reqId, attrsOf(await stat(local(path)))));
		serve('LSTAT', async (reqId, path: string) => sftp.attrs(reqId, attrsOf(await lstat(local(path)))));
		serve('SETSTAT', async (reqId) => done(reqId));
		serve('FSETSTAT', async (reqId) => done(reqId));
		serve('OPENDIR', async (reqId, path: string) => {
			const dir = local(path);
			if (!(await stat(dir)).isDirectory()) throw new Refused(STATUS_CODE.FAILURE);
			sftp.handle(reqId, handleFor({ kind: 'dir', path: dir, names: await readdir(dir) }));
		});
		serve('READDIR', async (reqId, id: Buffer) => {
			const h = held(id);
			if (h?.kind !== 'dir') throw new Refused(STATUS_CODE.FAILURE);
			if (h.names.length === 0) return sftp.status(reqId, STATUS_CODE.EOF);
			const entries = [];
			for (const name of h.names.splice(0, 100)) {
				const st = await lstat(join(h.path, name)).catch(() => null);
				if (st) entries.push({ filename: name, longname: name, attrs: attrsOf(st) });
			}
			sftp.name(reqId, entries);
		});
		serve('CLOSE', async (reqId, id: Buffer) => {
			const h = held(id);
			if (!h) throw new Refused(STATUS_CODE.FAILURE);
			handles.delete(id.readUInt32BE(0));
			if (h.kind === 'file') await h.fd.close();
			done(reqId);
		});
		serve('MKDIR', async (reqId, path: string) => {
			await mkdir(local(path));
			done(reqId);
		});
		serve('RMDIR', async (reqId, path: string) => {
			await rmdir(local(path));
			done(reqId);
		});
		serve('REMOVE', async (reqId, path: string) => {
			await unlink(local(path));
			done(reqId);
		});
		serve('RENAME', async (reqId, from: string, to: string) => {
			// As OpenSSH's sftp-server: never onto something that is there.
			if (await lstat(local(to)).then(() => true, () => false)) throw new Refused(STATUS_CODE.FAILURE);
			await rename(local(from), local(to));
			done(reqId);
		});
		serve('REALPATH', async (reqId, path: string) => {
			const resolved = posix.resolve('/', path);
			sftp.name(reqId, [{ filename: resolved, longname: resolved, attrs: {} as Attributes }]);
		});
	};

	const onConnection = (client: Connection) => {
		client.on('error', () => {});
		client.on('authentication', (ctx) => {
			if (ctx.method === 'password' && ctx.username === fake.user && ctx.password === fake.password) ctx.accept();
			else ctx.reject(['password']);
		});
		client.on('ready', () => {
			client.on('session', (accept) => {
				const session = accept();
				let pty = false;
				session.on('pty', (accept) => {
					pty = true;
					accept?.();
				});
				session.on('exec', (accept, _reject, info) => {
					const channel = accept();
					const failed = { code: 1, stdout: '', stderr: 'rm: cannot remove\n' };
					// Read, so that the channel's end and close are seen: by the client, or as the connection drops.
					const ended = new AbortController();
					channel.once('close', () => ended.abort());
					channel.resume();
					void run(info.command, pty ? ended.signal : undefined).catch(() => failed).then(({ code, stdout, stderr }) => {
						if (ended.signal.aborted) return;
						if (stdout) channel.write(stdout);
						// A terminal mixes the two into one stream.
						if (stderr) (pty ? channel : channel.stderr).write(stderr);
						channel.exit(code);
						channel.end();
					});
				});
				session.on('sftp', (accept) => serveSftp(accept()));
			});
			client.on('tcpip', (accept, reject, info) => {
				if (!fake.es.up || info.destIP !== '127.0.0.1' || info.destPort !== ES_PORT) return reject();
				esServer.emit('connection', accept());
			});
		});
	};

	const ssh = new Server({ hostKeys: [hostKey] }, onConnection);
	ssh.on('error', () => {});
	const sockets = new Set<Socket>();
	const listen = async (at: number) => {
		const server = createTcpServer((socket) => {
			sockets.add(socket);
			socket.once('close', () => sockets.delete(socket));
			socket.on('error', () => {});
			const greet = () => {
				if (!socket.destroyed) ssh.injectSocket(socket);
			};
			if (greetingDelayMs) setTimeout(greet, greetingDelayMs);
			else greet();
		});
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(at, '127.0.0.1', () => {
				server.off('error', reject);
				resolve();
			});
		});
		tcp = server;
		return (server.address() as AddressInfo).port;
	};

	// Turning on and off one after another, whoever asks: a timer, the control endpoint, a test.
	let turning = Promise.resolve();
	const serial = (work: () => Promise<void>) => {
		const next = turning.then(work);
		turning = next.catch(() => {});
		return next;
	};

	const wake = createSocket('udp4');
	wake.on('message', (packet) => {
		let valid = false;
		try {
			valid = packet.equals(magicPacket(fake.mac));
		} catch {
			valid = false;
		}
		if (!valid || closed || tcp !== null || bootTimer !== undefined) return;
		bootTimer = setTimeout(() => {
			bootTimer = undefined;
			void fake.on().catch(() => {});
		}, bootMs);
	});
	await new Promise<void>((resolve) => wake.bind(0, '127.0.0.1', resolve));

	/** `POST /` with any of `{ freeBytes, primary, running, idle, esUp, on, greetingDelayMs, bootMs, writeDelayMs, innoextract }` sets them. */
	const answerControl = async (req: IncomingMessage, res: ServerResponse) => {
		if (req.method !== 'POST' || new URL(req.url ?? '/', 'http://control').pathname !== '/') return send(res, 404, 'Not found');
		let state: Record<string, unknown>;
		try {
			state = JSON.parse((await readBody(req)).toString('utf8'));
			if (typeof state !== 'object' || state === null) throw new Error('not an object');
		} catch {
			return send(res, 400, 'Bad JSON');
		}
		const text = (v: unknown) => typeof v === 'string' || v === null;
		if (typeof state.freeBytes === 'number') fake.freeBytes = state.freeBytes;
		if (text(state.primary)) fake.primary = state.primary as string | null;
		if (text(state.running)) {
			es.running = state.running as string | null;
			es.runningPath = null;
		}
		if (typeof state.idle === 'boolean') es.idle = state.idle;
		if (typeof state.esUp === 'boolean') es.up = state.esUp;
		if (typeof state.greetingDelayMs === 'number') greetingDelayMs = state.greetingDelayMs;
		if (typeof state.bootMs === 'number') bootMs = state.bootMs;
		if (typeof state.writeDelayMs === 'number') writeDelayMs = state.writeDelayMs;
		if (typeof state.innoextract === 'boolean') fake.innoextract = state.innoextract;
		if (state.on === true) await fake.on();
		if (state.on === false) await fake.off();
		send(res, 204);
	};
	let controlServer: ReturnType<typeof createHttpServer> | null = null;
	if (o.control) {
		const server = createHttpServer((req, res) => void answerControl(req, res).catch(() => res.destroy()));
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		controlServer = server;
	}

	const port = await listen(0);
	const fake: FakeBatocera = {
		port,
		root,
		fingerprint: `SHA256:${createHash('sha256').update(publicKey).digest('base64').replace(/=+$/, '')}`,
		user: o.user ?? 'root',
		password: o.password ?? 'linux',
		freeBytes: o.freeBytes ?? 400 * 1024 ** 3,
		primary: 'HDMI-1',
		mac: o.mac ?? '02:00:00:aa:bb:cc',
		wakePort: (wake.address() as AddressInfo).port,
		control: controlServer ? `http://127.0.0.1:${(controlServer.address() as AddressInfo).port}` : null,
		shutdowns: 0,
		innoextract: true,
		unpacked: [],
		unpacking: 0,
		es,
		onSftp: null,
		isOn: () => tcp !== null,
		off: () =>
			serial(async () => {
				const server = tcp;
				if (!server) return;
				tcp = null;
				for (const socket of sockets) socket.destroy();
				await new Promise<void>((resolve) => server.close(() => resolve()));
			}),
		on: () =>
			serial(async () => {
				if (tcp || closed) return;
				await listen(port);
			}),
		close: async () => {
			if (closed) return;
			closed = true;
			clearTimeout(shutdownTimer);
			clearTimeout(bootTimer);
			clearTimeout(rescanTimer);
			await fake.off();
			wake.close();
			if (controlServer) {
				const server = controlServer;
				server.closeAllConnections();
				await new Promise<void>((resolve) => server.close(() => resolve()));
			}
			await rm(root, { recursive: true, force: true });
		}
	};
	return fake;
}
