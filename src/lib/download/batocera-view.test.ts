import { describe, expect, it } from 'vitest';
import type { FailReason, GameOnBox, JobView } from '$lib/batocera';
import { batoceraView, lineAnnouncement, MAIN_ICON, type BatoceraOptions } from './batocera-view';

const MB = 1024 ** 2;
const GB = 1024 ** 3;

function job(over: Partial<JobView> = {}): JobView {
	return {
		id: 'job-1',
		state: 'running',
		ahead: 0,
		step: 'copy',
		stepNumber: 1,
		steps: 3,
		overall: 0.42,
		bytesDone: 8.4 * GB,
		bytesAll: 20 * GB,
		minutesLeft: 11,
		waking: 'no',
		waitingForBox: false,
		reason: null,
		endedAt: null,
		listLater: false,
		...over
	};
}

function game(over: Partial<GameOnBox> = {}): GameOnBox {
	return {
		can: true,
		system: 'windows',
		size: 20 * GB,
		onBox: 'no',
		version: null,
		sentAt: null,
		newer: false,
		marked: false,
		job: null,
		countdown: null,
		play: null,
		box: 'up',
		checkedAt: '2026-10-20T21:00:00.000Z',
		...over
	};
}

const o = { unlocked: true, wakeOn: true, play: null, justSent: false, version: 'Release 4', timeZone: 'UTC', picked: true };
const sent = { onBox: 'canvas' as const, version: 'Release 3', sentAt: '2026-10-20T21:14:03Z' };
const done = job({ state: 'done', overall: 1, endedAt: '2026-10-21T10:00:00Z' });
const failed = (reason: FailReason | null) => job({ state: 'failed', reason, endedAt: '2026-10-21T10:00:00Z' });
const HINT = 'Some games need extra settings in Batocera before they run well, such as the controls.';
const UNPACKS = 'Canvas copies the installers to Batocera, which unpacks them.';
const CLOSE = 'You can close this: the server goes on.';
const TV = {
	on: { look: 'dim', tip: 'Batocera is on.' },
	woken: { look: 'dim', tip: 'Batocera is on. Canvas woke it for this send.' },
	waking: { look: 'yellow', tip: 'Batocera is waking up. Canvas woke it for this send.' },
	wakingPlay: { look: 'yellow', tip: 'Batocera is waking up. Canvas woke it to start the game.' },
	keptOn: { look: 'dim', tip: 'Batocera stays on.' },
	counting: { look: 'dim', tip: 'Batocera is on. Canvas woke it for this send, so it shuts down in 9:41.' },
	offWakes: { look: 'faint', tip: 'Batocera is off. Canvas wakes it, then copies the game.' },
	offPlay: { look: 'faint', tip: 'Batocera is off. Canvas wakes it to play.' },
	off: { look: 'faint', tip: 'Batocera does not answer.' },
	unknown: { look: 'faint', tip: 'Canvas has not looked at Batocera yet.' }
};
const notThere = { bold: 'Windows version, 20 GB', check: false, info: UNPACKS, flag: null, bar: null };
const onIt = { bold: 'On Batocera', plain: 'Sent on 20 October.', flag: 'mark', bar: null };
const N7 = (bold: string, plain: string, info: string, acts = [{ label: 'Try again', act: 'retry', primary: false }]) =>
	({ id: 'failed', kind: 'bad', icon: 'warning', bold, plain, info, acts, busy: false });

/** The view of a game's state with the options of every row, and the row's own. */
const view = (g: Partial<GameOnBox> = {}, opts: Partial<BatoceraOptions> = {}) => batoceraView(game(g), { ...o, ...opts });

describe('batoceraView, the line holds the state', () => {
	it('row 1: not sent', () => {
		expect(view()).toMatchObject({
			main: 'send',
			primary: true,
			line: { ...notThere, tv: TV.on, plain: 'Not on Batocera yet.', spoken: 'Windows version, 20 GB. Not on Batocera yet.' },
			note: null
		});
		expect(view({ system: 'dos', size: 120 * MB }).line.bold).toBe('DOS game, 120 MB');
	});

	it('row 2: not sent, the box off, waking on', () => {
		expect(view({ box: 'down' })).toMatchObject({
			menu: { text: 'Off, Canvas wakes it', on: false, disabled: false },
			line: { tv: TV.offWakes, plain: 'Not on Batocera yet.' }
		});
	});

	it('row 3: not sent, the box off, waking off', () => {
		expect(view({ box: 'down' }, { wakeOn: false })).toMatchObject({
			menu: { text: 'Off', on: false, disabled: false },
			line: { tv: TV.off, plain: 'Turn Batocera on to send.' }
		});
	});

	it('row 4: not sent, before the first answer', () => {
		expect(view({ box: 'unknown', checkedAt: null })).toMatchObject({ line: { tv: TV.unknown, plain: 'Not on Batocera yet.' } });
	});

	it('row 5: waiting in line', () => {
		expect(view({ job: job({ state: 'waiting', ahead: 1 }) })).toMatchObject({
			main: 'stop',
			primary: false,
			menu: { text: 'Waiting', on: false, disabled: false },
			line: {
				tv: TV.on,
				bold: 'Waiting to be sent',
				plain: 'One other game is being sent first.',
				info: CLOSE,
				bar: null,
				flag: null,
				spoken: 'Waiting to be sent. One other game is being sent first.'
			},
			note: null
		});
		expect(view({ job: job({ state: 'waiting', ahead: 12 }) }).line.plain).toBe('12 other games are being sent first.');
	});

	it("row 6: the copy's first seconds", () => {
		const first = { step: 'copy', stepNumber: 1, overall: 0.12, minutesLeft: null, waking: 'waking' } as const;
		expect(view({ job: job(first) })).toMatchObject({
			line: { tv: TV.waking, bold: 'Copying to Batocera, 1 of 3', plain: '12 %', info: CLOSE, bar: { overall: 0.12, text: '12 %' } }
		});
		expect(view({ job: job({ ...first, minutesLeft: 11 }) })).toMatchObject({
			line: { plain: '12 % · about 11 minutes left', bar: { text: '12 %, about 11 minutes left' } }
		});
	});

	it('row 7: unpacking', () => {
		expect(view({ job: job({ step: 'unpack', stepNumber: 2, overall: 0.3, minutesLeft: 9, waking: 'awake' }) })).toMatchObject({
			line: { tv: TV.woken, bold: 'Unpacking on Batocera, 2 of 3', plain: '30 % · about 9 minutes left' }
		});
	});

	it('row 8: waiting for Batocera', () => {
		const waiting = { step: 'copy', stepNumber: 1, overall: 0.5, minutesLeft: null, waitingForBox: true } as const;
		expect(view({ job: job({ ...waiting, waking: 'waking' }) })).toMatchObject({
			line: {
				tv: TV.waking,
				bold: 'Waiting for Batocera, 1 of 3',
				plain: 'Batocera is waking up',
				bar: { overall: 0.5, text: '50 %' },
				spoken: 'Waiting for Batocera, 1 of 3. Batocera is waking up.'
			}
		});
		expect(view({ job: job({ ...waiting, waking: 'awake' }) })).toMatchObject({ line: { tv: TV.woken, plain: 'Batocera is awake' } });
		expect(view({ job: job({ ...waiting, waking: 'no' }) })).toMatchObject({ line: { tv: TV.on, plain: 'Batocera is on' } });
	});

	it('row 9: copying', () => {
		expect(view({ job: job({ step: 'copy', stepNumber: 1, overall: 0.55, minutesLeft: 11 }) })).toMatchObject({
			menu: { text: 'Sending', on: false, disabled: false },
			line: {
				tv: TV.on,
				bold: 'Copying to Batocera, 1 of 3',
				plain: '55 % · about 11 minutes left',
				bar: { overall: 0.55, text: '55 %, about 11 minutes left' },
				spoken: 'Copying to Batocera, 1 of 3.'
			}
		});
	});

	it('row 10: reloading the list', () => {
		expect(view({ job: job({ step: 'reload', stepNumber: 3, overall: 0.995, minutesLeft: 1 }) })).toMatchObject({
			line: { bold: "Reloading Batocera's list, 3 of 3", plain: '99 %', bar: { text: '99 %' } }
		});
	});

	it('row 11: sent, fresh', () => {
		expect(view({ ...sent, job: done }, { justSent: true })).toMatchObject({
			main: 'play',
			primary: true,
			line: {
				...onIt,
				tv: TV.on,
				check: true,
				info: `Version Release 3. It is in Batocera's list, under Windows. ${HINT}`,
				spoken: 'On Batocera. Sent on 20 October.'
			},
			note: null
		});
		expect(view({ ...sent, job: { ...done, waking: 'awake' } }, { justSent: true }).line.tv).toEqual(TV.woken);
		expect(view({ ...sent, job: done }, { justSent: true, unlocked: false }).line.flag).toBeNull();
		expect(view({ ...sent, system: 'dos', job: done }, { justSent: true }).line.info).toBe(`Version Release 3. It is in Batocera's list, under DOS. ${HINT}`);
	});

	it('row 12: sent while a game runs on the TV', () => {
		expect(view({ ...sent, job: { ...done, listLater: true } }, { justSent: true })).toMatchObject({
			line: { info: `Version Release 3. It shows in Batocera's list once the game on the TV is closed. ${HINT}` }
		});
	});

	it('row 13: sent, with the countdown', () => {
		const countdown = {
			id: 'countdown',
			kind: 'plain',
			icon: 'power',
			bold: 'Batocera shuts down in 9:41.',
			plain: 'Canvas woke it for this send.',
			info: null,
			acts: [{ label: 'Keep it on', act: 'keep', primary: false }]
		};
		expect(view({ ...sent, job: done, countdown: 581 }, { justSent: true })).toMatchObject({ line: { tv: TV.woken, check: true }, note: countdown });
		expect(view({ ...sent, job: done, countdown: 581 }, { justSent: true, picked: false }).note).toMatchObject(countdown);
		// Still fresh while the countdown runs, past the ten minutes.
		expect(view({ ...sent, job: done, countdown: 581 })).toMatchObject({
			line: { check: true, info: `Version Release 3. It is in Batocera's list, under Windows. ${HINT}` }
		});
	});

	it('row 14: kept on', () => {
		expect(view({ ...sent, job: done }, { justSent: true, keptOn: true })).toMatchObject({ line: { tv: TV.keptOn, check: true }, note: null });
	});

	it('row 15: on the box', () => {
		expect(view(sent)).toMatchObject({
			menu: { text: 'On Batocera', on: true, disabled: false },
			line: { ...onIt, tv: TV.on, check: false, info: `Version Release 3. ${HINT}` },
			note: null
		});
		expect(view({ ...sent, sentAt: null }).line.plain).toBe('Sent by Canvas.');
		expect(view({ ...sent, version: null }).line.info).toBe(HINT);
		expect(view({ ...sent, box: 'down' }).line.tv).toEqual(TV.offPlay);
		expect(view({ ...sent, box: 'down' }, { wakeOn: false }).line.tv).toEqual(TV.off);
	});

	it('row 16: a newer version', () => {
		expect(view({ ...sent, newer: true })).toMatchObject({
			menu: { text: 'Newer version' },
			line: { info: `Batocera has Release 3; vangogh has Release 4. ${HINT}` },
			note: {
				id: 'newer',
				kind: 'plain',
				icon: 'update',
				bold: 'vangogh has a newer version.',
				plain: 'Saves stay as they are.',
				acts: [{ label: 'Update on Batocera', act: 'update', primary: false }]
			}
		});
		expect(view({ ...sent, newer: true }, { version: 'Release 3' }).line.info).toBe(`vangogh's installer files have changed since it was sent. ${HINT}`);
		expect(view({ ...sent, newer: true }, { picked: false }).note).toBeNull();
	});

	it('row 17: put there by hand', () => {
		expect(view({ onBox: 'hand' })).toMatchObject({
			line: { bold: 'On Batocera', plain: 'Put there by hand.', info: `Canvas leaves a game put there by hand as it is. ${HINT}`, flag: 'mark' }
		});
	});

	it('row 18: starting', () => {
		expect(view(sent, { starting: 'play' })).toMatchObject({
			main: 'starting',
			primary: false,
			disabled: true,
			line: { tv: TV.on, plain: 'Starting the game on the TV…', info: `Version Release 3. ${HINT}` },
			note: null
		});
		// A note shown before stays while the next Play waits, its buttons waiting too.
		expect(view(sent, { starting: 'play', play: { state: 'box-down' } })).toMatchObject({
			line: { tv: TV.on },
			note: {
				id: 'box-down',
				kind: 'bad',
				icon: 'warning',
				bold: 'Batocera does not answer.',
				plain: 'Turn it on, then press Play.',
				acts: [],
				busy: true
			}
		});
	});

	it('row 19: starting after "Close it and play"', () => {
		expect(view(sent, { starting: 'close', play: { state: 'running', name: 'Other Game' } })).toMatchObject({
			line: { tv: TV.on, plain: 'Closing the other game first…' },
			note: { id: 'running', busy: true }
		});
	});

	it('row 20: Play waking the box', () => {
		expect(view(sent, { play: { state: 'waking' } })).toMatchObject({
			main: 'play',
			primary: true,
			line: { tv: TV.wakingPlay, plain: 'Waking Batocera to play…' },
			note: null
		});
	});

	it('row 21: started on the TV', () => {
		expect(view(sent, { play: { state: 'started' } })).toMatchObject({ line: { tv: TV.on, plain: 'Started. Pick up the remote.' }, note: null });
		// A fresh send keeps its check and its "i" through Play's rows.
		expect(view({ ...sent, job: done }, { justSent: true, play: { state: 'started' } })).toMatchObject({
			line: { check: true, plain: 'Started. Pick up the remote.', info: `Version Release 3. It is in Batocera's list, under Windows. ${HINT}` }
		});
	});

	it('row 22: another game running', () => {
		expect(view(sent, { play: { state: 'running', name: 'Other Game' } })).toMatchObject({
			main: 'play',
			primary: false,
			disabled: false,
			line: { plain: 'Sent on 20 October.' },
			note: {
				id: 'running',
				kind: 'plain',
				icon: 'controller',
				bold: 'A game is running on the TV.',
				plain: 'Close it and start this one?',
				acts: [
					{ label: 'Close it and play', act: 'force', primary: true },
					{ label: 'Cancel', act: 'cancel', primary: false }
				],
				busy: false
			}
		});
	});

	it('row 23: Play with the box off, waking off', () => {
		expect(view(sent, { play: { state: 'box-down' } })).toMatchObject({
			primary: true,
			line: { tv: TV.off },
			note: { id: 'box-down', kind: 'bad', icon: 'warning', bold: 'Batocera does not answer.', plain: 'Turn it on, then press Play.', acts: [] }
		});
	});

	it('row 24: no screen', () => {
		expect(view(sent, { play: { state: 'no-screen' } })).toMatchObject({
			line: { tv: TV.on },
			note: { id: 'no-screen', kind: 'bad', icon: 'monitor', bold: 'Batocera sees no screen.', plain: 'Turn the TV on, then restart Batocera.' }
		});
	});

	it('a start Batocera did not make', () => {
		expect(view(sent, { play: { state: 'not-started' } })).toMatchObject({
			main: 'play',
			primary: true,
			disabled: false,
			line: { tv: TV.on },
			note: { id: 'not-started', kind: 'bad', icon: 'warning', bold: 'The game did not start on the TV.', plain: 'Press Play again.', acts: [] }
		});
	});

	it('row 25: the box not answering a look, the game on it', () => {
		expect(view({ ...sent, box: 'down' })).toMatchObject({ main: 'play', primary: true, line: { tv: TV.offPlay }, note: null });
	});

	it('row 26: the game gone from the box, though the last look still says on it', () => {
		expect(view(sent, { play: { state: 'gone' } })).toMatchObject({
			main: 'send',
			primary: true,
			menu: { text: 'Not there yet' },
			line: { ...notThere, plain: 'Not on Batocera yet.' },
			note: { id: 'gone', kind: 'bad', icon: 'warning', bold: 'The game is no longer on Batocera.', plain: '' }
		});
	});

	it('row 27: a failed send', () => {
		const note = N7(
			'Batocera has no room to unpack it.',
			'3.1 GB free, 20 GB needed.',
			'Batocera has 3.1 GB free, and the send needs 20 GB while it unpacks. Nothing was left on the box.'
		);
		const g = { job: failed({ code: 'box-room', free: 3.1 * GB, need: 20 * GB }) };
		expect(view(g)).toMatchObject({ main: 'send', primary: true, line: { ...notThere, plain: 'The send stopped.' }, note });
		expect(view(g, { picked: false }).note).toMatchObject(note);
	});

	it('row 28: a failed update, the older version still on the box', () => {
		expect(view({ ...sent, job: failed({ code: 'copy' }) })).toMatchObject({
			main: 'play',
			primary: true,
			line: { ...onIt, info: `Version Release 3. ${HINT}` },
			note: N7('The copy to Batocera broke off.', 'The older version stays.', 'The copy to Batocera broke off. The older version stays.')
		});
	});

	it('row 29: a failed send, with a countdown', () => {
		expect(view({ ...sent, job: failed({ code: 'copy' }), countdown: 581 })).toMatchObject({
			line: { tv: TV.counting },
			note: {
				acts: [
					{ label: 'Try again', act: 'retry', primary: false },
					{ label: 'Keep it on', act: 'keep', primary: false }
				]
			}
		});
	});

	it('row 30: marked, unlocked', () => {
		expect(view({ ...sent, marked: true })).toMatchObject({
			main: 'send',
			primary: false,
			disabled: true,
			menu: { text: "Doesn't run there", on: false, disabled: false },
			line: { bold: "Doesn't run on Batocera", plain: 'Hidden for everyone else.', info: null, flag: 'unmark', bar: null },
			note: null
		});
		// Marked after a failed send: no note, so "Try again" never sends a game marked as not running.
		expect(view({ ...sent, marked: true, job: failed({ code: 'copy' }), countdown: 581 }).note).toBeNull();
	});

	it('rows 31 and 32: marked, locked', () => {
		expect(view({ ...sent, marked: true }, { unlocked: false })).toMatchObject({
			main: null,
			menu: { text: "Doesn't run there", disabled: true },
			line: { tv: 'prohibit', bold: "Doesn't run on Batocera", plain: 'It was tried on the box and marked in Canvas.', info: null, flag: null },
			note: null
		});
		expect(view({ ...sent, marked: true, job: failed({ code: 'copy' }), countdown: 581 }, { unlocked: false }).note).toBeNull();
	});

	it("shows one note: this page's Play, then a failed send, then the countdown, then a newer version", () => {
		const all = { ...sent, newer: true, job: failed({ code: 'copy' }), countdown: 581 };
		const running = { play: { state: 'running', name: 'Other Game' } } as const;
		expect(view(all, running).note?.id).toBe('running');
		expect(view(all, { ...running, picked: false }).note?.id).toBe('failed');
		expect(view({ ...all, job: null }).note?.id).toBe('countdown');
		expect(view({ ...all, job: null, countdown: null }).note?.id).toBe('newer');
	});

	it('keeps a send first, before the mark, and without a flag', () => {
		expect(view({ ...sent, job: job() })).toMatchObject({ main: 'stop', line: { flag: null } });
		expect(view({ ...sent, marked: true, job: job() })).toMatchObject({ main: 'stop', line: { flag: null } });
		// An update under way has no note: rows 5 to 10 have none, so not the newer version's either.
		expect(view({ ...sent, newer: true, job: job() }).note).toBeNull();
	});

	it('names the icon of the main button by what it does', () => {
		expect(MAIN_ICON).toEqual({ send: 'tv', stop: 'stopCircle', play: 'play', starting: 'spinner' });
	});
});

describe('lineAnnouncement', () => {
	const copying = { sentence: 'Copying to Batocera, 1 of 3.', on: true };
	const reloading = { sentence: "Reloading Batocera's list, 3 of 3.", on: true };

	it('says nothing at the first draw', () => {
		expect(lineAnnouncement(null, copying)).toBeNull();
	});

	it('says the new sentence while the button stays on Batocera', () => {
		expect(lineAnnouncement(copying, reloading)).toBe("Reloading Batocera's list, 3 of 3.");
	});

	it('says nothing for the same sentence, nor when the button only moves to or from Batocera', () => {
		expect(lineAnnouncement(copying, { ...copying })).toBeNull();
		expect(lineAnnouncement({ ...copying, on: false }, reloading)).toBeNull();
		expect(lineAnnouncement(copying, { ...reloading, on: false })).toBeNull();
	});
});
