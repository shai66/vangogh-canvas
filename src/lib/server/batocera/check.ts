import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import type { TestLine, WakeLine } from '../../batocera';
import { BoxRefused, type Box, type BoxLogin, type openBox, type portOpen } from './box';
import { COMMANDS, PROBE, SHUTTING_DOWN, SYSTEM_DIR, macFor, parseDf, parseVersion, removeCommand } from './commands';
import type { sendWake } from './wake';

export interface CheckDeps {
	/** The box's SSH port. */
	port: number;
	/** Where the wake packet goes instead of the broadcasts; null but in the tests. */
	wakeTo: string | null;
	open: typeof openBox;
	portOpen: typeof portOpen;
	wake: typeof sendWake;
	/** How long the box may take to stop answering after the shutdown: 60 seconds by the spec. */
	downWaitMs?: number;
	/** How long the box may take to answer after the packet: 3 minutes by the spec. */
	upWaitMs?: number;
}

type StepLine = Exclude<TestLine, { done: true }>;

/**
 * The end of a connection test as the service is told it: with the box's host key, and why line 2 failed,
 * for the log. No browser is sent either.
 */
export type TestEnd = Extract<TestLine, { done: true }> & { hostKey: string | null; error?: string };

/** How long the box has to take a connection at line 1. */
const ANSWER_MS = 5000;
const DOWN_WAIT_MS = 60_000;
const UP_WAIT_MS = 180_000;
/** How long one look at the SSH port may take while waiting for the box to go or come. */
const PORT_MS = 1000;
const POLL_MS = 500;
/** The packet goes again while the box does not answer: one that came while it was still powering off is lost. */
const WAKE_AGAIN_MS = 5000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Asks `check` every half second until it says yes or `ms` have passed; whether it said yes. */
async function until(check: () => Promise<boolean>, ms: number): Promise<boolean> {
	const deadline = Date.now() + ms;
	for (;;) {
		if (await check()) return true;
		if (Date.now() >= deadline) return false;
		await sleep(POLL_MS);
	}
}

/** The box's own words for an SFTP failure, such as "Permission denied"; none for anything else. */
function reasonOf(error: unknown): { reason?: string } {
	const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
	return typeof code === 'number' && typeof message === 'string' && message !== '' ? { reason: message } : {};
}

/** Why the login failed, for the log: what lies under "Batocera does not answer", such as "timed out", else the error's own words. */
function whyOf(error: unknown): string {
	const cause = (error as { cause?: unknown })?.cause;
	if (cause instanceof Error) return cause.message;
	return error instanceof Error ? error.message : String(error);
}

/** Writes a small file into `dir`, reads it back and removes it; throws when one of them fails. */
async function probe(box: Box, dir: string): Promise<void> {
	const file = posix.join(dir, PROBE);
	const data = Buffer.from(`Canvas ${randomUUID()}\n`);
	try {
		await box.write(file, data);
		if (!(await box.read(file))?.equals(data)) throw new Error('the probe read back differs');
	} catch (error) {
		// Not left behind, whatever came of it.
		await box.exec(removeCommand(file)).catch(() => {});
		throw error;
	}
	if ((await box.exec(removeCommand(file))).code !== 0) throw new Error('the probe cannot be removed');
}

/** Line 3, after both probes: whether the box has innoextract, which unpacks the games on it (0.12.1). */
async function hasInnoextract(box: Box): Promise<boolean> {
	try {
		const { code, stdout } = await box.exec(COMMANDS.innoextract);
		return code === 0 && stdout.trim() !== '';
	} catch {
		return false;
	}
}

/** Line 4: the free space of /userdata and Batocera's version, or a warning. */
async function space(box: Box): Promise<StepLine> {
	try {
		const df = await box.exec(COMMANDS.df);
		const version = await box.exec(COMMANDS.version);
		if (df.code !== 0 || version.code !== 0) return { step: 4, result: 'warn' };
		return { step: 4, result: 'ok', free: parseDf(df.stdout), version: parseVersion(version.stdout) };
	} catch {
		return { step: 4, result: 'warn' };
	}
}

/** Line 5: whether EmulationStation answers `/caps`, or a warning. */
async function emulationStation(box: Box): Promise<StepLine> {
	const up = await box.es('GET', '/caps').then(
		({ status }) => status === 200,
		() => false
	);
	return { step: 5, result: up ? 'ok' : 'warn' };
}

/** The MAC of the box's network card that holds `address`, or null when it cannot be read. */
async function macOf(box: Box, address: string): Promise<string | null> {
	try {
		const { code, stdout } = await box.exec(COMMANDS.ip);
		return code === 0 ? macFor(stdout, address) : null;
	} catch {
		return null;
	}
}

/**
 * The connection test of spec 0.12.0, section 9.3: one line per check as it ends, stopping at the first
 * that fails, then the end with the box's MAC and host key. Warnings do not fail it.
 */
export async function* testConnection(
	input: { address: string; user: string; password: string },
	d: CheckDeps
): AsyncGenerator<StepLine | TestEnd> {
	const failed: TestEnd = { done: true, ready: false, mac: null, hostKey: null };
	const { address } = input;
	if (!(await d.portOpen(address, d.port, ANSWER_MS))) {
		yield { step: 1, result: 'fail', address };
		yield failed;
		return;
	}
	yield { step: 1, result: 'ok', address };
	let box: Box;
	try {
		// Any key: a new test takes the box's key as it is now.
		box = await d.open({ address, port: d.port, user: input.user, password: input.password, hostKey: null });
	} catch (error) {
		// A box that answers at line 1 and whose SSH never starts is not a refused login.
		yield { step: 2, result: 'fail', login: error instanceof BoxRefused ? 'refused' : 'no-ssh' };
		yield { ...failed, error: whyOf(error) };
		return;
	}
	try {
		yield { step: 2, result: 'ok' };
		for (const folder of [SYSTEM_DIR.windows, SYSTEM_DIR.dos]) {
			try {
				await probe(box, folder);
			} catch (error) {
				yield { step: 3, result: 'fail', folder, ...reasonOf(error) };
				yield failed;
				return;
			}
		}
		if (!(await hasInnoextract(box))) {
			yield { step: 3, result: 'fail', noInnoextract: true };
			yield failed;
			return;
		}
		yield { step: 3, result: 'ok' };
		yield await space(box);
		yield await emulationStation(box);
		yield { done: true, ready: true, mac: await macOf(box, address), hostKey: box.hostKey };
	} finally {
		box.close();
	}
}

/**
 * What EmulationStation's `/isIdle` says, or null when it does not answer or cannot be read. 43.1 answers 200 with
 * `[ true ]` when idle and 201 with `[ false ]` while a game runs.
 */
export async function isIdle(box: Box): Promise<boolean | null> {
	try {
		const { status, body } = await box.es('GET', '/isIdle');
		if (status !== 200 && status !== 201) return null;
		const value: unknown = JSON.parse(body);
		const idle = Array.isArray(value) ? value[0] : value;
		return typeof idle === 'boolean' ? idle : null;
	} catch {
		return null;
	}
}

type WakeTest = CheckDeps & { mac: string; address: string; login: BoxLogin };

/**
 * Step 1 of the wake test: no shutdown unless EmulationStation says no game runs; then the shutdown of
 * spec 6.2, and the wait until the SSH port stops answering. A box that is off already passes at once.
 */
async function shutDown(d: WakeTest): Promise<'ok' | 'fail' | 'busy'> {
	if (!(await d.portOpen(d.address, d.port, ANSWER_MS))) return 'ok';
	let box: Box;
	try {
		box = await d.open(d.login);
	} catch {
		return 'fail';
	}
	try {
		const idle = await isIdle(box);
		if (idle === false) return 'busy';
		if (idle === null) return 'fail';
		// Not waited for: the box may go before it answers.
		const ran = { refused: false };
		void box.exec(COMMANDS.shutdown).then(
			({ code }) => (ran.refused = code > 0 && code !== SHUTTING_DOWN),
			() => {}
		);
		const gone = await until(async () => ran.refused || !(await d.portOpen(d.address, d.port, PORT_MS)), d.downWaitMs ?? DOWN_WAIT_MS);
		return gone && !ran.refused ? 'ok' : 'fail';
	} finally {
		box.close();
	}
}

/**
 * The wake test of spec 0.12.0, section 9.5: shuts the box down, wakes it with the packet of section 6.1,
 * and waits for its SSH port; one line per step as it ends, then the seconds from the packet to the answer.
 */
export async function* testWake(d: WakeTest): AsyncGenerator<WakeLine> {
	const down = await shutDown(d);
	yield { step: 'down', result: down };
	if (down !== 'ok') {
		yield { done: true, seconds: null };
		return;
	}
	const sent = Date.now();
	let next = sent;
	const woke = await until(async () => {
		if (Date.now() >= next) {
			next += WAKE_AGAIN_MS;
			await d.wake(d.mac, d.address, d.wakeTo);
		}
		return d.portOpen(d.address, d.port, PORT_MS);
	}, d.upWaitMs ?? UP_WAIT_MS).catch(() => false);
	const seconds = woke ? Math.round((Date.now() - sent) / 1000) : null;
	yield { step: 'waking', result: woke ? 'ok' : 'fail' };
	yield { done: true, seconds };
}
