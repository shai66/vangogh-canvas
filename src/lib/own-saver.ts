import type { CreateBody, OwnCollection, PatchBody } from './own';
import { t } from './strings';

/** A change of the own collections, as the page sends it. Spec of own collections, section 13. */
export type OwnRequest = { kind: 'create'; body: CreateBody } | { kind: 'change'; id: string; body: PatchBody } | { kind: 'delete'; id: string };

/** What became of a change of the own collections. Spec of own collections, section 13. */
export type OwnResult =
	/** The collection as Canvas saved it; null after a delete. */
	| { kind: 'saved'; collection: OwnCollection | null }
	/** The browser was locked meanwhile: by "Lock" in another tab, or the 30 days ran out. */
	| { kind: 'locked' }
	/** The settings folder cannot be written. */
	| { kind: 'unwritable' }
	/** No answer. */
	| { kind: 'unreachable' }
	/** Another own collection has that name, letter case ignored. */
	| { kind: 'name-taken' }
	/** Another browser deleted the collection. */
	| { kind: 'gone' }
	/** The server did not take the change. */
	| { kind: 'refused' }
	/** Canvas refused the request: from another site (403), or the settings are off (404). */
	| { kind: 'forbidden' };

/** Sends a change to Canvas: `POST /api/collections`, or `PATCH` or `DELETE /api/collections/<id>`. */
export async function sendOwn(request: OwnRequest, fetcher: typeof fetch = fetch): Promise<OwnResult> {
	const url = request.kind === 'create' ? '/api/collections' : `/api/collections/${encodeURIComponent(request.id)}`;
	const init: RequestInit =
		request.kind === 'delete'
			? { method: 'DELETE' }
			: {
					method: request.kind === 'create' ? 'POST' : 'PATCH',
					// A body of JSON: SvelteKit refuses a form's or a text's body from the page before Canvas reads it.
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(request.body)
				};
	try {
		const res = await fetcher(url, init);
		if (res.status === 200 || res.status === 201) return { kind: 'saved', collection: ((await res.json()) as { collection: OwnCollection }).collection };
		if (res.status === 204) return { kind: 'saved', collection: null };
		if (res.status === 401) return { kind: 'locked' };
		if (res.status === 409) return { kind: 'name-taken' };
		if (res.status === 404) {
			// The code `problem()` writes tells a collection deleted meanwhile from settings that are off.
			const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
			return body?.error === 'no-collection' ? { kind: 'gone' } : { kind: 'forbidden' };
		}
		if (res.status === 403) return { kind: 'forbidden' };
		if (res.status === 400) return { kind: 'refused' };
		if (res.status === 500) return { kind: 'unwritable' };
		// Another answer, as a proxy in front of Canvas gives when Canvas is down.
		return { kind: 'unreachable' };
	} catch {
		return { kind: 'unreachable' };
	}
}

/** Sends requests one at a time, in the order given; none is dropped or merged. */
export class OwnQueue {
	readonly #send: (request: OwnRequest) => Promise<OwnResult>;
	/** Settles when the last request given has been answered, whatever the answer. */
	#last: Promise<unknown> = Promise.resolve();

	constructor(send: (request: OwnRequest) => Promise<OwnResult> = (request) => sendOwn(request)) {
		this.#send = send;
	}

	/** Sends `request` once the requests given before it are answered, and gives its own result. */
	run(request: OwnRequest): Promise<OwnResult> {
		const result = this.#last.then(() => this.#send(request));
		// A send that throws does not stop the requests after it.
		this.#last = result.catch(() => undefined);
		return result;
	}
}

/** The page's copy after an answer: a saved collection replaces or joins it, a delete or `gone` removes the id. */
export function applyResult(own: OwnCollection[], request: OwnRequest, result: OwnResult): OwnCollection[] {
	if (result.kind === 'saved' && result.collection !== null) {
		const saved = result.collection;
		return own.some((c) => c.id === saved.id) ? own.map((c) => (c.id === saved.id ? saved : c)) : [...own, saved];
	}
	if (request.kind === 'create') return own;
	const removed = result.kind === 'gone' || (result.kind === 'saved' && request.kind === 'delete');
	return removed ? own.filter((c) => c.id !== request.id) : own;
}

/**
 * The red line for a failed result, or null: unwritable, unreachable, refused and forbidden from t.settings, as the
 * settings sheet says them, gone from t.own.gone, name-taken from t.own.taken. Locked has the PIN prompt instead.
 */
export function failureText(result: OwnResult): string | null {
	switch (result.kind) {
		case 'unwritable':
			return t.settings.unwritable;
		case 'unreachable':
			return t.settings.unreachable;
		case 'refused':
		case 'forbidden':
			return t.settings.refused;
		case 'gone':
			return t.own.gone;
		case 'name-taken':
			return t.own.taken;
		default:
			return null;
	}
}
