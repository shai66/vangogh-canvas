import { posix } from 'node:path';
import type { PlayView } from '../../batocera';
import type { Logger } from '../log';
import type { Box } from './box';
import { isIdle } from './check';
import { COMMANDS, parsePrimary } from './commands';
import { listId } from './gamelist';

/** After `/emukill`, `/isIdle` is asked every half second, 10 seconds at most (spec 5, step 4). */
const CLOSE_POLL_MS = 500;
const CLOSE_WAIT_MS = 10_000;
/** After `/reloadgames`, the game is looked for in EmulationStation's list every half second, 10 seconds at most. */
const LIST_POLL_MS = 500;
const LIST_WAIT_MS = 10_000;
/** After `/launch`, `/runningGame` is asked every half second, 10 seconds at most, until it names the game's path. */
const START_POLL_MS = 500;
const START_WAIT_MS = 10_000;
/** A woken box has 3 minutes to answer, EmulationStation included (spec 5, step 1); the packet goes again meanwhile. */
const WAKE_WAIT_MS = 180_000;
const WAKE_AGAIN_MS = 5000;
const POLL_MS = 500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The game running on the TV by `/runningGame`, which names it and gives its path with 200 and says none with 201;
 * null for none.
 */
async function runningGame(box: Box): Promise<{ name: string; path: string | null } | null> {
	const { status, body } = await box.es('GET', '/runningGame');
	if (status !== 200) return null;
	let game: { name?: unknown; path?: unknown } | null = null;
	try {
		game = JSON.parse(body) as { name?: unknown; path?: unknown } | null;
	} catch {
		// A game runs, under a name that cannot be read.
	}
	return { name: typeof game?.name === 'string' ? game.name : '', path: typeof game?.path === 'string' ? game.path : null };
}

/** Whether `/isIdle` says true within 10 seconds. */
async function closed(box: Box): Promise<boolean> {
	const deadline = Date.now() + CLOSE_WAIT_MS;
	for (;;) {
		if ((await isIdle(box)) === true) return true;
		if (Date.now() >= deadline) return false;
		await sleep(CLOSE_POLL_MS);
	}
}

/**
 * Whether `read` says true before `waitMs` has passed, asked every `pollMs`, the first time after `firstMs`. A read
 * that fails is asked again, as EmulationStation busy with a reload or a start may drop one; at the deadline the
 * last read's failure is thrown, so that a box really lost still ends as `box-down`.
 */
async function within(read: () => Promise<boolean>, waitMs: number, pollMs: number, firstMs = 0): Promise<boolean> {
	const deadline = Date.now() + waitMs;
	if (firstMs > 0) await sleep(firstMs);
	for (;;) {
		let failure: unknown = null;
		try {
			if (await read()) return true;
		} catch (error) {
			failure = error;
		}
		if (Date.now() >= deadline) {
			if (failure !== null) throw failure;
			return false;
		}
		await sleep(pollMs);
	}
}

/**
 * Whether EmulationStation lists the game at `path`, which 43.1's `/launch` looks up there: a game sent while
 * another ran is not listed until a reload, which Canvas held back. Not listed, or a first read that failed:
 * `/reloadgames` once, then the game is looked for until `waitMs` has passed.
 */
async function listed(box: Box, path: string, waitMs: number): Promise<boolean> {
	// The system is the name of the game's system folder, as `SYSTEM_DIR` names them: `windows` or `dos`.
	const entry = `/systems/${posix.basename(posix.dirname(path))}/games/${listId(path)}`;
	const read = async () => (await box.es('GET', entry)).status === 200;
	if (await read().catch(() => false)) return true;
	if ((await box.es('GET', '/reloadgames')).status !== 200) return false;
	return within(read, waitMs, LIST_POLL_MS, LIST_POLL_MS);
}

/** Whether `/runningGame` gives the game at `path` before `waitMs` has passed: 43.1 answers 200 to a start it does not make. */
function started(box: Box, path: string, waitMs: number): Promise<boolean> {
	return within(async () => (await runningGame(box))?.path === path, waitMs, START_POLL_MS);
}

/**
 * Spec 5, steps 2 to 4, on a box that answers: the game's folder is still there, the box has a screen, and no
 * other game runs unless `closeRunning` closes it first; then the game in EmulationStation's list, `POST /launch`
 * with `path`, the game's folder on the box, and the game running. A start EmulationStation does not accept
 * throws; a game that does not show in the list, or does not run, is `not-started`.
 */
export async function playOnBox(box: Box, path: string, closeRunning: boolean, o: { listWaitMs?: number; startWaitMs?: number } = {}): Promise<PlayView> {
	if (!(await box.list(posix.dirname(path))).includes(posix.basename(path))) return { state: 'gone' };
	// Batocera 43.1 takes the screen from the primary output only; a box started while the TV was off has none.
	const { stdout } = await box.exec(COMMANDS.primary);
	if (parsePrimary(stdout) === null) return { state: 'no-screen' };
	const running = await runningGame(box);
	if (running !== null) {
		if (!closeRunning) return { state: 'running', name: running.name };
		await box.es('GET', '/emukill');
		if (!(await closed(box))) return { state: 'running', name: running.name };
	}
	if (!(await listed(box, path, o.listWaitMs ?? LIST_WAIT_MS))) return { state: 'not-started' };
	const { status } = await box.es('POST', '/launch', path);
	if (status !== 200) throw new Error(`emulationstation answered ${status} to the start`);
	return (await started(box, path, o.startWaitMs ?? START_WAIT_MS)) ? { state: 'started' } : { state: 'not-started' };
}

export interface WakeToPlay {
	/** Sends the wake packet of spec 6.1. */
	wake(): Promise<void>;
	/** Whether the box's SSH port answers. */
	answers(): Promise<boolean>;
	/** Logs in to the box with the saved login. */
	open(): Promise<Box>;
	log: Logger;
}

/** A connection to the box once its EmulationStation answers `/caps`; null when it does not before `deadline`. */
async function esUp(d: WakeToPlay, deadline: number): Promise<Box | null> {
	for (;;) {
		let box: Box | null = null;
		try {
			box = await d.open();
			while ((await box.es('GET', '/caps').catch(() => null))?.status !== 200) {
				if (Date.now() >= deadline) {
					box.close();
					return null;
				}
				await sleep(POLL_MS);
			}
			return box;
		} catch {
			// A box that is starting may take the connection before it lets anyone in.
			box?.close();
		}
		if (Date.now() >= deadline) return null;
		await sleep(POLL_MS);
	}
}

/**
 * Spec 5, step 1, with waking on: the wake packet, again every 5 seconds, until the box answers and its
 * EmulationStation does, 3 minutes at most; then the play. `box-down` when the box did not answer in time.
 */
export async function wakeAndPlay(d: WakeToPlay, path: string, closeRunning: boolean): Promise<PlayView> {
	const deadline = Date.now() + WAKE_WAIT_MS;
	let next = 0;
	for (;;) {
		if (Date.now() >= next) {
			next = Date.now() + WAKE_AGAIN_MS;
			await d.wake().catch((error: unknown) => d.log.warn('the wake packet could not be sent', { reason: messageOf(error) }));
		}
		if (await d.answers()) break;
		if (Date.now() >= deadline) return { state: 'box-down' };
		await sleep(POLL_MS);
	}
	const box = await esUp(d, deadline);
	if (!box) return { state: 'box-down' };
	try {
		return await playOnBox(box, path, closeRunning);
	} finally {
		box.close();
	}
}

export interface CountdownDeps {
	seconds: number;
	/** Whether no game runs on the TV; it rejects when the box or EmulationStation does not say. */
	isIdle: () => Promise<boolean>;
	/** Shuts the box down, or leaves it on when the settings no longer want it, and says which in the log. */
	shutdown: () => Promise<void>;
	log: Logger;
}

/** Spec 6.2: the shutdown after a send Canvas woke the box for, in memory as the jobs are. */
export class Countdown {
	readonly #o: CountdownDeps;
	#timer: NodeJS.Timeout | null = null;
	#endsAt: number | null = null;
	/** At zero, while the box is asked whether a game runs: it still runs, with no seconds left. */
	#checking = false;
	/** Counted up at each start and cancel, so that a zero under way knows that it was cancelled meanwhile. */
	#round = 0;

	constructor(o: CountdownDeps) {
		this.#o = o;
	}

	/** Starts it from the full time, again if it runs. */
	start(): void {
		this.cancel();
		const round = this.#round;
		const ms = this.#o.seconds * 1000;
		this.#endsAt = Date.now() + ms;
		this.#timer = setTimeout(() => void this.#zero(round), ms);
		this.#timer.unref();
		this.#o.log.info('batocera shuts down when the countdown ends, unless it is kept on', { seconds: this.#o.seconds });
	}

	/** True when one ran, counting down or in its check at zero. */
	cancel(): boolean {
		const running = this.#endsAt !== null || this.#checking;
		this.#round++;
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = null;
		this.#endsAt = null;
		this.#checking = false;
		return running;
	}

	/** The whole seconds left, rounded up; null while none runs. */
	left(): number | null {
		return this.#endsAt === null ? null : Math.max(0, Math.ceil((this.#endsAt - Date.now()) / 1000));
	}

	/** At zero: no shutdown while a game runs on the TV, or when the box does not say (spec 6.2). */
	async #zero(round: number): Promise<void> {
		const { log } = this.#o;
		this.#timer = null;
		this.#endsAt = null;
		this.#checking = true;
		try {
			let idle: boolean;
			try {
				idle = await this.#o.isIdle();
			} catch (error) {
				log.info('batocera did not say whether a game runs, so it stays on', { reason: messageOf(error) });
				return;
			}
			// Play, "Keep it on" or a new send while the box was asked.
			if (round !== this.#round) return;
			if (!idle) {
				log.info('a game runs on the tv, so batocera stays on');
				return;
			}
			await this.#o.shutdown().catch((error: unknown) => log.warn('batocera could not be shut down', { reason: messageOf(error) }));
		} finally {
			if (round === this.#round) this.#checking = false;
		}
	}
}
