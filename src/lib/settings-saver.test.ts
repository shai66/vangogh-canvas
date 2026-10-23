import { describe, expect, it } from 'vitest';
import { applyBody, NO_SETTINGS, toAnswer, type SettingsBody } from './settings';
import { SettingsSaver, sendSettings, type SaveResult } from './settings-saver';

/** A send whose answers the test gives by hand, in the order the sends were made. */
function fakeSend() {
	const sends: { next: SettingsBody; answer: (result: SaveResult) => void }[] = [];
	const send = (next: SettingsBody) => new Promise<SaveResult>((resolve) => sends.push({ next, answer: resolve }));
	return { sends, send };
}

const STACK = { rebuildAt: '04:30', timeZone: 'UTC', versionCheck: true };

/** Lets every promise that can settle settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const state = (sort: SettingsBody['defaults']['sort'], theo = false): SettingsBody => ({
	defaults: { ...NO_SETTINGS.defaults, sort },
	theo,
	preferred: 'auto',
	batocera: { on: false, address: '', user: 'root', wake: false, shutdown: false }
});
const saved = (next: SettingsBody): SaveResult => ({
	kind: 'saved',
	answer: toAnswer(applyBody(NO_SETTINGS, next), '2026-11-19T10:00:00.000Z', true, STACK, STACK)
});

describe('the saver of the settings', () => {
	it('sends one change and gives its result', async () => {
		const { sends, send } = fakeSend();
		const saver = new SettingsSaver(send);
		const result = saver.save(state('recent'));
		expect(sends.map((s) => s.next)).toEqual([state('recent')]);
		sends[0].answer(saved(state('recent')));
		expect(await result).toEqual(saved(state('recent')));
	});

	it('sends one at a time, and only the latest state after the one under way', async () => {
		const { sends, send } = fakeSend();
		const saver = new SettingsSaver(send);
		const results: SaveResult[] = [];
		const first = saver.save(state('recent')).then((r) => (results[0] = r));
		const second = saver.save(state('year')).then((r) => (results[1] = r));
		const third = saver.save(state('year', true)).then((r) => (results[2] = r));
		await settle();
		// The second and the third wait for the first.
		expect(sends.map((s) => s.next)).toEqual([state('recent')]);

		sends[0].answer(saved(state('recent')));
		await first;
		await settle();
		// After it, the latest state only.
		expect(sends.map((s) => s.next)).toEqual([state('recent'), state('year', true)]);
		expect(results).toEqual([saved(state('recent'))]);

		sends[1].answer(saved(state('year', true)));
		await Promise.all([second, third]);
		await settle();
		expect(sends).toHaveLength(2);
		expect(results).toEqual([saved(state('recent')), saved(state('year', true)), saved(state('year', true))]);

		// Nothing is under way any more: the next change is sent at once.
		saver.save(state('title'));
		expect(sends.map((s) => s.next)).toEqual([state('recent'), state('year', true), state('title')]);
	});

	it('gives the failure of the send that carried the change', async () => {
		const { sends, send } = fakeSend();
		const saver = new SettingsSaver(send);
		const first = saver.save(state('recent'));
		const second = saver.save(state('year'));
		sends[0].answer({ kind: 'unreachable' });
		expect(await first).toEqual({ kind: 'unreachable' });
		await settle();
		// The failure of the first does not stop the change that waited for it.
		expect(sends.map((s) => s.next)).toEqual([state('recent'), state('year')]);
		sends[1].answer({ kind: 'unwritable' });
		expect(await second).toEqual({ kind: 'unwritable' });
	});
});

describe('sending the settings', () => {
	/** A fetch that answers with this status and no body. */
	const answering = (status: number) => (() => Promise.resolve(new Response(null, { status }))) as unknown as typeof fetch;

	it('sends the whole body', async () => {
		const sent: unknown[] = [];
		const fetcher = ((_: string, init: RequestInit) => {
			sent.push(JSON.parse(String(init.body)));
			return Promise.resolve(new Response(null, { status: 400 }));
		}) as unknown as typeof fetch;
		const next: SettingsBody = { ...state('year'), preferred: 'batocera', batocera: { ...state('year').batocera, on: true, password: 'pa ss' } };
		await sendSettings(next, fetcher);
		expect(sent).toEqual([next]);
	});

	it('says Canvas refused the change when it answers 403 or 404', async () => {
		expect(await sendSettings(state('title'), answering(403))).toEqual({ kind: 'forbidden' });
		expect(await sendSettings(state('title'), answering(404))).toEqual({ kind: 'forbidden' });
		// Settings the server does not take stay a refusal of their own.
		expect(await sendSettings(state('title'), answering(400))).toEqual({ kind: 'refused' });
	});
});
