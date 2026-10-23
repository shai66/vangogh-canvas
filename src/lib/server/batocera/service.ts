import { Readable } from 'node:stream';
import type { ReadableStream as WebStream } from 'node:stream/web';
import type { GameOnBox, JobView, PlayAnswer, PlayView, TestLine, WakeLine } from '../../batocera';
import { batoceraReady } from '../../settings';
import type { Detail, FileEntry } from '../../types';
import { VERSION } from '../../version';
import type { Config } from '../config';
import type { FileTarget } from '../index-types';
import type { Logger } from '../log';
import type { SettingsStore } from '../settings';
import type { IndexStore } from '../store';
import type { VangoghClient } from '../vangogh/client';
import { BoxKeyChanged, BoxRefused, openBox, portOpen, type Box, type BoxLogin } from './box';
import { isIdle, testConnection, testWake, type CheckDeps, type TestEnd } from './check';
import { COMMANDS, SHUTTING_DOWN, SYSTEM_DIR, removeCommand } from './commands';
import { folderName } from './folder';
import { plainText } from './gamelist';
import { LookStore, onBoxOf, readLook } from './look';
import { Countdown, playOnBox, wakeAndPlay } from './play';
import { Sender } from './sender';
import { sendWake } from './wake';

/** A detail asking after a game's state starts a new look once the last is older than this (spec 4.2). */
const LOOK_AGAIN_MS = 60_000;
/** How long vangogh may take to give a picture. */
const IMAGE_MS = 30_000;
/** How long the box's SSH port has to answer a play at once, and each time while it is woken. */
const ANSWER_MS = 5000;
const PORT_MS = 1000;
/** How long a game's state shows its last play's result (the plan's decision). */
const PLAY_KEEP_MS = 10 * 60_000;

export interface BatoceraDeps {
	config: Config;
	settings: SettingsStore;
	store: IndexStore;
	client: VangoghClient;
	log: Logger;
}

/**
 * The answer of a test route: one JSON line per line of the test, sent as it comes. A test the browser
 * leaves runs to its end all the same, so that a box it shut down is woken and a passed test is saved.
 */
export function ndjson(lines: AsyncGenerator<TestLine | WakeLine>): Response {
	const encoder = new TextEncoder();
	let left = false;
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			const next = await lines.next();
			if (left) return;
			if (next.done) controller.close();
			else controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
		},
		cancel() {
			left = true;
			const rest = async () => {
				while (!(await lines.next()).done);
			};
			void rest().catch(() => {});
		}
	});
	return new Response(body, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } });
}

/** An installer from vangogh as a stream, through the client the downloads use. */
async function openInstaller(client: VangoghClient, target: FileTarget, o: { signal: AbortSignal }): Promise<Readable> {
	const res = await client.file(target, { signal: o.signal });
	if (res.status !== 200 || !res.body) {
		await res.body?.cancel();
		// The address names the game: it stays out of the message, and so out of the log.
		throw new Error(`vangogh answered ${res.status} for an installer`);
	}
	return Readable.fromWeb(res.body as WebStream<Uint8Array>);
}

/** Send to Batocera: the box set up in the settings, and the tests that set it up. Spec 0.12.0. */
export class Batocera {
	readonly #o: BatoceraDeps;
	readonly #looks: LookStore;
	readonly #sender: Sender;
	/** The look under way: one at a time. */
	#looking: Promise<void> | null = null;
	/** The shutdown after a send Canvas woke the box for (spec 6.2), and the game of the send that started it. */
	readonly #countdown: Countdown;
	#countdownFor: string | null = null;
	/** A new send cancelled a countdown: Canvas woke the box for the sends before, so that send's end starts a new one. */
	#carried = false;
	/** Each game's last play and when it was answered; the games being played once the box is woken. */
	readonly #plays = new Map<string, { view: PlayView; at: number }>();
	readonly #wakingFor = new Set<string>();

	constructor(o: BatoceraDeps) {
		this.#o = o;
		this.#looks = new LookStore({ dir: o.config.settingsDir, log: o.log });
		const { config, settings, client, log } = o;
		const box = () => settings.get().batocera;
		this.#countdown = new Countdown({
			seconds: config.shutdownSeconds,
			isIdle: () =>
				this.#withBox(async (opened) => {
					const idle = await isIdle(opened);
					if (idle === null) throw new Error('emulationstation did not answer');
					return idle;
				}),
			shutdown: async () => {
				if (!this.#shutdownWanted()) {
					log.info('"shut down after sending" is off now, or batocera is not set up, so it stays on');
					return;
				}
				await this.#withBox(async (opened) => {
					const { code } = await opened.exec(COMMANDS.shutdown);
					if (code > 0 && code !== SHUTTING_DOWN) throw new Error(`the shutdown ended with ${code}`);
				});
				log.info('batocera was shut down, as canvas woke it for the send');
			},
			log
		});
		// A save that turns the shutdown off, Batocera off, or ends "set up" ends the countdown at once.
		settings.onSave(() => {
			if (!this.#shutdownWanted()) this.#cancelCountdown('settings');
		});
		this.#sender = new Sender({
			login: () => ({ address: box().address, port: config.batoceraPort, user: box().user, password: box().password, hostKey: box().hostKey }),
			wakeOn: () => box().wake,
			mac: () => box().mac,
			address: () => box().address,
			openFile: (target, f) => openInstaller(client, target, f),
			checksums: (productId) => client.checksums(productId),
			image: async (imageId) => {
				const res = await client.image(imageId, { signal: AbortSignal.timeout(IMAGE_MS) });
				if (!res.ok) {
					await res.body?.cancel();
					return null;
				}
				return Buffer.from(await res.arrayBuffer());
			},
			open: openBox,
			portOpen,
			wake: (mac) => sendWake(mac, box().address, config.wakeTo),
			log,
			version: VERSION,
			onLook: (opened) => this.#lookThrough(opened),
			onEnd: ({ woke, gameId }) => this.#ended(woke, gameId)
		});
	}

	/** Reads the last look at the box, so that a restart starts from it (spec 10.2). */
	async start(): Promise<void> {
		await this.#looks.load();
	}

	/** Whether a game shows Batocera: the switch is on and the last connection test passed (spec 9.4). */
	ready(): boolean {
		return batoceraReady(this.#o.settings.get());
	}

	#checks(): CheckDeps {
		const { batoceraPort, wakeTo } = this.#o.config;
		return { port: batoceraPort, wakeTo, open: openBox, portOpen, wake: sendWake };
	}

	/** The connection test with what is in the three boxes, the saved password when none was typed (spec 9.3). */
	async *testConnection(input: { address: string; user: string; password?: string }): AsyncGenerator<TestLine> {
		const login = { address: input.address, user: input.user, password: input.password ?? this.#o.settings.get().batocera.password };
		let failedAt: number | null = null;
		let passed = false;
		for await (const line of testConnection(login, this.#checks())) {
			if ('done' in line) {
				const end = await this.#tested(line, login, failedAt);
				passed = 'done' in end && end.ready;
				yield end;
			} else {
				if (line.result === 'fail') failedAt = line.step;
				yield line;
			}
		}
		// Spec 4.2: a look after a passed test, with the login just saved; one under way still had the one before.
		if (passed) {
			await this.#looking;
			await this.look();
		}
	}

	/**
	 * The end of a connection test. A passed test saves the login it used, the box's key and MAC, and makes
	 * Batocera set up; a failed one ends "set up", which means that the last test passed. The key stays here.
	 */
	async #tested(end: TestEnd, login: { address: string; user: string; password: string }, failedAt: number | null): Promise<TestLine> {
		const { settings, log } = this.#o;
		const { address, user } = login;
		log.info('batocera connection test', { address, user, result: end.ready ? 'passed' : `failed at ${failedAt}`, ...(end.error ? { reason: end.error } : {}) });
		if (!end.ready) {
			if (settings.get().batocera.ready) {
				await settings.update((current) => ({ ...current, batocera: { ...current.batocera, ready: false } }));
			}
			return { done: true, ready: false, mac: null };
		}
		const { hostKey, mac } = end;
		const saved = await settings.update((current) => ({
			...current,
			batocera: { ...current.batocera, ...login, hostKey, mac, ready: true }
		}));
		return { done: true, ready: saved, mac: saved ? mac : null };
	}

	/** The wake test with the saved box and MAC (spec 9.5); it ends at once without a saved MAC or address. */
	async *testWake(): AsyncGenerator<WakeLine> {
		const { address, user, password, hostKey, mac } = this.#o.settings.get().batocera;
		if (!mac || !address) {
			yield { done: true, seconds: null };
			return;
		}
		const checks = this.#checks();
		const login = { address, port: checks.port, user, password, hostKey };
		let last: Exclude<WakeLine, { done: true }> | null = null;
		for await (const line of testWake({ ...checks, mac, address, login })) {
			if (!('done' in line)) last = line;
			else this.#o.log.info('batocera wake test', { step: last?.step, result: last?.result, seconds: line.seconds });
			yield line;
		}
	}

	/** Whether a game can go to Batocera (section 2.1): a complete game with Windows files of its own, not marked, Batocera set up. */
	canGo(detail: Detail): boolean {
		const settings = this.#o.settings.get();
		return (
			batoceraReady(settings) &&
			detail.kind === 'game' &&
			detail.complete &&
			(detail.downloads.windows?.length ?? 0) > 0 &&
			!settings.notRunning.includes(detail.id)
		);
	}

	/** The Windows installer files of the game and of its DLC, as the detail lists them. */
	#windowsFiles(detail: Detail): FileEntry[] {
		return [...(detail.downloads.windows ?? []), ...detail.dlc.flatMap((d) => d.downloads.windows ?? [])];
	}

	/** The bytes of the files to send, as the detail lists them. */
	#size(detail: Detail): number {
		return this.#windowsFiles(detail).reduce((sum, f) => sum + f.sizeBytes, 0);
	}

	/** Where the files to send are in vangogh: the Windows installer files of the game and of its DLC. */
	archiveFiles(detail: Detail): FileTarget[] {
		const files = this.#o.store.get()?.files ?? {};
		return this.#windowsFiles(detail).flatMap((f) => {
			const key = `${detail.id}/${f.fileId}`;
			return Object.hasOwn(files, key) ? [files[key]] : [];
		});
	}

	/**
	 * A game's Batocera state from the last look, at once; null when the game is not in the index. A last look
	 * older than a minute starts a new one, which the next answer has (spec 4.2 and 7.7).
	 */
	async state(gameId: string): Promise<GameOnBox | null> {
		const index = this.#o.store.get();
		const detail = index && Object.hasOwn(index.details, gameId) ? index.details[gameId] : null;
		if (!detail) return null;
		const last = this.#looks.get();
		const age = last ? Date.now() - Date.parse(last.at) : Number.NaN;
		// None yet, older than a minute, or from a clock that has gone back since.
		if (!(age >= 0 && age <= LOOK_AGAIN_MS)) void this.look();
		const system = detail.dos ? 'dos' : 'windows';
		const files = this.archiveFiles(detail).map((f) => f.filename);
		const { onBox, marker, newer } = onBoxOf(last, { id: detail.id, name: folderName(detail.title, detail.id), system }, files);
		return {
			can: this.canGo(detail) && onBox !== 'hand',
			system,
			size: this.#size(detail),
			onBox,
			version: marker?.version ?? null,
			sentAt: marker?.sentAt ?? null,
			newer,
			marked: this.#o.settings.get().notRunning.includes(detail.id),
			job: this.#sender.jobOf(detail.id),
			countdown: this.#countdownFor === detail.id ? this.#countdown.left() : null,
			play: this.#playOf(detail.id),
			box: last === null ? 'unknown' : last.up ? 'up' : 'down',
			checkedAt: last?.at ?? null
		};
	}

	/**
	 * Looks at the box with the saved login and keeps what it saw; a box that does not answer keeps the last
	 * look and is marked down. Never throws; a call while a look is under way waits for that one.
	 */
	look(): Promise<void> {
		this.#looking ??= this.#lookOnce()
			.catch((error: unknown) => this.#o.log.error('the look at batocera failed', { reason: error instanceof Error ? error.message : String(error) }))
			.finally(() => (this.#looking = null));
		return this.#looking;
	}

	async #lookOnce(): Promise<void> {
		if (!this.ready()) return;
		const { address, user, password, hostKey } = this.#o.settings.get().batocera;
		let box: Box;
		try {
			box = await openBox({ address, port: this.#o.config.batoceraPort, user, password, hostKey });
		} catch (error) {
			await this.#notAnswering(error);
			return;
		}
		try {
			await this.#lookWith(box);
		} catch (error) {
			await this.#notAnswering(error);
		} finally {
			box.close();
		}
	}

	/**
	 * A look through the open connection of a send that ended (spec 4.2: after every job), after any look under
	 * way, so that two never run at once.
	 */
	async #lookThrough(box: Box): Promise<void> {
		while (this.#looking) await this.#looking;
		this.#looking = (async () => {
			if (!this.ready()) return;
			try {
				await this.#lookWith(box);
			} catch (error) {
				await this.#notAnswering(error);
			}
		})()
			.catch((error: unknown) => this.#o.log.error('the look at batocera failed', { reason: error instanceof Error ? error.message : String(error) }))
			.finally(() => (this.#looking = null));
		return this.#looking;
	}

	/**
	 * Reads what is on the box through an open connection, removes Canvas's leftovers (section 3.5), and keeps the
	 * look. The folders a running send is making hold its marker too, and are not leftovers.
	 */
	async #lookWith(box: Box): Promise<void> {
		const seen = await readLook(box);
		const held = this.#sender.holds();
		const left: string[] = [];
		for (const path of seen.leftovers.filter((p) => !held.includes(p))) if (!(await this.#remove(box, path))) left.push(path);
		await this.#looks.set({ at: new Date().toISOString(), up: true, ...seen, leftovers: left });
	}

	async #remove(box: Box, path: string): Promise<boolean> {
		const { log } = this.#o;
		try {
			const { code, stderr } = await box.exec(removeCommand(path));
			if (code === 0) {
				log.info('a leftover of canvas on batocera removed', { folder: path });
				return true;
			}
			log.warn('a leftover of canvas on batocera could not be removed', { folder: path, code, stderr: stderr.trim() });
		} catch (error) {
			log.warn('a leftover of canvas on batocera could not be removed', { folder: path, reason: error instanceof Error ? error.message : String(error) });
		}
		return false;
	}

	/** A look that did not reach the box, or lost it: the last look stays, and the box is marked down. */
	async #notAnswering(error: unknown): Promise<void> {
		const { log } = this.#o;
		if (error instanceof BoxKeyChanged) log.warn("batocera's key has changed, so the look counts the box as not answering");
		else if (error instanceof BoxRefused) log.warn('batocera refused the login of the look, so the box counts as not answering');
		else log.info('batocera did not answer the look', { reason: error instanceof Error ? error.message : String(error) });
		await this.#looks.markDown(new Date().toISOString());
	}

	/**
	 * Queues a send of the game (section 3.1), or answers with its job already waiting or running; null when the
	 * game is not in the index, `cannot-go` when it cannot go (section 2.1) or was put there by hand (section 3.4).
	 */
	send(gameId: string): JobView | 'cannot-go' | null {
		const index = this.#o.store.get();
		const detail = index && Object.hasOwn(index.details, gameId) ? index.details[gameId] : null;
		if (!detail) return null;
		if (!this.canGo(detail)) return 'cannot-go';
		const system = detail.dos ? 'dos' : 'windows';
		const files = this.archiveFiles(detail);
		const { onBox, marker } = onBoxOf(this.#looks.get(), { id: detail.id, name: folderName(detail.title, detail.id), system }, files.map((f) => f.filename));
		if (onBox === 'hand' || files.length === 0) return 'cannot-go';
		// A send again keeps the folder the game has on the box, and so its Wine prefix (section 2.2).
		const name = marker ? marker.folder.replace(/\.pc$/, '') : folderName(detail.title, detail.id);
		if (this.#cancelCountdown('send')) this.#carried = true;
		// A Play before the send says nothing of the game the send puts on the box.
		this.#plays.delete(detail.id);
		return this.#sender.send({
			gameId: detail.id,
			name,
			system,
			version: detail.downloads.windows?.[0]?.version ?? '',
			size: this.#size(detail),
			files,
			details: {
				name: detail.title,
				description: plainText(detail.description),
				releaseYear: detail.releaseYear,
				developers: detail.developers,
				publisher: detail.publisher,
				genres: detail.genres
			},
			poster: detail.poster,
			backdrop: detail.backdrop
		});
	}

	/** "Stop sending" (section 3.5); false when no job of that id waits or runs. */
	stop(jobId: string): boolean {
		return this.#sender.stop(jobId);
	}

	/** The jobs waiting or running, for `/healthz`. */
	jobs(): number {
		return this.#sender.running();
	}

	/** The saved login of the box. */
	#login(): BoxLogin {
		const { address, user, password, hostKey } = this.#o.settings.get().batocera;
		return { address, port: this.#o.config.batoceraPort, user, password, hostKey };
	}

	/** Logs in to the box with the saved login, does `work`, and logs out. */
	async #withBox<T>(work: (box: Box) => Promise<T>): Promise<T> {
		const box = await openBox(this.#login());
		try {
			return await work(box);
		} finally {
			box.close();
		}
	}

	/** The end of the sends (spec 6.2): the countdown starts when Canvas woke the box for them and "Shut down after sending" is on. */
	#ended(woke: boolean, gameId: string): void {
		const carried = this.#carried;
		this.#carried = false;
		if (!(woke || carried) || !this.#shutdownWanted()) return;
		this.#countdownFor = gameId;
		this.#countdown.start();
	}

	/** "Shut down after sending" is on, and Batocera is set up. */
	#shutdownWanted(): boolean {
		const settings = this.#o.settings.get();
		return batoceraReady(settings) && settings.batocera.shutdown;
	}

	/** Cancels the countdown, counting down or in its check at zero; true when one ran. */
	#cancelCountdown(by: 'play' | 'keep-on' | 'send' | 'settings'): boolean {
		if (!this.#countdown.cancel()) return false;
		this.#o.log.info('the shutdown countdown was cancelled', { by });
		return true;
	}

	/** "Keep it on" (spec 6.2). */
	keepOn(): void {
		this.#cancelCountdown('keep-on');
	}

	/** The game's last play, for 10 minutes. */
	#playOf(gameId: string): PlayView | null {
		const last = this.#plays.get(gameId);
		if (!last) return null;
		if (Date.now() - last.at <= PLAY_KEEP_MS) return last.view;
		this.#plays.delete(gameId);
		return null;
	}

	/** Keeps a play's result for the game's state; a game no longer on the box starts a look, so that it shows "Not there". */
	#played(gameId: string, view: PlayView): PlayView {
		this.#plays.set(gameId, { view, at: Date.now() });
		this.#o.log.info('play on the tv', { game: gameId, result: view.state });
		if (view.state === 'gone') void this.look();
		return view;
	}

	/**
	 * "Play on the TV" (spec 5), which cancels the countdown (spec 6.2). A box that answers plays at once; one
	 * that does not is woken first when waking is on, and the game is played in the background: the answer is
	 * `waking`, and the game's state has the result. Null when the game is not in the index.
	 */
	async play(gameId: string, closeRunning: boolean): Promise<PlayAnswer | null> {
		const index = this.#o.store.get();
		const detail = index && Object.hasOwn(index.details, gameId) ? index.details[gameId] : null;
		if (!detail) return null;
		this.#cancelCountdown('play');
		const system = detail.dos ? 'dos' : 'windows';
		const name = folderName(detail.title, detail.id);
		const files = this.archiveFiles(detail).map((f) => f.filename);
		const { onBox, marker } = onBoxOf(this.#looks.get(), { id: detail.id, name, system }, files);
		if (onBox === 'no') return this.#played(detail.id, { state: 'gone' });
		// The folder its marker names, else the folder put there by hand, named as Canvas names folders (section 4.2).
		const path = marker ? `${SYSTEM_DIR[marker.system]}/${marker.folder}` : `${SYSTEM_DIR[system]}/${name}.pc`;
		if (this.#wakingFor.has(detail.id)) return { state: 'waking' };
		const { log, config } = this.#o;
		// A box lost on the way, or a start EmulationStation refused: Play is pressed again.
		const failed = (error: unknown): PlayView => {
			log.warn('the game could not be started on batocera', { game: detail.id, reason: error instanceof Error ? error.message : String(error) });
			return { state: 'box-down' };
		};
		const { address, wake, mac } = this.#o.settings.get().batocera;
		if (await portOpen(address, config.batoceraPort, ANSWER_MS)) {
			return this.#played(detail.id, await this.#withBox((box) => playOnBox(box, path, closeRunning)).catch(failed));
		}
		if (!wake || !mac) return this.#played(detail.id, { state: 'box-down' });
		log.info('batocera does not answer, so canvas wakes it to play', { game: detail.id });
		this.#wakingFor.add(detail.id);
		const woken = {
			wake: () => sendWake(mac, address, config.wakeTo),
			answers: () => portOpen(address, config.batoceraPort, PORT_MS),
			open: () => openBox(this.#login()),
			log
		};
		void wakeAndPlay(woken, path, closeRunning)
			.catch(failed)
			.then((view) => {
				this.#wakingFor.delete(detail.id);
				this.#played(detail.id, view);
			});
		return this.#played(detail.id, { state: 'waking' });
	}

	/** Sets or takes back the mark "Doesn't run on Batocera" (section 7.6), the id once; false when it could not be saved. */
	mark(gameId: string, marked: boolean): Promise<boolean> {
		return this.#o.settings.update((current) => {
			if (current.notRunning.includes(gameId) === marked) return current;
			const notRunning = marked ? [...current.notRunning, gameId] : current.notRunning.filter((id) => id !== gameId);
			return { ...current, notRunning };
		});
	}
}
