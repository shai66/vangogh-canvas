import type { Index } from './index-types';
import type { Logger } from './log';

export type RebuildResult = 'ok' | 'failed' | 'busy';

export interface RebuildStatus {
	running: boolean;
	lastResult: 'never' | 'ok' | 'failed';
	lastAt: string | null;
	lastError: string | null;
	lastDurationMs: number | null;
}

export interface RebuilderDeps {
	build: () => Promise<Index>;
	store: { set(index: Index): Promise<void> };
	log: Logger;
	/** Runs before every build. */
	before?: () => void;
}

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Runs a log call; a logger that fails must not stop a rebuild from finishing. */
function quietly(write: () => void): void {
	try {
		write();
	} catch {
		// Nothing left to tell it to.
	}
}

/** Runs one rebuild at a time and remembers how the last one went. */
export class Rebuilder {
	readonly #deps: RebuilderDeps;
	#status: RebuildStatus = {
		running: false,
		lastResult: 'never',
		lastAt: null,
		lastError: null,
		lastDurationMs: null
	};

	/** Called after every rebuild that ran. */
	onResult: ((ok: boolean, error: unknown) => void) | null = null;

	constructor(deps: RebuilderDeps) {
		this.#deps = deps;
	}

	status(): RebuildStatus {
		return { ...this.#status };
	}

	/** Starts a rebuild without waiting for it. */
	start(): 'started' | 'busy' {
		if (this.#status.running) return 'busy';
		void this.run();
		return 'started';
	}

	async run(): Promise<RebuildResult> {
		if (this.#status.running) return 'busy';
		this.#status.running = true;
		const began = Date.now();
		let failure: unknown = null;
		let ok = false;
		try {
			this.#deps.before?.();
			const index = await this.#deps.build();
			await this.#deps.store.set(index);
			ok = true;
			quietly(() =>
				this.#deps.log.info('rebuild finished', {
					entries: index.entries.length,
					files: Object.keys(index.files).length,
					incomplete: index.entries.filter((e) => !e.complete).length,
					version: index.version,
					durationMs: Date.now() - began
				})
			);
		} catch (error) {
			failure = error;
			quietly(() =>
				this.#deps.log.error('rebuild failed', {
					reason: reason(error),
					durationMs: Date.now() - began
				})
			);
		}
		this.#status = {
			running: false,
			lastResult: ok ? 'ok' : 'failed',
			lastAt: new Date().toISOString(),
			lastError: ok ? null : reason(failure),
			lastDurationMs: Date.now() - began
		};
		try {
			this.onResult?.(ok, failure);
		} catch (error) {
			quietly(() =>
				this.#deps.log.error('the result of the rebuild could not be handled', {
					reason: reason(error)
				})
			);
		}
		return ok ? 'ok' : 'failed';
	}
}
