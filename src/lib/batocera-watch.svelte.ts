import type { GameOnBox, JobView, PlayView } from './batocera';

/** How often the detail asks while something runs (spec 0.12.0, section 7.7). */
const EVERY_MS = 2000;
/** A look at the box older than this is renewed by the server when it is asked (section 4.2). */
const LOOK_AGE_MS = 60_000;
/** Answers with an old look at most, before the watch stops waiting for a new one. */
const LOOK_TRIES = 5;

/**
 * The last state of each game the page was told, so that a detail opened again starts from it (section 7.7).
 * Filled in the browser only: the server never starts a watch.
 */
const KNOWN = new Map<string, GameOnBox>();

/** What an answer of `POST /api/batocera/games/<id>/play` says, by its status (section 11); null for another. */
async function playOf(res: Response): Promise<PlayView | null> {
	if (res.status === 200) return { state: 'started' };
	if (res.status === 202) return { state: 'waking' };
	if (res.status === 503) return { state: 'box-down' };
	if (res.status !== 409) return null;
	const body = (await res.json().catch(() => null)) as { error?: unknown; name?: unknown } | null;
	if (body?.error === 'game-running') return { state: 'running', name: typeof body.name === 'string' ? body.name : '' };
	if (body?.error === 'no-screen') return { state: 'no-screen' };
	if (body?.error === 'not-started') return { state: 'not-started' };
	if (body?.error === 'not-on-box') return { state: 'gone' };
	return null;
}

const active = (job: JobView | null | undefined): boolean => job?.state === 'waiting' || job?.state === 'running';

/**
 * A game's Batocera state while its detail is open: asked on `start`, then every 2 seconds while a send waits or
 * runs, a countdown runs, a play wakes the box, or the look at the box is older than a minute. Each action goes
 * through its route and asks again at once.
 */
export class BatoceraWatch {
	game = $state<GameOnBox | null>(null);
	/** What became of this page's own Play on the TV; null until it was pressed, and after "Cancel". */
	play = $state<PlayView | null>(null);
	/** This page's Play from its press until its answer: 'close' when pressed as "Close it and play"; else null. */
	starting = $state<'play' | 'close' | null>(null);
	/** True once this page pressed "Keep it on", until its next send. */
	keptOn = $state(false);
	/** This browser's clock at the last answer, and every second while a countdown runs. */
	now = $state(Date.now());
	/** True from the first answer taken: until then the page shows what it was told before, or its own guess. */
	answered = $state(false);

	readonly #id: string;
	readonly #fetch: typeof fetch;
	#on = false;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#ticker: ReturnType<typeof setInterval> | undefined;
	/** The server's clock less this browser's, from the `date` of the last answer. */
	#skew = 0;
	/** When the countdown of the last answer was read, by this browser's clock. */
	#countdownAt = 0;
	/** The asks sent, and the last one whose answer was taken: an older answer that comes late is dropped. */
	#sent = 0;
	#taken = 0;
	/** Answers in a row with an old look. */
	#oldLooks = 0;
	#acting = false;

	constructor(id: string, fetcher?: typeof fetch) {
		this.#id = id;
		// Called on its own: the browser's fetch refuses to run as a method of another object.
		this.#fetch = fetcher ?? ((input, init) => fetch(input, init));
		this.game = KNOWN.get(id) ?? null;
	}

	/** The time on the server's clock, as of the last answer or tick. */
	get serverNow(): number {
		return this.now + this.#skew;
	}

	/** The seconds left of the countdown now, counted down between answers; null when none runs. */
	get left(): number | null {
		const seconds = this.game?.countdown;
		if (seconds === null || seconds === undefined) return null;
		return Math.max(0, seconds - Math.floor((this.now - this.#countdownAt) / 1000));
	}

	/**
	 * What became of Play on the TV as the page shows it: this page's own, else the server's last for the game,
	 * which may come from another device. A game running on the TV is asked about only after this page's own
	 * Play was answered so, never from the server's alone (after "Cancel", or on another device).
	 */
	get shownPlay(): PlayView | null {
		const kept = this.game?.play ?? null;
		return this.play ?? (kept?.state === 'running' ? null : kept);
	}

	start(): void {
		this.#on = true;
		void this.#ask();
	}

	stop(): void {
		this.#on = false;
		clearTimeout(this.#timer);
		clearInterval(this.#ticker);
		this.#timer = this.#ticker = undefined;
	}

	/** "Send to Batocera", "Update on Batocera" and "Try again". */
	send(): Promise<void> {
		return this.#act(async () => {
			// What an ask sent before now answers is older than the send, its Play's answer among it: it is dropped.
			this.#taken = this.#sent;
			const res = await this.#fetch(`/api/batocera/games/${encodeURIComponent(this.#id)}/send`, { method: 'POST' });
			this.play = null;
			this.keptOn = false;
			// The answer is the job: shown at once, without waiting for the next ask. A new send ends a countdown,
			// and the server forgets the game's last Play.
			if (res.status === 202 && this.game) this.game = { ...this.game, job: (await res.json()) as JobView, countdown: null, play: null };
		});
	}

	/** "Stop sending". A send in its last step cannot be stopped any more: the state is asked again. */
	stopJob(): Promise<void> {
		const job = this.game?.job;
		if (!job || !active(job)) return Promise.resolve();
		return this.#act(async () => {
			const res = await this.#fetch(`/api/batocera/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' });
			if (res.status === 204 && this.game?.job?.id === job.id) this.game = { ...this.game, job: null };
		});
	}

	/** "Play on the TV", and "Close it and play" with `closeRunning`. */
	playNow(closeRunning: boolean): Promise<void> {
		return this.#act(async () => {
			this.starting = closeRunning ? 'close' : 'play';
			try {
				const res = await this.#fetch(`/api/batocera/games/${encodeURIComponent(this.#id)}/play`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ closeRunning })
				});
				this.play = await playOf(res);
			} finally {
				this.starting = null;
			}
		});
	}

	/** "Keep it on": the box is not shut down after the send. */
	keepOn(): Promise<void> {
		return this.#act(async () => {
			const res = await this.#fetch('/api/batocera/keep-on', { method: 'POST' });
			if (res.status !== 204) return;
			this.keptOn = true;
			if (this.game) this.game = { ...this.game, countdown: null };
		});
	}

	/** "Doesn't run? Mark it" and "Take the mark back", with the settings unlocked. */
	mark(on: boolean): Promise<void> {
		return this.#act(async () => {
			const res = await this.#fetch(`/api/batocera/marks/${encodeURIComponent(this.#id)}`, { method: on ? 'PUT' : 'DELETE' });
			if (res.status === 204 && this.game) this.game = { ...this.game, marked: on };
		});
	}

	/** One action at a time; whatever it did, the state is asked again at once. */
	async #act(work: () => Promise<void>): Promise<void> {
		if (this.#acting) return;
		this.#acting = true;
		try {
			await work();
		} catch {
			// No answer: the next ask shows how things are.
		} finally {
			this.#acting = false;
			if (this.#on) void this.#ask();
		}
	}

	async #ask(): Promise<void> {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		const asked = ++this.#sent;
		let again = true;
		try {
			const res = await this.#fetch(`/api/batocera/games/${encodeURIComponent(this.#id)}`);
			// Batocera is no longer set up, or the game is gone from the library: nothing more to learn here.
			if (res.status === 404) again = false;
			if (res.ok && asked > this.#taken) {
				const game = (await res.json()) as GameOnBox;
				if (asked > this.#taken) this.#take(asked, game, res.headers.get('date'));
			}
		} catch {
			// No answer: asked again if something runs.
		}
		if (again && this.#on && asked === this.#sent && this.#busy()) this.#timer = setTimeout(() => void this.#ask(), EVERY_MS);
	}

	#take(asked: number, game: GameOnBox, date: string | null): void {
		this.#taken = asked;
		this.answered = true;
		this.now = Date.now();
		const server = date ? Date.parse(date) : Number.NaN;
		if (Number.isFinite(server)) this.#skew = server - this.now;
		this.#countdownAt = this.now;
		this.game = game;
		KNOWN.set(this.#id, game);
		// Play woke the box first: the server's answer of the game's state is that Play's result.
		if (this.play?.state === 'waking' && game.play && game.play.state !== 'waking') this.play = game.play;
		const checked = game.checkedAt ? Date.parse(game.checkedAt) : Number.NaN;
		this.#oldLooks = !(this.serverNow - checked <= LOOK_AGE_MS) ? this.#oldLooks + 1 : 0;
		this.#tick();
	}

	/** The clock of the countdown, once a second while one runs. */
	#tick(): void {
		const counting = this.#on && this.game?.countdown !== null && this.game?.countdown !== undefined;
		if (counting && this.#ticker === undefined) this.#ticker = setInterval(() => (this.now = Date.now()), 1000);
		if (!counting && this.#ticker !== undefined) {
			clearInterval(this.#ticker);
			this.#ticker = undefined;
		}
	}

	/** True while something runs that the next answer shows (section 7.7). */
	#busy(): boolean {
		const game = this.game;
		if (!game) return false;
		const waking = this.play?.state === 'waking' || game.play?.state === 'waking';
		const looking = this.#oldLooks > 0 && this.#oldLooks <= LOOK_TRIES;
		return active(game.job) || game.countdown !== null || waking || looking;
	}
}
