import { createHash, randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import type { FailReason, JobView, StepName } from '../../batocera';
import type { FileTarget } from '../index-types';
import type { Logger } from '../log';
import { BoxDown, BoxKeyChanged, BoxRefused, connectionLost, type Box, type BoxLogin, type openBox, type portOpen } from './box';
import { isIdle } from './check';
import { COMMANDS, INSTALLERS, SYSTEM_DIR, bytesCommand, filesCommand, parseDf, parseFiles, parseKib, removeCommand, removeInPartCommand, supportCommand } from './commands';
import { MARKER, autorunCmd, chooseTask, dosboxBat, markerJson, parseMarker, type PlayTask } from './folder';
import { detailsJson, listId, type ListDetails } from './gamelist';
import { markerIn } from './look';
import { UnpackError, unpackOnBox } from './unpack';

/** A game to send, as the service makes it from the index and the last look. */
export interface SendRequest {
	gameId: string;
	/** The folder's name without `.pc` (spec 2.2). */
	name: string;
	system: 'windows' | 'dos';
	/** The game's Windows installer version, as the detail shows it, for the marker. */
	version: string;
	/** The bytes of the files to send, as the detail lists them; the room is checked with it (spec 3.2). */
	size: number;
	/** The installer files of the game, then those of its DLC. */
	files: FileTarget[];
	details: ListDetails;
	poster: string | null;
	backdrop: string | null;
}

export interface SenderDeps {
	login: () => BoxLogin;
	wakeOn: () => boolean;
	mac: () => string | null;
	address: () => string;
	/** An installer's bytes from vangogh; throws when vangogh does not answer 200. */
	openFile(target: FileTarget, o: { signal: AbortSignal }): Promise<Readable>;
	/** vangogh's MD5 of each file of a product, by manual URL. */
	checksums(productId: string): Promise<Record<string, string>>;
	image(imageId: string): Promise<Buffer | null>;
	open: typeof openBox;
	portOpen: typeof portOpen;
	wake: (mac: string) => Promise<void>;
	/** How often to ask whether the game on the TV was closed: 30 seconds by the spec. */
	idlePollMs?: number;
	/** How long the game may take to show in EmulationStation's list after the reload: 10 seconds. */
	listWaitMs?: number;
	log: Logger;
	/** Canvas's version, for the marker. */
	version: string;
	/** A look at the box through a job's open connection (spec 4.2: after every job). */
	onLook: (box: Box) => Promise<void>;
	/**
	 * Called once when the queue is empty after a job and no reload waits for a game on the TV (spec 3.6): whether
	 * Canvas woke the box for a job since it was last called, whether the last job failed, and the last job's game.
	 */
	onEnd: (o: { woke: boolean; failed: boolean; gameId: string }) => void;
}

const STEPS: StepName[] = ['copy', 'unpack', 'reload'];
/** How long the box's SSH port has to answer at the start (spec 3.2). */
const ANSWER_MS = 5000;
/** Room the box keeps beyond the send (spec 3.2: 1 GB). */
const BOX_MARGIN = 1024 ** 3;
/** The box holds the installers and the unpacked game together while it unpacks: 2.2 times the installers (0.12.1, section 3). */
const WORK_FACTOR = 2.2;
/** A woken box has 3 minutes to answer (spec 6.1); the packet goes again meanwhile, as in the wake test. */
const WAKE_WAIT_MS = 180_000;
const WAKE_AGAIN_MS = 5000;
const PORT_MS = 1000;
const POLL_MS = 500;
/** While a game runs on the TV, `/isIdle` is asked every 30 seconds, 12 hours at most (spec 3.6). */
const IDLE_POLL_MS = 30_000;
const IDLE_WAIT_MS = 12 * 3600_000;
/** 43.1 reloads its list after it answered `/reloadgames`: the game is looked for every half second, 10 seconds at most. */
const LIST_POLL_MS = 500;
const LIST_WAIT_MS = 10_000;
/** How often the bytes in the part on the box are counted (0.12.1, section 10: about every 2 seconds). */
const UNPACK_COUNT_MS = 2000;
/** Bytes a second until measured: the copy 18 to 20 MB/s in the checks; unpacking about a minute per 10 GB (spec 3.3). */
const GUESS: Record<'copy' | 'unpack', number> = { copy: 20e6, unpack: 10e9 / 60 };
/** Seconds the reload and the details take, about. */
const RELOAD_S = 5;
/** Seconds a step runs before its own speed counts in the estimate. */
const OWN_SPEED_AFTER_S = 5;
/** How long after a failed removal of the part it is tried once more. */
const REMOVE_AGAIN_MS = 1000;
/** Batocera reads a folder game's pad-to-keyboard profile from this file inside the folder; a send again keeps it. */
const PADTO_KEYS = 'padto.keys';

/** The pictures for Batocera's list, fetched once the folder is finished and kept with the job until the details are written. */
interface Pictures {
	cover: Buffer | null;
	background: Buffer | null;
}

/** An installer file copied to the box: its name in the part's installers folder, and its bytes. */
interface Installer {
	name: string;
	bytes: number;
}

/** A send that ends with a reason the page can say. */
class Failure extends Error {
	constructor(
		readonly reason: FailReason,
		cause?: unknown
	) {
		super(reason.code, { cause });
		this.name = 'Failure';
	}
}

/** A folder Canvas did not make is where the game would go: it is never replaced (spec 3.4 and 3.5). */
class InTheWay extends Error {
	constructor(readonly folder: string) {
		super(`${folder} is in the way, and Canvas did not make it`);
	}
}

const ok = (status: number) => status >= 200 && status < 300;
const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function abortError(): Error {
	const error = new Error('The send was stopped');
	error.name = 'AbortError';
	return error;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) return reject(abortError());
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', stop);
			resolve();
		}, ms);
		const stop = () => {
			clearTimeout(timer);
			reject(abortError());
		};
		signal.addEventListener('abort', stop, { once: true });
	});
}

/** Runs one part of a job: what goes wrong there ends the job with `fallback`, unless it says more. */
async function within<T>(fallback: 'box-down' | 'fetch' | 'unpack' | 'copy', work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof Failure || isAbort(error)) throw error;
		if (error instanceof BoxKeyChanged) throw new Failure({ code: 'key-changed' }, error);
		if (error instanceof BoxRefused) throw new Failure({ code: 'login' }, error);
		if (error instanceof BoxDown) throw new Failure({ code: 'box-down' }, error);
		if (error instanceof InTheWay) throw new Failure({ code: 'in-the-way', path: error.folder }, error);
		if (error instanceof UnpackError) throw new Failure({ code: error.rar ? 'unrar' : 'unpack' }, error);
		// A box lost while it unpacks does not answer; one lost during the copy keeps `copy` (0.12.1, section 5).
		if (fallback === 'unpack' && connectionLost(error)) throw new Failure({ code: 'box-down' }, error);
		throw new Failure({ code: fallback }, error);
	}
}

/** GOG's primary play task, which for a DOS game is DOSBox with its configurations (spec 2.4). */
function primaryTask(info: unknown): PlayTask | null {
	const tasks = (info as { playTasks?: unknown } | null)?.playTasks;
	if (!Array.isArray(tasks)) return null;
	const text = (v: unknown) => v === undefined || typeof v === 'string';
	return (
		tasks.find(
			(t): t is PlayTask =>
				typeof t === 'object' && t !== null && t.isPrimary === true && t.type === 'FileTask' && typeof t.path === 'string' && text(t.workingDir) && text(t.arguments)
		) ?? null
	);
}

interface Job {
	id: string;
	request: SendRequest;
	state: JobView['state'];
	stepIndex: number;
	/** "Stop sending". */
	stopper: AbortController;
	stopped: boolean;
	/** True once the game is being put in place: it is no longer stopped. */
	committed: boolean;
	/** A newer send of the game replaced this result. */
	superseded: boolean;
	/** Ends the reload that waits for the game on the TV, once; null when none waits. */
	laterEnd: (() => void) | null;
	woke: boolean;
	waking: JobView['waking'];
	/** From the start of step 1 until the copy begins: the box's answer or its wake, the login, the room check, the way cleared and the marker. */
	waitingForBox: boolean;
	reason: FailReason | null;
	endedAt: string | null;
	listLater: boolean;
	/** When the step began, and the seconds each step before it took. */
	stepStart: number;
	took: number[];
	bytesDone: number;
	bytesAll: number;
	/** Bytes a second, as measured in each step so far. */
	speed: Partial<Record<StepName, number>>;
	/** The most shown so far, so that the bar never goes back. */
	overall: number;
	/** The folders on the box that the job is making: its `.part`, and the `.old` while it puts the game in place. */
	holds: string[];
}

/**
 * The queue of sends to Batocera (spec 0.12.0, section 3): one job at a time, in the order asked for,
 * on the server whatever the browser does. Jobs live in memory; a game's last result is kept until its
 * next send.
 */
export class Sender {
	readonly #d: SenderDeps;
	readonly #queue: Job[] = [];
	#current: Job | null = null;
	/** Each game's last result, sent or failed. */
	readonly #last = new Map<string, Job>();
	/** Canvas woke the box for a job since `onEnd` was last called, whether the last job failed, and its game. */
	#woke = false;
	#failed = false;
	#lastGame = '';
	/** The reloads that wait for a game on the TV to be closed. */
	#pending = 0;

	constructor(d: SenderDeps) {
		this.#d = d;
	}

	/** Queues a send, or answers with the job already waiting or running for the game. */
	send(r: SendRequest): JobView {
		const known = this.#active(r.gameId);
		if (known) return this.#view(known);
		const last = this.#last.get(r.gameId);
		this.#last.delete(r.gameId);
		const job: Job = {
			id: randomUUID(),
			request: r,
			state: 'waiting',
			stepIndex: 0,
			stopper: new AbortController(),
			stopped: false,
			committed: false,
			superseded: false,
			laterEnd: null,
			woke: false,
			waking: 'no',
			waitingForBox: false,
			reason: null,
			endedAt: null,
			listLater: false,
			stepStart: 0,
			took: [],
			bytesDone: 0,
			bytesAll: r.size,
			speed: {},
			overall: 0,
			holds: []
		};
		this.#queue.push(job);
		// The new send reloads the list itself; the reload the last one waited with is over.
		if (last) {
			last.superseded = true;
			last.laterEnd?.();
		}
		this.#d.log.info('a send to batocera is queued', { game: r.gameId, folder: `${r.name}.pc`, system: r.system, ahead: this.running() - 1 });
		this.#kick();
		return this.#view(job);
	}

	/** "Stop sending": a waiting job leaves the queue, a running one is broken off and cleaned up. False for no such job. */
	stop(jobId: string): boolean {
		const at = this.#queue.findIndex((j) => j.id === jobId);
		if (at >= 0) {
			const [job] = this.#queue.splice(at, 1);
			this.#d.log.info('a send to batocera was stopped while it waited', { game: job.request.gameId });
			return true;
		}
		const job = this.#current;
		if (!job || job.id !== jobId || job.stopped || job.committed) return false;
		job.stopped = true;
		job.stopper.abort();
		return true;
	}

	/** The game's job waiting or running, else its last result until its next send; null for none. */
	jobOf(gameId: string): JobView | null {
		const job = this.#active(gameId) ?? this.#last.get(gameId) ?? null;
		return job && this.#view(job);
	}

	/** The jobs waiting or running, one being stopped included. */
	running(): number {
		return this.#queue.length + (this.#current ? 1 : 0);
	}

	/** The folders on the box the running job is making, which a look must not remove (they hold its marker). */
	holds(): string[] {
		return [...(this.#current?.holds ?? [])];
	}

	#active(gameId: string): Job | null {
		const current = this.#current;
		if (current && !current.stopped && current.request.gameId === gameId) return current;
		return this.#queue.find((j) => j.request.gameId === gameId) ?? null;
	}

	#kick(): void {
		if (this.#current) return;
		const job = this.#queue.shift();
		if (!job) return;
		this.#current = job;
		job.state = 'running';
		job.stepStart = Date.now();
		void this.#run(job)
			.catch((error: unknown) => this.#d.log.error('a send to batocera broke down', { game: job.request.gameId, reason: messageOf(error) }))
			.finally(() => {
				this.#current = null;
				this.#woke ||= job.woke;
				this.#failed = job.state !== 'done';
				this.#lastGame = job.request.gameId;
				this.#maybeEnd();
				this.#kick();
			});
	}

	/** `onEnd`, once nothing waits, runs, or waits to reload. */
	#maybeEnd(): void {
		if (this.#current || this.#queue.length > 0 || this.#pending > 0) return;
		const end = { woke: this.#woke, failed: this.#failed, gameId: this.#lastGame };
		this.#woke = false;
		try {
			this.#d.onEnd(end);
		} catch (error) {
			this.#d.log.error('the end of the sends could not be handled', { reason: messageOf(error) });
		}
	}

	/**
	 * 0.12.1, sections 3 and 4: the box, woken first when it does not answer; its room and the marker; then the copy of
	 * the installers, their unpacking and the folder's finish on the box, put in place, reload and the details.
	 */
	async #run(job: Job): Promise<void> {
		const { log } = this.#d;
		const r = job.request;
		const signal = job.stopper.signal;
		const part = `${SYSTEM_DIR[r.system]}/${r.name}.pc.part`;
		let box: Box | null = null;
		// Shown with the job's end, once the cleanup is done.
		let reason: FailReason | null = null;
		try {
			// 1. The box, then its room and the way cleared; the marker goes into .part before any installer.
			job.waitingForBox = true;
			if (!(await this.#d.portOpen(this.#d.address(), this.#d.login().port, ANSWER_MS))) {
				const mac = this.#d.mac();
				if (!this.#d.wakeOn() || !mac) throw new Failure({ code: 'box-down' });
				await this.#wake(job, mac, signal);
			}
			box = await within('box-down', () => this.#d.open(this.#d.login()));
			const opened = box;
			const replace = await within('copy', async () => {
				await this.#roomOnBox(opened, Math.ceil(WORK_FACTOR * r.size));
				return this.#clearWay(opened, r);
			});
			job.holds = [part, `${SYSTEM_DIR[r.system]}/${r.name}.pc.old`];
			const sentAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
			const marker = { gameId: r.gameId, system: r.system, files: r.files.map((f) => f.filename), version: r.version, sentAt, canvas: this.#d.version };
			await within('copy', async () => {
				await opened.mkdirs(part);
				await opened.write(`${part}/${MARKER}`, Buffer.from(markerJson(marker)));
				await opened.mkdirs(`${part}/${INSTALLERS}`);
			});
			// The copy's speed is measured from here: the wait for the box is not copy time.
			job.stepStart = Date.now();
			job.waitingForBox = false;
			const installers = await within('copy', () => this.#copy(job, opened, part, signal));
			// 2. Unpack and finish the folder on the box.
			const pictures = await within('unpack', () => this.#unpack(job, opened, part, installers, signal));
			// 3. Put it in place, then reload Batocera's list and write the details.
			if (signal.aborted) throw abortError();
			job.committed = true;
			this.#step(job, 2, job.bytesAll);
			job.bytesDone = job.bytesAll;
			await within('copy', () => this.#putInPlace(opened, r, replace));
			job.holds = [];
			await this.#reload(job, opened, pictures);
			log.info('a game was sent to batocera', { game: r.gameId, folder: `${SYSTEM_DIR[r.system]}/${r.name}.pc` });
		} catch (error) {
			if (job.stopped) log.info('a send to batocera was stopped', { game: r.gameId, step: STEPS[job.stepIndex] });
			else {
				const failure = error instanceof Failure ? error : new Failure({ code: (['copy', 'unpack', 'copy'] as const)[job.stepIndex] }, error);
				reason = failure.reason;
				log.warn('a send to batocera failed', { game: r.gameId, step: STEPS[job.stepIndex], reason: failure.reason.code, said: failure.cause ? messageOf(failure.cause) : undefined });
			}
			// Nothing of the game is left on the box, installers and all; a box that went away keeps it until the next look (spec 3.5).
			// A removal that fails, as when an innoextract that was ended still wrote into a folder `rm` had read, goes once more.
			if (box && job.holds.length > 0 && !(await this.#remove(box, part))) {
				await new Promise((resolve) => setTimeout(resolve, REMOVE_AGAIN_MS));
				await this.#remove(box, part);
			}
		} finally {
			job.holds = [];
			if (box) {
				await this.#d.onLook(box).catch((error: unknown) => log.warn('the look at batocera after a send failed', { reason: messageOf(error) }));
				box.close();
			}
			if (!job.stopped) {
				job.reason = reason;
				job.state = reason ? 'failed' : 'done';
				job.endedAt = new Date().toISOString();
				this.#last.set(r.gameId, job);
			}
		}
	}

	/** Free space of /userdata: at least `bytes` and 1 GB (spec 3.2). One that cannot be read is let through. */
	async #roomOnBox(box: Box, bytes: number): Promise<void> {
		const { code, stdout } = await box.exec(COMMANDS.df);
		let free: number;
		try {
			if (code !== 0) throw new Error(`df ended with ${code}`);
			free = parseDf(stdout);
		} catch (error) {
			this.#d.log.warn("batocera's free space could not be read, so the send goes on", { reason: messageOf(error) });
			return;
		}
		const need = bytes + BOX_MARGIN;
		if (free < need) throw new Failure({ code: 'box-room', free, need });
	}

	/** Sends the wake packet, again every 5 seconds, until the box's SSH port answers (spec 6.1). */
	async #wake(job: Job, mac: string, signal: AbortSignal): Promise<void> {
		const { log } = this.#d;
		job.woke = true;
		job.waking = 'waking';
		log.info('batocera does not answer, so canvas wakes it', { game: job.request.gameId });
		const deadline = Date.now() + WAKE_WAIT_MS;
		let next = 0;
		for (;;) {
			if (Date.now() >= next) {
				next = Date.now() + WAKE_AGAIN_MS;
				await this.#d.wake(mac).catch((error: unknown) => log.warn('the wake packet could not be sent', { reason: messageOf(error) }));
			}
			if (await this.#d.portOpen(this.#d.address(), this.#d.login().port, PORT_MS)) {
				job.waking = 'awake';
				log.info('batocera woke and answers', { game: job.request.gameId });
				return;
			}
			if (Date.now() >= deadline) throw new Failure({ code: 'box-down' });
			await sleep(POLL_MS, signal);
		}
	}

	/**
	 * Step 1: each installer file streamed from vangogh into the part's installers folder on the box, its MD5 checked
	 * against vangogh's as its bytes pass (0.12.1, section 3). Resolves with each file's name and bytes.
	 */
	async #copy(job: Job, box: Box, part: string, signal: AbortSignal): Promise<Installer[]> {
		const { log } = this.#d;
		const r = job.request;
		const sums = new Map<string, Record<string, string> | null>();
		const installers: Installer[] = [];
		let copied = 0;
		for (const target of r.files) {
			const name = target.filename.split(/[\\/]/).pop() ?? '';
			if (name === '' || name === '.' || name === '..' || installers.some((i) => i.name === name)) throw new Error('an installer has a file name that cannot be used');
			if (!sums.has(target.productId)) {
				// vangogh may answer 500 for a product without them: then the files go unchecked.
				const known = await this.#d.checksums(target.productId).catch((error: unknown) => {
					log.warn('vangogh gave no checksums, so the files are sent unchecked', { game: r.gameId, product: target.productId, reason: messageOf(error) });
					return null;
				});
				sums.set(target.productId, known);
			}
			const source = await within('fetch', () => this.#d.openFile(target, { signal }));
			const hash = createHash('md5');
			let bytes = 0;
			const count = new Transform({
				transform: (chunk: Buffer, _encoding, done) => {
					hash.update(chunk);
					bytes += chunk.length;
					this.#progress(job, copied + bytes);
					done(null, chunk);
				}
			});
			// vangogh's stream breaking off by itself is a fetch that failed; the copy's own end, whatever ends it, ends that stream.
			let broke: unknown = null;
			source.on('error', (error) => {
				broke ??= error;
				count.destroy(error);
			});
			count.once('close', () => source.destroy());
			// Destroyed before the put reads it, it throws nothing: the put tells the error.
			count.on('error', () => {});
			source.pipe(count);
			try {
				await box.put(`${part}/${INSTALLERS}/${name}`, count, { signal });
			} catch (error) {
				if (broke !== null && !isAbort(error)) throw new Failure({ code: 'fetch' }, broke);
				throw error;
			}
			copied += bytes;
			const want = sums.get(target.productId)?.[target.manualUrl];
			if (want && want.toLowerCase() !== hash.digest('hex')) {
				log.warn('a file from vangogh does not match its checksum', { game: r.gameId, file: name });
				throw new Failure({ code: 'checksum' });
			}
			installers.push({ name, bytes });
		}
		return installers;
	}

	/**
	 * Step 2, on the box: each installer unpacked into the part, the game first, then its DLC; the installers deleted;
	 * GOG's support files copied over it; then the program (`autorun.cmd` or `dosbox.bat`); and the pictures fetched
	 * (spec 2.2 to 2.4 and 3.6; 0.12.1, sections 3 and 4).
	 */
	async #unpack(job: Job, box: Box, part: string, installers: Installer[], signal: AbortSignal): Promise<Pictures> {
		const r = job.request;
		const installerBytes = installers.reduce((sum, i) => sum + i.bytes, 0);
		this.#step(job, 1, installerBytes);
		// Measured by the bytes in the part less the installers', at most 99 % until innoextract ends; a count that fails is left out.
		let unpacked = false;
		let counting = false;
		const count = setInterval(() => {
			if (counting) return;
			counting = true;
			box
				.exec(bytesCommand(part))
				.then(({ code, stdout }) => {
					if (code !== 0 || unpacked) return;
					this.#progress(job, Math.min(Math.max(0, parseKib(stdout) - installerBytes), Math.floor(0.99 * installerBytes)));
				})
				.catch(() => {})
				.finally(() => (counting = false));
		}, UNPACK_COUNT_MS);
		count.unref();
		try {
			// A `.bin` is a part of the installer before it, which innoextract finds itself.
			for (const { name } of installers.filter((i) => !/\.bin$/i.test(i.name))) {
				await unpackOnBox(box, { installer: `${part}/${INSTALLERS}/${name}`, part, signal });
			}
		} finally {
			unpacked = true;
			clearInterval(count);
		}
		this.#progress(job, installerBytes);
		await this.#exec(box, removeInPartCommand(part, INSTALLERS));
		// GOG's installer copies `__support/app` over the game folder, overwriting (`supportData` in its script):
		// a DOS game's DOSBox configurations may be there only.
		await this.#exec(box, supportCommand(part));

		const files = parseFiles(await this.#exec(box, filesCommand(part)), part);
		const info = await this.#info(box, part, files, r.gameId);
		if (r.system === 'dos') await this.#dosbox(r, box, part, files, info);
		else await this.#autorun(r, box, part, files, info);

		return {
			cover: r.poster ? await this.#picture(r, r.poster, 'cover') : null,
			background: r.backdrop ? await this.#picture(r, r.backdrop, 'background') : null
		};
	}

	/**
	 * A command of `commands.ts` on the box, resolving with its stdout; one that does not end with 0 throws. A box that
	 * went away throws `BoxDown`: `exec` rejects only when SSH itself fails, and a command it cut off has no exit status.
	 */
	async #exec(box: Box, command: string): Promise<string> {
		const { code, stdout, stderr } = await box.exec(command).catch((error: unknown) => {
			throw new BoxDown(error);
		});
		if (code === -1) throw new BoxDown(new Error('a command on batocera ended without an exit status'));
		if (code !== 0) throw new Error(`a command on batocera ended with ${code}: ${stderr.trim()}`);
		return stdout;
	}

	/**
	 * The game's own `goggame-<id>.info`, picked by its name (a DLC's has other tasks or none); null when there is none,
	 * or it cannot be read or parsed. A box that went away throws.
	 */
	async #info(box: Box, part: string, files: string[], gameId: string): Promise<unknown> {
		const want = `goggame-${gameId}.info`;
		const file = files.filter((f) => posix.basename(f).toLowerCase() === want).sort((a, b) => a.split('/').length - b.split('/').length)[0];
		if (!file) return null;
		try {
			const data = await box.read(`${part}/${file}`);
			return data && JSON.parse(data.toString('utf8').replace(/^\uFEFF/, ''));
		} catch (error) {
			if (connectionLost(error)) throw error;
			return null;
		}
	}

	/** `autorun.cmd` of a Windows game (spec 2.3); without a program Batocera opens Wine's explorer. */
	async #autorun(r: SendRequest, box: Box, part: string, files: string[], info: unknown): Promise<void> {
		const { log } = this.#d;
		const task = chooseTask(info);
		const lines = task ? autorunCmd(task, files) : null;
		if (!task || !lines) {
			log.warn("no program found for batocera, so it opens wine's explorer", { game: r.gameId, task: task?.path ?? null });
			return;
		}
		await box.write(`${part}/autorun.cmd`, Buffer.from(lines));
		log.info('the program batocera starts', { game: r.gameId, task: task.path, workingDir: task.workingDir ?? null, arguments: task.arguments ?? null, autorun: lines });
	}

	/** `dosbox.bat` of a DOS game from GOG's DOSBox configurations, and GOG's own DOSBOX folder left out (spec 2.4). */
	async #dosbox(r: SendRequest, box: Box, part: string, files: string[], info: unknown): Promise<void> {
		const { log } = this.#d;
		const task = primaryTask(info);
		const configs = new Map<string, string>();
		for (const file of files.filter((f) => /\.conf$/i.test(f))) {
			const data = await box.read(`${part}/${file}`);
			if (data) configs.set(file, data.toString('latin1'));
		}
		const bat = task ? dosboxBat(task, files, (file) => configs.get(file) ?? null) : null;
		for (const name of await box.list(part)) {
			if (name.toLowerCase() === 'dosbox' && (await box.isDir(`${part}/${name}`))) await this.#exec(box, removeInPartCommand(part, name));
		}
		if (!bat) {
			log.warn('no dosbox start commands found, so dosbox.bat is left out', { game: r.gameId, task: task?.path ?? null });
			return;
		}
		await box.write(`${part}/dosbox.bat`, Buffer.from(bat, 'latin1'));
		log.info('the dosbox.bat batocera starts', { game: r.gameId, task: task?.path ?? null, arguments: task?.arguments ?? null, dosbox: bat });
	}

	/** A picture for Batocera's list; null when vangogh has none. */
	async #picture(r: SendRequest, imageId: string, picture: 'cover' | 'background'): Promise<Buffer | null> {
		const body = await this.#d.image(imageId).catch(() => null);
		if (!body) this.#d.log.warn('a picture for batocera could not be fetched', { game: r.gameId, picture });
		return body;
	}

	/**
	 * Before the copy: Canvas's own `.part` or `.old` of the game is removed, and whether a `.pc` is there to
	 * replace is told by its marker. A folder Canvas did not make stops the send, which never touches it.
	 */
	async #clearWay(box: Box, r: SendRequest): Promise<boolean> {
		const dir = SYSTEM_DIR[r.system];
		const names = await box.list(dir);
		for (const suffix of ['.pc.part', '.pc.old']) {
			const path = `${dir}/${r.name}${suffix}`;
			if (!names.includes(`${r.name}${suffix}`)) continue;
			if (!(await markerIn(box, path, r.system)) && !(await this.#markerless(box, path))) throw new InTheWay(path);
			if (!(await this.#remove(box, path))) throw new Error(`${path} could not be removed`);
		}
		if (!names.includes(`${r.name}.pc`)) return false;
		const path = `${dir}/${r.name}.pc`;
		if ((await markerIn(box, path, r.system))?.gameId !== r.gameId) throw new InTheWay(path);
		return true;
	}

	/**
	 * A `.part` or `.old` of the game's name that holds nothing but at most a `canvas.json` file, empty or
	 * damaged: Canvas's own, from a copy cut off before or while its marker was written, since nobody else
	 * makes such a folder (a ruling of the build, beyond spec 3.5).
	 */
	async #markerless(box: Box, path: string): Promise<boolean> {
		if (!(await box.isDir(path))) return false;
		const names = await box.list(path);
		if (names.length === 0) return true;
		if (names.length > 1 || names[0] !== MARKER || (await box.isDir(`${path}/${MARKER}`))) return false;
		const data = await box.read(`${path}/${MARKER}`);
		return data === null || parseMarker(data.toString('utf8')) === null;
	}

	/** Spec 3.4: `.part` becomes the folder; an old one sent by Canvas goes to `.old` first, then away, but its `padto.keys` is carried over. */
	async #putInPlace(box: Box, r: SendRequest, replace: boolean): Promise<void> {
		const base = `${SYSTEM_DIR[r.system]}/${r.name}.pc`;
		if (!replace) return box.rename(`${base}.part`, base);
		const keys = await box.read(`${base}/${PADTO_KEYS}`);
		if (keys !== null) await box.write(`${base}.part/${PADTO_KEYS}`, keys);
		await box.rename(base, `${base}.old`);
		try {
			await box.rename(`${base}.part`, base);
		} catch (error) {
			await box.rename(`${base}.old`, base).catch(() => {});
			throw error;
		}
		// One that stays is Canvas's leftover, for the next look.
		await this.#remove(box, `${base}.old`);
	}

	/** Spec 3.6: the reload and the details, or later while a game runs on the TV; a send never fails here. */
	async #reload(job: Job, box: Box, pictures: Pictures): Promise<void> {
		const r = job.request;
		const idle = await isIdle(box);
		if (idle === null) {
			this.#d.log.warn('emulationstation did not answer, so the list was not reloaded: the game shows after batocera restarts', { game: r.gameId });
			return;
		}
		if (!idle) {
			job.listLater = true;
			this.#d.log.info("a game runs on the tv, so batocera's list is reloaded once it is closed", { game: r.gameId });
			this.#later(job, pictures);
			return;
		}
		await this.#refresh(box, r, pictures);
	}

	/** Asks `/isIdle` every 30 seconds, 12 hours at most, then reloads and writes the details (spec 3.6). */
	#later(job: Job, pictures: Pictures): void {
		const r = job.request;
		const deadline = Date.now() + IDLE_WAIT_MS;
		this.#pending++;
		job.laterEnd = () => {
			job.laterEnd = null;
			this.#pending--;
			this.#maybeEnd();
		};
		const tick = async () => {
			if (job.superseded) return job.laterEnd?.();
			let box: Box | null = null;
			try {
				box = await this.#d.open(this.#d.login());
				const idle = await isIdle(box);
				if (job.superseded) return job.laterEnd?.();
				if (idle === true) {
					await this.#refresh(box, r, pictures);
					job.listLater = false;
					job.laterEnd?.();
					return;
				}
			} catch {
				// The box is away or busy; asked again.
			} finally {
				box?.close();
			}
			if (Date.now() >= deadline) {
				this.#d.log.warn("batocera's list was not reloaded: the game on the tv ran for 12 hours", { game: r.gameId });
				job.laterEnd?.();
				return;
			}
			setTimeout(() => void tick(), this.#d.idlePollMs ?? IDLE_POLL_MS).unref();
		};
		setTimeout(() => void tick(), this.#d.idlePollMs ?? IDLE_POLL_MS).unref();
	}

	/**
	 * `/reloadgames`, then, once the game shows in the list, its details and pictures when it is new there or its
	 * entry has no description: a person's details are never overwritten (spec 3.6). 43.1's `/addgames` adds nothing,
	 * so they go through the game's own routes, and EmulationStation keeps the pictures where it keeps its own.
	 */
	async #refresh(box: Box, r: SendRequest, pictures: Pictures): Promise<void> {
		const { log } = this.#d;
		try {
			const reload = await box.es('GET', '/reloadgames');
			if (reload.status !== 200) throw new Error(`emulationstation answered ${reload.status}`);
		} catch (error) {
			log.warn('emulationstation did not reload, so the list was not reloaded: the game shows after batocera restarts', { game: r.gameId, reason: messageOf(error) });
			return;
		}
		const at = `/systems/${r.system}/games/${listId(`${SYSTEM_DIR[r.system]}/${r.name}.pc`)}`;
		try {
			const entry = await this.#entry(box, at);
			if (!entry) {
				log.warn("the game did not show in batocera's list in time, so its details were not written", { game: r.gameId });
				return;
			}
			if (typeof entry.desc === 'string' && entry.desc.trim() !== '') return;
			const written = await box.es('POST', at, detailsJson(r.details), 'application/json');
			if (!ok(written.status)) throw new Error(`emulationstation answered ${written.status}`);
			const media: [string, Buffer | null][] = [
				['image', pictures.cover],
				['thumbnail', pictures.cover],
				['fanart', pictures.background]
			];
			for (const [type, data] of media) {
				if (!data) continue;
				const sent = await box.es('POST', `${at}/media/${type}`, data, 'image/jpeg');
				if (!ok(sent.status)) throw new Error(`emulationstation answered ${sent.status} for the ${type}`);
			}
		} catch (error) {
			log.warn("the game's details could not be written to batocera's list", { game: r.gameId, reason: messageOf(error) });
		}
	}

	/** The game's entry in EmulationStation's list once the reload has read it, looked for every half second; null when it does not show in time. */
	async #entry(box: Box, at: string): Promise<{ desc?: unknown } | null> {
		const deadline = Date.now() + (this.#d.listWaitMs ?? LIST_WAIT_MS);
		for (;;) {
			let failure: unknown = null;
			let answer: { status: number; body: string } | null = null;
			try {
				answer = await box.es('GET', at);
			} catch (error) {
				failure = error;
			}
			if (answer?.status === 200) {
				const entry: unknown = JSON.parse(answer.body);
				if (typeof entry !== 'object' || entry === null) throw new Error("emulationstation's entry of the game is not an object");
				return entry;
			}
			if (Date.now() >= deadline) {
				if (failure !== null) throw failure;
				return null;
			}
			await new Promise((resolve) => setTimeout(resolve, LIST_POLL_MS));
		}
	}

	async #remove(box: Box, path: string): Promise<boolean> {
		try {
			const { code, stderr } = await box.exec(removeCommand(path));
			if (code === 0) return true;
			this.#d.log.warn('a folder of canvas on batocera could not be removed', { folder: path, code, stderr: stderr.trim() });
		} catch (error) {
			this.#d.log.warn('a folder of canvas on batocera could not be removed', { folder: path, reason: messageOf(error) });
		}
		return false;
	}

	/** The job moves on to a step: what the one before took is kept for the estimate. */
	#step(job: Job, index: number, bytesAll: number): void {
		const now = Date.now();
		while (job.stepIndex < index) {
			job.took.push((now - job.stepStart) / 1000);
			job.stepIndex++;
			job.stepStart = now;
		}
		job.bytesDone = 0;
		job.bytesAll = bytesAll;
	}

	/** The bytes the step has done so far, and the speed they show. */
	#progress(job: Job, bytes: number): void {
		job.bytesDone = bytes;
		const seconds = (Date.now() - job.stepStart) / 1000;
		if (bytes > 0 && seconds > 0) job.speed[STEPS[job.stepIndex]] = bytes / seconds;
	}

	/** The whole job's share done and the minutes left, each step weighted by what it takes (spec 3.3). */
	#estimate(job: Job): { overall: number; minutesLeft: number | null } {
		const size = job.request.size;
		const i = job.stepIndex;
		const finished = job.took.slice(0, i).reduce((sum, s) => sum + s, 0);
		// While the job waits for the box, the bar holds still and no minutes are said.
		const elapsed = job.waitingForBox ? 0 : (Date.now() - job.stepStart) / 1000;
		const step = STEPS[i];
		// The step under way keeps the guess for its first seconds: its first pieces, after a slow start, say little of its speed.
		const speed = (s: 'copy' | 'unpack') => (s !== step || elapsed >= OWN_SPEED_AFTER_S ? job.speed[s] : undefined) ?? GUESS[s];
		const planned = [size / speed('copy'), size / speed('unpack'), RELOAD_S];
		const rest = step === 'reload' ? Math.max(0, RELOAD_S - elapsed) : Math.max(0, job.bytesAll - job.bytesDone) / speed(step);
		const later = planned.slice(i + 1).reduce((sum, s) => sum + s, 0);
		const total = finished + elapsed + rest + later;
		const overall = total > 0 ? Math.min(0.99, (finished + elapsed) / total) : 0;
		const measured = Object.keys(job.speed).length > 0 && !job.waitingForBox;
		return { overall, minutesLeft: measured ? Math.max(1, Math.ceil((rest + later) / 60)) : null };
	}

	#view(job: Job): JobView {
		const running = job.state === 'running';
		const ahead = job.state === 'waiting' ? (this.#current ? 1 : 0) + this.#queue.indexOf(job) : 0;
		const estimate = running ? this.#estimate(job) : { overall: job.state === 'done' ? 1 : job.overall, minutesLeft: null };
		job.overall = Math.max(job.overall, estimate.overall);
		return {
			id: job.id,
			state: job.state,
			ahead,
			step: STEPS[job.stepIndex],
			stepNumber: job.stepIndex + 1,
			steps: 3,
			overall: job.overall,
			bytesDone: job.bytesDone,
			bytesAll: job.bytesAll,
			minutesLeft: estimate.minutesLeft,
			waking: job.waking,
			waitingForBox: running && job.waitingForBox,
			reason: job.reason,
			endedAt: job.endedAt,
			listLater: job.listLater
		};
	}
}
