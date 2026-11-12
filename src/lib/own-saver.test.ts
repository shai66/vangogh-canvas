import { describe, expect, it } from 'vitest';
import type { OwnCollection } from './own';
import { applyResult, failureText, OwnQueue, sendOwn, type OwnRequest, type OwnResult } from './own-saver';
import { t } from './strings';

const party: OwnCollection = { id: 'h1', name: 'Party Night', members: [{ game: '1201' }, { collection: 's7' }] };
const rainy: OwnCollection = { id: 'h3', name: 'Rainy Sundays', members: [{ game: '1302' }] };
const shelf: OwnCollection = { id: 'h4', name: 'Shelf B', members: [] };

const create: OwnRequest = { kind: 'create', body: { name: 'Shelf B', members: [] } };
const change: OwnRequest = { kind: 'change', id: 'h3', body: { add: [{ game: '1404' }] } };
const remove: OwnRequest = { kind: 'delete', id: 'h3' };

/** A fetch that records each call and answers with this status and, when given, this body of JSON. */
function answering(status: number, body?: unknown) {
	const calls: { url: string; method?: string; type: string | null; body: unknown }[] = [];
	const fetcher = ((url: string, init: RequestInit) => {
		calls.push({
			url,
			method: init.method,
			type: new Headers(init.headers).get('content-type'),
			body: init.body === undefined ? undefined : JSON.parse(String(init.body))
		});
		return Promise.resolve(body === undefined ? new Response(null, { status }) : Response.json(body, { status }));
	}) as unknown as typeof fetch;
	return { calls, fetcher };
}

describe('sending a change of own collections', () => {
	it('makes a collection with a POST of JSON, and gives the collection made', async () => {
		const { calls, fetcher } = answering(201, { collection: shelf });
		expect(await sendOwn(create, fetcher)).toEqual({ kind: 'saved', collection: shelf });
		expect(calls).toEqual([{ url: '/api/collections', method: 'POST', type: 'application/json', body: { name: 'Shelf B', members: [] } }]);
	});

	it('changes one with a PATCH of JSON to its address, and gives the collection changed', async () => {
		const changed = { ...rainy, members: [...rainy.members, { game: '1404' }] };
		const { calls, fetcher } = answering(200, { collection: changed });
		expect(await sendOwn(change, fetcher)).toEqual({ kind: 'saved', collection: changed });
		expect(calls).toEqual([{ url: '/api/collections/h3', method: 'PATCH', type: 'application/json', body: { add: [{ game: '1404' }] } }]);
	});

	it('deletes one with a DELETE to its address, and gives no collection', async () => {
		const { calls, fetcher } = answering(204);
		expect(await sendOwn(remove, fetcher)).toEqual({ kind: 'saved', collection: null });
		expect(calls).toEqual([{ url: '/api/collections/h3', method: 'DELETE', type: null, body: undefined }]);
	});

	it('says why Canvas did not save the change', async () => {
		const result = async (status: number, error?: string) =>
			sendOwn(change, answering(status, error === undefined ? undefined : { error }).fetcher);
		expect(await result(401, 'locked')).toEqual({ kind: 'locked' });
		expect(await result(409, 'name-taken')).toEqual({ kind: 'name-taken' });
		expect(await result(400, 'bad-collection')).toEqual({ kind: 'refused' });
		expect(await result(500, 'settings-unwritable')).toEqual({ kind: 'unwritable' });
		expect(await result(403, 'cross-site')).toEqual({ kind: 'forbidden' });
		// A 404 is the collection gone only when Canvas says so; else the settings are off, or not Canvas answered.
		expect(await result(404, 'no-collection')).toEqual({ kind: 'gone' });
		expect(await result(404, 'settings-off')).toEqual({ kind: 'forbidden' });
		expect(await result(404)).toEqual({ kind: 'forbidden' });
		// Another answer, as a proxy in front of Canvas gives when Canvas is down.
		expect(await result(502)).toEqual({ kind: 'unreachable' });
	});

	it('says Canvas did not answer when the fetch fails', async () => {
		const failing = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
		expect(await sendOwn(create, failing)).toEqual({ kind: 'unreachable' });
	});
});

/** A send whose answers the test gives by hand, in the order the sends were made. */
function fakeSend() {
	const sends: { request: OwnRequest; answer: (result: OwnResult) => void; fail: (error: Error) => void }[] = [];
	const send = (request: OwnRequest) => new Promise<OwnResult>((answer, fail) => sends.push({ request, answer, fail }));
	return { sends, send };
}

/** Lets every promise that can settle settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the queue of own collections', () => {
	it('sends one at a time, in the order given, and gives each its own result', async () => {
		const { sends, send } = fakeSend();
		const queue = new OwnQueue(send);
		const results: OwnResult[] = [];
		const first = queue.run(create).then((r) => (results[0] = r));
		const second = queue.run(change).then((r) => (results[1] = r));
		const third = queue.run(remove).then((r) => (results[2] = r));
		await settle();
		// The first is slow: the others wait for it.
		expect(sends.map((s) => s.request)).toEqual([create]);

		sends[0].answer({ kind: 'saved', collection: shelf });
		await first;
		await settle();
		expect(sends.map((s) => s.request)).toEqual([create, change]);

		sends[1].answer({ kind: 'saved', collection: rainy });
		await second;
		await settle();
		expect(sends.map((s) => s.request)).toEqual([create, change, remove]);

		sends[2].answer({ kind: 'saved', collection: null });
		await third;
		// None dropped or merged.
		expect(results).toEqual([
			{ kind: 'saved', collection: shelf },
			{ kind: 'saved', collection: rainy },
			{ kind: 'saved', collection: null }
		]);
	});

	it('sends the next after a failure, or a send that throws', async () => {
		const { sends, send } = fakeSend();
		const queue = new OwnQueue(send);
		const first = queue.run(create);
		const second = queue.run(change);
		const third = queue.run(remove);
		await settle();
		sends[0].answer({ kind: 'unreachable' });
		expect(await first).toEqual({ kind: 'unreachable' });
		await settle();
		sends[1].fail(new Error('broken'));
		await expect(second).rejects.toThrow('broken');
		await settle();
		expect(sends.map((s) => s.request)).toEqual([create, change, remove]);
		sends[2].answer({ kind: 'gone' });
		expect(await third).toEqual({ kind: 'gone' });
	});
});

describe("the page's copy after an answer", () => {
	const own = [party, rainy];

	it('adds a collection made at the end', () => {
		expect(applyResult(own, create, { kind: 'saved', collection: shelf })).toEqual([party, rainy, shelf]);
	});

	it('puts a collection changed in the place of the old one', () => {
		const renamed = { ...party, name: 'Party Nights' };
		expect(applyResult(own, { kind: 'change', id: 'h1', body: { name: 'Party Nights' } }, { kind: 'saved', collection: renamed })).toEqual([
			renamed,
			rainy
		]);
	});

	it('leaves out a collection deleted, or one gone', () => {
		expect(applyResult(own, remove, { kind: 'saved', collection: null })).toEqual([party]);
		expect(applyResult(own, remove, { kind: 'gone' })).toEqual([party]);
		expect(applyResult(own, change, { kind: 'gone' })).toEqual([party]);
	});

	it('keeps the copy as it was after another failure', () => {
		expect(applyResult(own, change, { kind: 'unreachable' })).toEqual(own);
		expect(applyResult(own, create, { kind: 'name-taken' })).toEqual(own);
		expect(applyResult(own, remove, { kind: 'locked' })).toEqual(own);
		// The copy given is not changed.
		expect(own).toEqual([party, rainy]);
	});
});

describe('the red line of a failed change', () => {
	it("says why in the settings sheet's words, or the own collections'", () => {
		expect(failureText({ kind: 'unwritable' })).toBe(t.settings.unwritable);
		expect(failureText({ kind: 'unreachable' })).toBe(t.settings.unreachable);
		expect(failureText({ kind: 'gone' })).toBe('That collection is gone. It was deleted in another browser.');
		expect(failureText({ kind: 'name-taken' })).toBe('There is already a collection of that name.');
		// A change Canvas refused says so, as the settings sheet does.
		expect(failureText({ kind: 'refused' })).toBe(t.settings.refused);
		expect(failureText({ kind: 'forbidden' })).toBe(t.settings.refused);
	});

	it('is none for a change saved, or one that has a way of its own', () => {
		expect(failureText({ kind: 'saved', collection: shelf })).toBeNull();
		expect(failureText({ kind: 'locked' })).toBeNull();
	});
});
