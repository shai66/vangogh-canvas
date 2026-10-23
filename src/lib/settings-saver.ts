import type { SettingsAnswer, SettingsBody } from './settings';

/** What became of a change of the settings. Spec 0.11.0, section 4.4. */
export type SaveResult =
	| { kind: 'saved'; answer: SettingsAnswer }
	/** The browser was locked meanwhile: by "Lock" in another tab, or the 30 days ran out. */
	| { kind: 'locked' }
	/** The settings folder cannot be written. */
	| { kind: 'unwritable' }
	/** No answer. */
	| { kind: 'unreachable' }
	/** The server did not take the settings. */
	| { kind: 'refused' }
	/** Canvas refused the request: from another site (403), or the settings are off (404). */
	| { kind: 'forbidden' };

/**
 * Sends the changes of the settings sheet one at a time. A change made while one is under way waits for it, and
 * only the latest of the changes that waited is sent after it: the last state wins.
 */
export class SettingsSaver {
	readonly #send: (next: SettingsBody) => Promise<SaveResult>;
	#busy = false;
	/** The state that waits for the send under way, and how its callers are given the result of its own send. */
	#waiting: { next: SettingsBody; result: Promise<SaveResult>; give: (result: Promise<SaveResult>) => void } | null = null;

	constructor(send: (next: SettingsBody) => Promise<SaveResult>) {
		this.#send = send;
	}

	/** Saves `next`. The result is that of the send that carried the latest state at the time of the call. */
	save(next: SettingsBody): Promise<SaveResult> {
		if (this.#waiting) {
			this.#waiting.next = next;
			return this.#waiting.result;
		}
		if (!this.#busy) return this.#run(next);
		let give!: (result: Promise<SaveResult>) => void;
		const result = new Promise<SaveResult>((resolve) => (give = resolve));
		this.#waiting = { next, result, give };
		return result;
	}

	async #run(next: SettingsBody): Promise<SaveResult> {
		this.#busy = true;
		try {
			return await this.#send(next);
		} finally {
			// The state that waited is sent at once, so that no other send can start in between.
			const waiting = this.#waiting;
			this.#waiting = null;
			if (waiting) waiting.give(this.#run(waiting.next));
			else this.#busy = false;
		}
	}
}

/** Sends the settings to Canvas: `PUT /api/settings`. */
export async function sendSettings(next: SettingsBody, fetcher: typeof fetch = fetch): Promise<SaveResult> {
	try {
		const res = await fetcher('/api/settings', {
			method: 'PUT',
			// A body of JSON: SvelteKit refuses a form's or a text's body from the page before Canvas reads it.
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(next)
		});
		if (res.status === 200) return { kind: 'saved', answer: (await res.json()) as SettingsAnswer };
		if (res.status === 401) return { kind: 'locked' };
		if (res.status === 500) return { kind: 'unwritable' };
		if (res.status === 400) return { kind: 'refused' };
		if (res.status === 403 || res.status === 404) return { kind: 'forbidden' };
		// Another answer, as a proxy in front of Canvas gives when Canvas is down.
		return { kind: 'unreachable' };
	} catch {
		return { kind: 'unreachable' };
	}
}
