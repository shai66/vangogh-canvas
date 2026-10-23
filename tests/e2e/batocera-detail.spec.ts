import type { Locator, Page } from '@playwright/test';
import type { FailReason, GameOnBox, JobView } from '../../src/lib/batocera';
import { bold, flagButton, infoButton, mainButton, note, open, pickBatocera, plain, room, tipOf, tvButton, unlock } from './batocera-helpers';
import { expect, reach, test, UA } from './helpers';

// A game's detail with Batocera, the line holds the state (spec 2026-10-21, section 8). The Canvas of these tests
// never reaches the box: every ask of a page about Batocera is answered here with page.route, as the server would,
// so this file runs beside batocera.spec.ts without touching the shared box or its settings.
test.describe.configure({ mode: 'serial' });
const BASE = process.env.CANVAS_BATOCERA_DETAIL_URL;
test.use({ baseURL: BASE });

const GB = 1024 ** 3;
const HINT = 'Some games need extra settings in Batocera before they run well, such as the controls.';
const PHONE = { userAgent: UA.phone, viewport: { width: 390, height: 844 }, hasTouch: true };

/** Left, top, width and height, against the window. */
type Box = [number, number, number, number];

/** What each page is answered for each game's state, by its id. */
const makers = new WeakMap<Page, Map<string, () => GameOnBox>>();

/**
 * Answers the page's asks for the game's state with `make()`, as the server would; any other ask fails the test. The
 * route of a game's state is laid once per page and only its maker changes, so no ask falls into a gap between two.
 */
async function answer(page: Page, id: string, make: () => GameOnBox): Promise<void> {
	let games = makers.get(page);
	if (!games) {
		games = new Map();
		makers.set(page, games);
		// Laid first, so the asks a test answers itself, laid later, come before it.
		await page.route('**/api/batocera/**', (route) => {
			expect.soft(`${route.request().method()} ${new URL(route.request().url()).pathname}`, 'an ask this test does not answer').toBe('');
			return route.fulfill({ status: 500 });
		});
	}
	const laid = games.has(id);
	games.set(id, make);
	if (laid) return;
	await page.route(`**/api/batocera/games/${id}`, (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(makers.get(page)!.get(id)!()) })
	);
}

interface Measured {
	button: Box | null;
	room: Box;
	/** The two lines of Batocera's line; null while the room holds a system's text. */
	bold: Box | null;
	plain: Box | null;
	boldFits: boolean;
	plainFits: boolean;
	/** A system's text in the room, while the button is on a system. */
	system: Box | null;
	slots: Box[];
	bar: Box | null;
	/** The width of the bar's fill. */
	fill: number | null;
	note: Box | null;
	/** The note's classes, its text, and whether the text fits its two lines: the guard cuts nothing. */
	noteClass: string | null;
	noteText: Box | null;
	noteTextFits: boolean;
	/** The note's buttons and N7's "i". */
	noteParts: Box[];
	/** What lies under the note: on a computer the file list's tabs and its first file, on a phone the quiet line about installers and "About this game". */
	under: Box[];
	/** The download block's top part, which the room lies in. */
	block: Box;
}

/** What rules 1 to 7 of spec 8 measure, against the window: [left, top, width, height] each, null when not there. */
async function measure(page: Page): Promise<Measured> {
	return page.evaluate(() => {
		const box = (node: Element | null): Box | null => {
			if (!node) return null;
			const r = node.getBoundingClientRect();
			return [r.left, r.top, r.width, r.height];
		};
		const one = (selector: string) => document.querySelector(selector);
		const fits = (node: Element | null) => !node || node.scrollWidth <= node.clientWidth;
		const phone = matchMedia('(max-width: 760px)').matches;
		const fill = one('.dl .bato-line-bar > span');
		const text = one('.dl .bato-note-text');
		return {
			button: box(one('.dl .split > .btn')),
			room: box(one('.dl .bato-line'))!,
			bold: box(one('.dl .bato-line .bato-bold')),
			plain: box(one('.dl .bato-line .bato-plain')),
			boldFits: fits(one('.dl .bato-line .bato-bold')),
			plainFits: fits(one('.dl .bato-line .bato-plain')),
			system: box(one('.dl .bato-line .bato-system')),
			slots: [...document.querySelectorAll('.dl .bato-slot')].map((node) => box(node)!),
			bar: box(one('.dl .bato-line-bar')),
			fill: fill ? fill.getBoundingClientRect().width : null,
			note: box(one('.dl .bato-note')),
			noteClass: one('.dl .bato-note')?.className ?? null,
			noteText: box(text),
			noteTextFits: !text || text.scrollHeight <= text.clientHeight,
			noteParts: [...document.querySelectorAll('.dl .bato-note .bato-acts .btn, .dl .bato-note .tip-btn')].map((node) => box(node)!),
			under: (phone ? ['.dl .bato-quiet', '.about-grid'] : ['.dl-list .tabs', '.dl-list .file']).flatMap((selector) => {
				const found = box(one(selector));
				return found ? [found] : [];
			}),
			block: box(one('.dl .dl-top'))!
		};
	});
}

const near = (a: number[], b: number[], what = '') => a.forEach((n, i) => expect(Math.abs(n - b[i]), `${what} [${a}] against [${b}]`).toBeLessThanOrEqual(0.5));
const middle = (b: Box) => b[1] + b[3] / 2;

const BIG = 999 * GB; // "999 GB": the widest size formatSize writes below 1000 GB
const OLD = '2026-09-30T12:00:00Z'; // "30 September"
const ON = { onBox: 'canvas', version: '1.0', sentAt: OLD } as const; // on the box by Canvas

/** A send as plan.test.ts has one: copying, step 1 of 3. */
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

/** A game's state on the box: 999 GB, a Windows game, the box on and looked at just now. */
function game(over: Partial<GameOnBox> = {}): GameOnBox {
	return {
		can: true,
		system: 'windows',
		size: BIG,
		onBox: 'no',
		version: null,
		sentAt: null,
		newer: false,
		marked: false,
		job: null,
		countdown: null,
		play: null,
		box: 'up',
		checkedAt: new Date().toISOString(),
		...over
	};
}
const done = (): JobView => job({ state: 'done', overall: 1, endedAt: new Date().toISOString() });
const failed = (reason: FailReason | null): JobView => job({ state: 'failed', reason, endedAt: new Date().toISOString() });

/** The rows of spec table 5.4 a page is answered in, by their number. */
const ROWS: Record<number, () => GameOnBox> = {
	1: () => game({}),
	2: () => game({ box: 'down' }),
	4: () => game({ box: 'unknown', checkedAt: null }),
	5: () => game({ job: job({ state: 'waiting', ahead: 12 }) }),
	6: () => game({ job: job({ step: 'copy', stepNumber: 1, overall: 0.12, minutesLeft: null, waking: 'waking' }) }),
	7: () => game({ job: job({ step: 'unpack', stepNumber: 2, overall: 1, minutesLeft: 120, waking: 'awake' }) }),
	8: () => game({ job: job({ step: 'copy', stepNumber: 1, overall: 0.5, minutesLeft: null, waitingForBox: true, waking: 'waking' }) }),
	9: () => game({ job: job({ step: 'copy', stepNumber: 1, overall: 0.55, minutesLeft: 120 }) }),
	10: () => game({ job: job({ step: 'reload', stepNumber: 3, overall: 0.99, minutesLeft: 1 }) }),
	11: () => game({ ...ON, job: done() }),
	12: () => game({ ...ON, job: { ...done(), listLater: true } }),
	13: () => game({ ...ON, job: done(), countdown: 600 }),
	15: () => game(ON),
	16: () => game({ ...ON, newer: true }),
	17: () => game({ onBox: 'hand' }),
	20: () => game({ ...ON, play: { state: 'waking' } }),
	21: () => game({ ...ON, play: { state: 'started' } }),
	23: () => game({ ...ON, play: { state: 'box-down' } }),
	24: () => game({ ...ON, play: { state: 'no-screen' } }),
	25: () => game({ ...ON, box: 'down' }),
	26: () => game({ play: { state: 'gone' } }),
	27: () => game({ job: failed({ code: 'box-room', free: BIG, need: BIG }) }),
	28: () => game({ ...ON, job: failed({ code: 'box-room', free: BIG, need: BIG }) }),
	29: () => game({ ...ON, job: failed({ code: 'box-room', free: BIG, need: BIG }), countdown: 600 }),
	30: () => game({ ...ON, marked: true }), // unlocked only
	31: () => game({ ...ON, marked: true }) // locked only; on a phone it is row 32
};

/** What the line says in each row, bold and plain, with the longest values of section 5 (rule 11). */
const NOT_THERE = ['Windows version, 999 GB', 'Not on Batocera yet.'];
const SENT = ['On Batocera', 'Sent on 30 September.'];
const WORDS: Record<number, string[]> = {
	1: NOT_THERE,
	2: NOT_THERE,
	4: NOT_THERE,
	5: ['Waiting to be sent', '12 other games are being sent first.'],
	6: ['Copying to Batocera, 1 of 3', '12 %'],
	7: ['Unpacking on Batocera, 2 of 3', '100 % · about 120 minutes left'],
	8: ['Waiting for Batocera, 1 of 3', 'Batocera is waking up'],
	9: ['Copying to Batocera, 1 of 3', '55 % · about 120 minutes left'],
	10: ["Reloading Batocera's list, 3 of 3", '99 %'],
	11: SENT,
	12: SENT,
	13: SENT,
	15: SENT,
	16: SENT,
	17: ['On Batocera', 'Put there by hand.'],
	20: ['On Batocera', 'Waking Batocera to play…'],
	21: ['On Batocera', 'Started. Pick up the remote.'],
	23: SENT,
	24: SENT,
	25: SENT,
	26: NOT_THERE,
	27: ['Windows version, 999 GB', 'The send stopped.'],
	28: SENT,
	29: SENT,
	30: ["Doesn't run on Batocera", 'Hidden for everyone else.'],
	31: ["Doesn't run on Batocera", 'It was tried on the box and marked in Canvas.']
};
/** The whole send of each row with a bar. */
const OVERALL: Record<number, number> = { 6: 0.12, 7: 1, 8: 0.5, 9: 0.55, 10: 0.99 };
/** The rows whose line has the flag, with the settings unlocked: the game is on the box, or marked. */
const FLAGGED = [11, 12, 13, 15, 16, 17, 20, 21, 23, 24, 25, 28, 29, 30];

/** The rows with a note, with the button on Batocera: N1, N2, N5, N4, N6 and N7 three times. The bad ones of them. */
const NOTED = [13, 16, 23, 24, 26, 27, 28, 29];
const BAD = [23, 24, 26, 27, 28, 29];

/** The rows a browser shows: row 30 only unlocked, row 31 only locked. */
const rowsFor = (unlocked: boolean) => Object.keys(ROWS).map(Number).filter((row) => row !== (unlocked ? 31 : 30));

/**
 * Opens game `id` in the state of `row`, answered by `make`, on a computer with the button turned to Batocera (row
 * 31 cannot be), and waits until the line says it.
 */
async function show(page: Page, row: number, phone: boolean, make = ROWS[row], id = '3003'): Promise<void> {
	await answer(page, id, make);
	await open(page, id);
	if (!phone && row !== 31) await pickBatocera(page);
	if (!phone && row === 31) {
		await expect(room(page)).toHaveClass(/is-system/);
		return;
	}
	await expect(bold(page)).toHaveText(WORDS[row][0]);
	await expect(plain(page)).toHaveText(WORDS[row][1]);
}

/** Rule 3: each of the two lines one line high, with no ellipsis. */
function oneLineEach(m: Measured, what: string): void {
	expect(Math.abs(m.bold![3] - 21.7), `${what}: the bold line's height ${m.bold![3]}`).toBeLessThanOrEqual(0.5);
	expect(Math.abs(m.plain![3] - 19.6), `${what}: the plain line's height ${m.plain![3]}`).toBeLessThanOrEqual(0.5);
	expect(m.boldFits, `${what}: the bold line fits`).toBe(true);
	expect(m.plainFits, `${what}: the plain line fits`).toBe(true);
}

/**
 * Rules 1 to 4 against a state measured before: the button, the room and the slots in place, the lines one line
 * each; and rule 7 when both have a note or neither has: what lies under the note in place.
 */
function holds(m: Measured, before: Measured, what: string, phone = false): void {
	near(m.button!, before.button!, `${what}: the button`);
	near(m.room, before.room, `${what}: the room`);
	expect(m.slots, `${what}: the slots`).toHaveLength(2);
	m.slots.forEach((slot, i) => near(slot, before.slots[i], `${what}: slot ${i + 1}`));
	oneLineEach(m, what);
	if (!phone) expect(Math.abs((m.bold![1] + m.plain![1] + m.plain![3]) / 2 - middle(m.button!)), `${what}: the lines' middle`).toBeLessThanOrEqual(0.5);
	if ((m.note === null) === (before.note === null)) {
		expect(m.under, `${what}: what lies under the note`).toHaveLength(2);
		near(m.under.flat(), before.under.flat(), `${what}: what lies under the note`);
	}
}

/** The note's height (spec 4): 12 px above and under two lines of 14 px; on a phone the buttons' row of 40 px under them, 10 px apart. */
const NOTE_HEIGHT = { computer: 24 + 2 * 1.45 * 14, phone: 24 + 2 * 1.45 * 14 + 10 + 40 };

/**
 * Rule 6: the note in its one shape, one height per size, `min(560px, 100%)` wide, its text at most two lines and
 * cut by nothing, its buttons and its "i" inside it; plain or bad, never the yellow kind.
 */
function oneShape(m: Measured, what: string, phone: boolean): void {
	const [left, top, width, height] = m.note!;
	expect(Math.abs(height - NOTE_HEIGHT[phone ? 'phone' : 'computer']), `${what}: the note's height ${height}`).toBeLessThanOrEqual(0.5);
	expect(Math.abs(width - Math.min(560, m.block[2])), `${what}: the note's width ${width}`).toBeLessThanOrEqual(0.5);
	expect(m.noteText![3], `${what}: the note's text in two lines at most`).toBeLessThanOrEqual(2 * 1.45 * 14 + 0.5);
	expect(m.noteTextFits, `${what}: the note's text cut by nothing`).toBe(true);
	expect(m.noteClass, what).not.toMatch(/\bnotice-done\b/);
	for (const [l, t, w, h] of m.noteParts) {
		expect(l >= left - 0.5 && t >= top - 0.5 && l + w <= left + width + 0.5 && t + h <= top + height + 0.5, `${what}: a button inside the note`).toBe(true);
	}
}

/** Rule 7: what lies under the note, the same in every state without a note, and in every state with one. */
function inPlace(m: Measured, seen: { none?: Box[]; note?: Box[] }, what: string): void {
	const group = m.note ? 'note' : 'none';
	expect(m.under, `${what}: what lies under the note`).toHaveLength(2);
	seen[group] ??= m.under;
	near(m.under.flat(), seen[group].flat(), `${what}: what lies under the note`);
}

/** The tooltip's box lies inside the window. */
async function inWindow(tip: Locator): Promise<void> {
	const inside = await tip.evaluate((node) => {
		const r = node.getBoundingClientRect();
		return r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight;
	});
	expect(inside, 'the tooltip lies inside the window').toBe(true);
}

/** What holds an icon button and its tooltip: its classes say whether the tooltip is open, and whether below the icon. */
const wrapOf = (button: Locator) => button.locator('xpath=..');

/** An answer held back until the test lets it go, whether the page asked already or not. */
function gate(): { passed: Promise<void>; letGo: () => void } {
	let letGo = () => {};
	const passed = new Promise<void>((resolve) => (letGo = resolve));
	return { passed, letGo };
}

/** N7's own "i", first in its row of buttons. */
const noteInfo = (page: Page) => note(page).getByRole('button', { name: 'More about this' });

/** N7's text, its "i" and "Try again", against the window. */
function partsOfN7(page: Page): Promise<DOMRect[]> {
	return Promise.all(
		[note(page).locator('.bato-note-text'), noteInfo(page), note(page).getByRole('button', { name: 'Try again' })].map((part) =>
			part.evaluate((node) => node.getBoundingClientRect().toJSON() as DOMRect)
		)
	);
}
const level = (r: DOMRect) => r.top + r.height / 2;

/** N7's bold sentence for each reason of spec 5.3, with "999 GB". */
const REASONS: [FailReason | null, string][] = [
	[{ code: 'box-down' }, 'Batocera does not answer.'],
	[{ code: 'box-room', free: BIG, need: BIG }, 'Batocera has no room to unpack it.'],
	[{ code: 'fetch' }, 'The installer could not be fetched from vangogh.'],
	[{ code: 'checksum' }, 'A file from vangogh was damaged on the way.'],
	[{ code: 'unpack' }, 'This installer could not be unpacked.'],
	[{ code: 'unrar' }, 'This installer needs RAR support.'],
	[{ code: 'copy' }, 'The copy to Batocera broke off.'],
	[{ code: 'in-the-way', path: '/userdata/roms/windows/Cellar Quest.pc' }, 'A folder is in the way on Batocera.'],
	[{ code: 'key-changed' }, "Batocera's key has changed."],
	[{ code: 'login' }, 'Batocera refused the login.'],
	[null, 'The reason is not known.']
];

/**
 * Rule 6 for every note with its longest values: N7 of each reason as a failed send and as a failed update, with
 * "Keep it on", whose buttons leave the text its narrowest room on a computer; then N2 to N6, and a start that did
 * not happen.
 */
async function fitsEveryNote(page: Page, phone: boolean): Promise<void> {
	const seen = async (words: string, what: string) => {
		await expect(note(page).locator('strong'), what).toHaveText(words);
		oneShape(await measure(page), what, phone);
	};
	for (const [reason, words] of REASONS) {
		for (const older of [false, true]) {
			const what = `N7, ${reason?.code ?? 'not known'}, ${older ? 'a failed update' : 'a failed send'}`;
			// It shows whatever the button is on.
			await answer(page, '3003', () => game({ ...(older ? ON : {}), job: failed(reason), countdown: 600 }));
			await open(page, '3003');
			await expect(note(page).getByRole('button', { name: 'Keep it on' }), what).toBeVisible();
			await seen(words, what);
		}
	}
	for (const [row, words] of [
		[16, 'vangogh has a newer version.'],
		[23, 'Batocera does not answer.'],
		[24, 'Batocera sees no screen.'],
		[26, 'The game is no longer on Batocera.']
	] as const) {
		await show(page, row, phone);
		await seen(words, `row ${row}`);
	}
	// N3: Play answered that another game runs on the TV.
	await page.route('**/api/batocera/games/3003/play', (route) =>
		route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'game-running', name: 'Other Game' }) })
	);
	await show(page, 15, phone);
	await mainButton(page).click();
	await seen('A game is running on the TV.', 'row 22');
	// Play answered that the game did not start on the TV: a bad note, and the button still Play.
	await page.unroute('**/api/batocera/games/3003/play');
	await page.route('**/api/batocera/games/3003/play', (route) =>
		route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'not-started' }) })
	);
	await show(page, 15, phone);
	await mainButton(page).click();
	await seen('The game did not start on the TV.', 'not started');
	await expect(note(page).locator('.bato-note-text')).toHaveText('The game did not start on the TV. Press Play again.');
	await expect(note(page)).toHaveClass(/\bnotice-bad\b/);
	await expect(mainButton(page)).toHaveAccessibleName('Play on the TV');
}

test.describe("a game's detail with Batocera", () => {
	test('holds the button, the room and its slots in every state, on a computer', async ({ page }) => {
		test.setTimeout(240_000);
		let first: Measured | null = null;
		let bar: Box | null = null;
		const under: { none?: Box[]; note?: Box[] } = {};
		for (const unlocked of [false, true]) {
			if (unlocked) await unlock(page.request);
			for (const row of rowsFor(unlocked)) {
				const what = `row ${row}, ${unlocked ? 'unlocked' : 'locked'}`;
				await show(page, row, false);
				const m = await measure(page);
				first ??= m;
				// Rule 1: the button; rule 2: the room, its top and height the button's.
				near(m.button!, first.button!, `${what}: the button`);
				near(m.room, first.room, `${what}: the room`);
				near([m.room[1], m.room[3]], [m.button![1], m.button![3]], `${what}: the room's top and height`);
				// Rule 6: a note in its one shape where the row has one, bad or plain; rule 7: what lies under it.
				expect(m.note !== null, `${what}: a note`).toBe(NOTED.includes(row));
				if (m.note) {
					oneShape(m, what, false);
					expect(/\bnotice-bad\b/.test(m.noteClass!), `${what}: a bad note`).toBe(BAD.includes(row));
				}
				inPlace(m, under, what);
				if (row === 31) {
					// The button on a system: the room holds the system's text, centred on the button.
					expect(Math.abs(middle(m.system!) - middle(m.button!)), `${what}: the system's text`).toBeLessThanOrEqual(0.5);
					continue;
				}
				// Rule 3: the two lines, their middle the button's.
				oneLineEach(m, what);
				expect(Math.abs((m.bold![1] + m.plain![1] + m.plain![3]) / 2 - middle(m.button!)), `${what}: the lines' middle`).toBeLessThanOrEqual(0.5);
				// Rule 4: the slots, whether their icons are there or not.
				expect(m.slots, what).toHaveLength(2);
				m.slots.forEach((slot, i) => near(slot, first!.slots[i], `${what}: slot ${i + 1}`));
				await expect(flagButton(page), what).toHaveCount(unlocked && FLAGGED.includes(row) ? 1 : 0);
				// Rule 5: the bar, the same through a send, inside the room, filled to the whole send.
				if (row in OVERALL) {
					bar ??= m.bar;
					near(m.bar!, bar!, `${what}: the bar`);
					const [left, top, width, height] = m.bar!;
					expect(left >= m.room[0] && top >= m.room[1] && left + width <= m.room[0] + m.room[2] && top + height <= m.room[1] + m.room[3], `${what}: the bar in the room`).toBe(true);
					expect(Math.abs(m.fill! - OVERALL[row] * width), `${what}: the fill`).toBeLessThanOrEqual(1);
				} else {
					expect(m.bar, `${what}: no bar`).toBeNull();
				}
				if (row === 9) await expect(room(page).getByRole('progressbar')).toHaveAttribute('aria-valuetext', '55 %, about 120 minutes left');
			}
		}
	});

	test('holds the line through Play and Keep it on', async ({ page }) => {
		// Row 13; "Keep it on" answered, and from then on the asks without the countdown, as the server would.
		let state = ROWS[13];
		// Answered first, so that the ask this test answers itself comes before the one that fails the test.
		await answer(page, '3003', () => state());
		await page.route('**/api/batocera/keep-on', (route) => {
			state = () => game({ ...ON, job: done() });
			return route.fulfill({ status: 204 });
		});
		await show(page, 13, false, () => state());
		await expect(note(page)).toContainText('Batocera shuts down in');
		const before = await measure(page);
		await note(page).getByRole('button', { name: 'Keep it on' }).click();
		// Row 14.
		await expect(note(page)).toHaveCount(0);
		await expect(tvButton(page)).toHaveAccessibleDescription('Batocera stays on.');
		// Without a note: what lies under it is held against this state, with a note against row 13.
		const bare = await measure(page);
		holds(bare, before, 'row 14');

		// Row 22: Play answered that another game runs on the TV.
		await page.route('**/api/batocera/games/3003/play', (route) =>
			route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'game-running', name: 'Other Game' }) })
		);
		await show(page, 15, false);
		await mainButton(page).click();
		await expect(note(page)).toContainText('A game is running on the TV.');
		await expect(mainButton(page)).not.toHaveClass(/btn-primary/);
		await expect(mainButton(page)).toBeEnabled();
		holds(await measure(page), before, 'row 22');

		// Row 19: "Close it and play", its answer held back.
		let held = gate();
		let plays = 0;
		await page.unroute('**/api/batocera/games/3003/play');
		await page.route('**/api/batocera/games/3003/play', async (route) => {
			plays++;
			await held.passed;
			await route.fulfill({ status: 200 });
		});
		await note(page).getByRole('button', { name: 'Close it and play' }).click();
		await expect(plain(page)).toHaveText('Closing the other game first…');
		await expect(note(page).getByRole('button', { name: 'Close it and play' })).toBeDisabled();
		await expect(note(page).getByRole('button', { name: 'Cancel' })).toBeDisabled();
		holds(await measure(page), before, 'row 19');
		held.letGo();
		await expect(plain(page)).toHaveText('Started. Pick up the remote.');

		// Row 18: Play, its answer held back.
		held = gate();
		plays = 0;
		await show(page, 15, false);
		await mainButton(page).click();
		await expect(mainButton(page)).toHaveAccessibleName('Starting…');
		await expect(plain(page)).toHaveText('Starting the game on the TV…');
		holds(await measure(page), bare, 'row 18');
		// While it waits, the button keeps the focus and a press of Enter, Space or the mouse asks nothing more.
		await mainButton(page).focus();
		await page.keyboard.press('Enter');
		await page.keyboard.press('Space');
		// It is only marked disabled: Playwright would wait for it to be enabled.
		await mainButton(page).click({ force: true });
		await expect(mainButton(page)).toBeFocused();
		held.letGo();
		await expect(plain(page)).toHaveText('Started. Pick up the remote.');
		expect(plays, 'the asks to play').toBe(1);
		await expect(mainButton(page)).toBeFocused();
	});

	test('keeps the room on every system the button is on', async ({ page }) => {
		await answer(page, '3003', ROWS[1]);
		await open(page, '3003');
		const block = page.locator('.dl');
		await expect(mainButton(page)).toHaveAccessibleName('Download for Windows');
		const windows = await measure(page);
		await block.getByRole('button', { name: 'Other systems and Batocera' }).click();
		await block.getByRole('menuitemradio', { name: /^macOS/ }).click();
		await expect(mainButton(page)).toHaveAccessibleName('Download for macOS');
		near((await measure(page)).room, windows.room, 'macOS');
		await pickBatocera(page);
		await expect(plain(page)).toHaveText('Not on Batocera yet.');
		near((await measure(page)).room, windows.room, 'Batocera');
	});

	test('gives a game in several files a room of three lines', async ({ page }) => {
		await answer(page, '3015', ROWS[1]);
		await open(page, '3015');
		await expect(mainButton(page)).toHaveAccessibleName('Download for Windows');
		const windows = await measure(page);
		expect(Math.abs(windows.room[3] - 60.9)).toBeLessThanOrEqual(0.5);
		expect(Math.abs(middle(windows.room) - middle(windows.button!))).toBeLessThanOrEqual(0.5);
		await pickBatocera(page);
		await expect(plain(page)).toHaveText('Not on Batocera yet.');
		const batocera = await measure(page);
		near(batocera.room, windows.room, 'the room on Batocera');
		near(batocera.button!, windows.button!, 'the button on Batocera');
		expect(Math.abs((batocera.bold![1] + batocera.plain![1] + batocera.plain![3]) / 2 - middle(batocera.button!))).toBeLessThanOrEqual(0.5);
	});

	test('shows the tooltips by pointing, focus and a tap, one at a time, and nothing moves', async ({ page, browser }) => {
		// The check after "On Batocera" is not read out: the words say it.
		await show(page, 11, false);
		await expect(bold(page).locator('.bato-check')).toHaveAttribute('aria-hidden', 'true');

		await unlock(page.request);
		await show(page, 15, false);
		const before = await measure(page);
		const tv = tvButton(page);
		const info = infoButton(page);
		const flag = flagButton(page);
		await expect(tv).toHaveAccessibleDescription('Batocera is on.');
		await expect(info).toHaveAccessibleDescription(`Version 1.0. ${HINT}`);
		await expect(flag).toHaveAccessibleName("Doesn't run? Mark it");
		await expect(tipOf(flag)).toHaveAttribute('aria-hidden', 'true');
		await expect(tipOf(flag)).toHaveText("Doesn't run? Mark it");
		const opens = async (button: Locator, what: string) => {
			await expect(wrapOf(button), what).toHaveClass(/is-open/);
			await expect(page.locator('.dl .tip.is-open'), what).toHaveCount(1);
			await expect(tipOf(button), what).toBeVisible();
			holds(await measure(page), before, what);
			await inWindow(tipOf(button));
		};

		// Pointing: one at a time, and the pointer on a tooltip keeps it.
		await tv.hover();
		await opens(tv, 'the TV pointed at');
		await info.hover();
		await opens(info, 'the "i" pointed at');
		await expect(wrapOf(tv)).not.toHaveClass(/is-open/);
		await tipOf(info).hover();
		await opens(info, 'the "i"\'s tooltip pointed at');
		await page.mouse.move(1, 1);
		await expect(page.locator('.dl .tip.is-open')).toHaveCount(0);

		// The keyboard, in the order they are seen: the TV, the flag, the "i".
		await page.locator('.dl .split-more').focus();
		await page.keyboard.press('Tab');
		await expect(tv).toBeFocused();
		await opens(tv, 'the TV focused');
		await page.keyboard.press('Tab');
		await expect(flag).toBeFocused();
		await opens(flag, 'the flag focused');
		await page.keyboard.press('Tab');
		await expect(info).toBeFocused();
		await opens(info, 'the "i" focused');

		// A finger.
		const phone = await browser.newContext({ baseURL: BASE, ...PHONE });
		try {
			const small = await phone.newPage();
			// The sign of a marked game on a locked phone is not read out: the words say it.
			await show(small, 31, true);
			await expect(room(small).locator('.bato-prohibit')).toHaveAttribute('aria-hidden', 'true');

			await unlock(phone.request);
			let state = ROWS[15];
			await show(small, 15, true, () => state());
			const was = await measure(small);
			const tapped = async (button: Locator | null, what: string) => {
				await expect(small.locator('.dl .tip.is-open'), what).toHaveCount(button ? 1 : 0);
				if (button) {
					await expect(wrapOf(button), what).toHaveClass(/is-open/);
					await inWindow(tipOf(button));
				}
				holds(await measure(small), was, what, true);
			};
			await tvButton(small).tap();
			await tapped(tvButton(small), 'the TV tapped');
			await tvButton(small).tap();
			await tapped(null, 'the TV tapped again');
			await tvButton(small).tap();
			await infoButton(small).tap();
			await tapped(infoButton(small), 'the "i" tapped while the TV\'s shows');
			await small.locator('h1.detail-title').tap();
			await tapped(null, 'the title tapped');

			// The flag acts at once and shows no tooltip.
			await small.route('**/api/batocera/marks/3003', (route) => {
				expect(route.request().method()).toBe('PUT');
				state = ROWS[30];
				return route.fulfill({ status: 204 });
			});
			await flagButton(small).tap();
			await expect(bold(small)).toHaveText("Doesn't run on Batocera");
			await expect(flagButton(small)).toHaveAccessibleName('Take the mark back');
			await expect(small.locator('.dl .tip.is-open')).toHaveCount(0);
		} finally {
			await phone.close();
		}
	});

	test('changes at once with reduced motion', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await show(page, 9, false);
		expect(await room(page).locator('.bato-line-bar > span').evaluate((node) => getComputedStyle(node).transitionDuration)).toBe('0s');
		await tvButton(page).hover();
		await expect(wrapOf(tvButton(page))).toHaveClass(/is-open/);
		expect(await tipOf(tvButton(page)).evaluate((node) => getComputedStyle(node).transitionDuration)).toBe('0s');
	});

	test('says a new step, not a new percentage', async ({ page }) => {
		let state = ROWS[9];
		await show(page, 9, false, () => state());
		const said = room(page).locator('.bato-said');
		await expect(said).toHaveAttribute('aria-live', 'polite');
		await expect(said).toHaveText('');
		// The next answer, two seconds on: only the percentage changed.
		state = () => game({ job: job({ step: 'copy', stepNumber: 1, overall: 0.56, minutesLeft: 120 }) });
		await expect(plain(page)).toHaveText(/^56 %/);
		await expect(said).toHaveText('');
		// A new step.
		state = ROWS[10];
		await expect(bold(page)).toHaveText("Reloading Batocera's list, 3 of 3");
		await expect(said).toHaveText("Reloading Batocera's list, 3 of 3.");
		// The button on a system: a new state is not said, nor when the button comes back to Batocera. Rows 9 and 10 read
		// the same in the menu ("Sending"); row 11 reads "On Batocera" there, so its arrival can be seen.
		const block = page.locator('.dl');
		await block.getByRole('button', { name: 'Other systems and Batocera' }).click();
		await block.getByRole('menuitemradio', { name: /^Windows/ }).click();
		await expect(mainButton(page)).toHaveAccessibleName('Download for Windows');
		state = ROWS[11];
		await block.getByRole('button', { name: 'Other systems and Batocera' }).click();
		const row = block.getByRole('menuitemradio', { name: 'Batocera' });
		await expect(row.locator('.n .on')).toHaveText('On Batocera');
		await expect(said).toHaveText("Reloading Batocera's list, 3 of 3.");
		await row.click();
		await expect(bold(page)).toHaveText('On Batocera');
		await expect(said).toHaveText("Reloading Batocera's list, 3 of 3.");
	});

	test('closes a tooltip with Escape before the detail', async ({ page }) => {
		const dialog = page.locator('dialog.detail');
		await show(page, 15, false);
		// Focused by the keyboard.
		await page.locator('.dl .split-more').focus();
		await page.keyboard.press('Tab');
		await expect(tvButton(page)).toBeFocused();
		await expect(wrapOf(tvButton(page))).toHaveClass(/is-open/);
		await page.keyboard.press('Escape');
		await expect(wrapOf(tvButton(page))).not.toHaveClass(/is-open/);
		await expect(dialog).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();

		// Tapped: a click is a tap.
		await show(page, 15, false);
		await infoButton(page).click();
		await expect(wrapOf(infoButton(page))).toHaveClass(/is-open/);
		await page.keyboard.press('Escape');
		await expect(wrapOf(infoButton(page))).not.toHaveClass(/is-open/);
		await expect(dialog).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();

		// The switch's menu open: Esc closes the menu and nothing more.
		await show(page, 15, false);
		const block = page.locator('.dl');
		await block.getByRole('button', { name: 'Other systems and Batocera' }).click();
		await expect(block.getByRole('menu')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(block.getByRole('menu')).toHaveCount(0);
		await expect(dialog).toBeVisible();
		await expect(page.locator('.dl .tip.is-open')).toHaveCount(0);
	});

	test('puts the room under the button in a window of 1024 px', async ({ page }) => {
		await page.setViewportSize({ width: 1024, height: 768 });
		await unlock(page.request);
		let first: Measured | null = null;
		for (const row of [1, 9, 15, 30]) {
			const what = `row ${row}`;
			await show(page, row, false);
			const m = await measure(page);
			first ??= m;
			expect(m.room[1], `${what}: the room under the button`).toBeGreaterThanOrEqual(m.button![1] + m.button![3]);
			expect(Math.abs(m.room[2] - 380), `${what}: the room's width`).toBeLessThanOrEqual(0.5);
			near(m.button!, first.button!, `${what}: the button`);
			near(m.room, first.room, `${what}: the room`);
			expect(m.slots, what).toHaveLength(2);
			m.slots.forEach((slot, i) => near(slot, first!.slots[i], `${what}: slot ${i + 1}`));
		}
	});

	test("keeps the system's text inside the room in a window of 700 px", async ({ page }) => {
		await page.setViewportSize({ width: 700, height: 900 });
		await answer(page, '3015', ROWS[1]);
		await open(page, '3015');
		await expect(mainButton(page)).toHaveAccessibleName('Download for Windows');
		const windows = await measure(page);
		const [left, top, width, height] = windows.system!;
		expect(left >= windows.room[0] && top >= windows.room[1] && left + width <= windows.room[0] + windows.room[2] && top + height <= windows.room[1] + windows.room[3]).toBe(true);
		await pickBatocera(page);
		await expect(plain(page)).toHaveText('Not on Batocera yet.');
		near((await measure(page)).room, windows.room, 'the room on Batocera');
	});

	test('fits every note in two lines', async ({ page }) => {
		test.setTimeout(120_000);
		await fitsEveryNote(page, false);
	});

	test('keeps the file list in place on a game with a long head, but for one amount', async ({ page }) => {
		// 3014's title takes two lines and its makers a line under it, as a real game's head (rule 10).
		const tabs: { none?: Box; note?: Box } = {};
		for (const row of [1, 9, 15, 13, 16, 23, 27]) {
			const what = `row ${row}`;
			await show(page, row, false, ROWS[row], '3014');
			if (row === 1) {
				const title = page.locator('h1.detail-title');
				const lines = await title.evaluate((node) => node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight));
				expect(Math.round(lines), 'the title in two lines').toBe(2);
				await expect(page.locator('.detail-makers')).toBeVisible();
			}
			const m = await measure(page);
			expect(m.note !== null, `${what}: a note`).toBe(NOTED.includes(row));
			const group = m.note ? 'note' : 'none';
			tabs[group] ??= m.under[0];
			near(m.under[0], tabs[group], `${what}: the file list's tabs`);
		}
	});

	test('places N7\'s "i" before its buttons', async ({ page }) => {
		await show(page, 29, false);
		const [text, info, retry] = await partsOfN7(page);
		// Between the text and the buttons, in their row.
		expect(info.left, 'right of the text').toBeGreaterThanOrEqual(text.right);
		expect(info.right, 'left of "Try again"').toBeLessThanOrEqual(retry.left);
		expect(Math.abs(level(info) - level(retry)), 'level with "Try again"').toBeLessThanOrEqual(0.5);
		expect(Math.abs(level(info) - level(text)), 'level with the text').toBeLessThanOrEqual(0.5);
		await expect(noteInfo(page)).toHaveAccessibleDescription('Batocera has 999 GB free, and the send needs 999 GB while it unpacks. The older version stays.');
		// Its tooltip lies inside the window and moves nothing.
		const before = await measure(page);
		await noteInfo(page).hover();
		await expect(wrapOf(noteInfo(page))).toHaveClass(/is-open/);
		await inWindow(tipOf(noteInfo(page)));
		holds(await measure(page), before, 'the note\'s "i" pointed at');
	});

	test('reads a note once, and the countdown as it came', async ({ page }) => {
		const status = page.locator('.dl .bato-note-said[role="status"]');
		const alert = page.locator('.dl .bato-note-said[role="alert"]');
		const n1 = 'Batocera shuts down in 10:00. Canvas woke it for this send.';
		// Row 13, its countdown going down from the first answer on, as the server's.
		let from: number | null = null;
		await show(page, 13, false, () => {
			const start = (from ??= Date.now());
			return game({ ...ON, job: done(), countdown: 600 - Math.floor((Date.now() - start) / 1000) });
		});
		await expect(status).toHaveText(n1);
		await expect(alert).toHaveText('');
		// The clock ticks on in the note; the region keeps it as it came.
		await expect(note(page).locator('strong')).toHaveText(/^Batocera shuts down in 9:(5[0-8]|[0-4]\d)\.$/);
		await expect(status).toHaveText(n1);

		// Row 27, answered next while the countdown runs: a bad note at once, and the plain one gone.
		await answer(page, '3003', ROWS[27]);
		await expect(alert).toHaveText('Batocera has no room to unpack it. 999 GB free, 999 GB needed.');
		await expect(status).toHaveText('');

		// Row 15: no note, nothing said.
		await show(page, 15, false);
		await expect(status).toHaveText('');
		await expect(alert).toHaveText('');

		// Play brings N3: said politely, and the focus stays on the main button.
		await page.route('**/api/batocera/games/3003/play', (route) =>
			route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'game-running', name: 'Other Game' }) })
		);
		await mainButton(page).focus();
		await page.keyboard.press('Enter');
		await expect(note(page)).toContainText('A game is running on the TV.');
		await expect(status).toHaveText('A game is running on the TV. Close it and start this one?');
		await expect(alert).toHaveText('');
		await expect(mainButton(page)).toBeFocused();
		// "Cancel": the note goes, and both are emptied.
		await note(page).getByRole('button', { name: 'Cancel' }).click();
		await expect(note(page)).toHaveCount(0);
		await expect(status).toHaveText('');
		await expect(alert).toHaveText('');
	});
});

test.describe("a game's detail with Batocera on a phone", () => {
	test.use(PHONE);

	test('holds the button, the room and its slots in every state, on a phone', async ({ page }) => {
		test.setTimeout(240_000);
		let first: Measured | null = null;
		let bar: Box | null = null;
		const under: { none?: Box[]; note?: Box[] } = {};
		for (const unlocked of [false, true]) {
			if (unlocked) await unlock(page.request);
			for (const row of rowsFor(unlocked)) {
				const what = `row ${row === 31 ? 32 : row}, ${unlocked ? 'unlocked' : 'locked'}`;
				await show(page, row, true);
				const m = await measure(page);
				// Rule 6, and unlocked rule 11 for the notes, with "999 GB" and "10:00".
				expect(m.note !== null, `${what}: a note`).toBe(NOTED.includes(row));
				if (m.note) {
					oneShape(m, what, true);
					expect(/\bnotice-bad\b/.test(m.noteClass!), `${what}: a bad note`).toBe(BAD.includes(row));
				}
				if (row === 31) {
					// Row 32: no button, the room where it would be, the sign in the TV's place and no slots. What lies
					// under the room stands higher by the button's room: in this browser the game is never in another row.
					expect(m.button, what).toBeNull();
					near([m.room[1]], [m.block[1]], `${what}: the room at the block's top`);
					near([m.room[0], m.room[2], m.room[3]], [first!.room[0], first!.room[2], first!.room[3]], `${what}: the room's size`);
					await expect(room(page).locator('.bato-prohibit')).toHaveCount(1);
					expect(m.slots, what).toHaveLength(0);
					oneLineEach(m, what);
					continue;
				}
				first ??= m;
				// Rule 7: what lies under the note.
				inPlace(m, under, what);
				// Rules 1 and 2: the button and the room, 12 px under it, the block's width.
				near(m.button!, first.button!, `${what}: the button`);
				near(m.room, first.room, `${what}: the room`);
				near([m.room[1], m.room[2]], [m.button![1] + m.button![3] + 12, m.block[2]], `${what}: the room under the button`);
				// Rule 3 in the narrowest room, the flag's (rule 11), and rule 4.
				oneLineEach(m, what);
				expect(m.slots, what).toHaveLength(2);
				m.slots.forEach((slot, i) => near(slot, first!.slots[i], `${what}: slot ${i + 1}`));
				await expect(flagButton(page), what).toHaveCount(unlocked && FLAGGED.includes(row) ? 1 : 0);
				if (row in OVERALL) {
					bar ??= m.bar;
					near(m.bar!, bar!, `${what}: the bar`);
					const [left, top, width, height] = m.bar!;
					expect(left >= m.room[0] && top >= m.room[1] && left + width <= m.room[0] + m.room[2] && top + height <= m.room[1] + m.room[3], `${what}: the bar in the room`).toBe(true);
					expect(Math.abs(m.fill! - OVERALL[row] * width), `${what}: the fill`).toBeLessThanOrEqual(1);
				} else {
					expect(m.bar, `${what}: no bar`).toBeNull();
				}
			}
		}
	});

	test('shows the note about installers as a quiet line', async ({ page }) => {
		await show(page, 1, true);
		const quiet = page.locator('.dl .bato-quiet');
		await expect(quiet).toHaveText('Installers are meant for a computer. Show the files anyway');
		await expect(page.getByText('Open Canvas on the computer you want to play on.')).toHaveCount(0);
		const style = await quiet.evaluate((node) => {
			const probe = document.createElement('i');
			probe.style.color = 'var(--starlight-faint)';
			document.body.append(probe);
			const faint = getComputedStyle(probe).color;
			probe.remove();
			return { size: getComputedStyle(node).fontSize, color: getComputedStyle(node).color, faint, icon: getComputedStyle(node.querySelector('.ic')!).color };
		});
		expect(style.size).toBe('13px');
		expect(style.color).toBe(style.faint);
		expect(style.icon).toBe(style.faint);
		const before = await measure(page);
		near([(await quiet.boundingBox())!.y], [before.room[1] + before.room[3] + 14], 'the line 14 px under the room');

		await quiet.getByRole('button', { name: 'Show the files anyway' }).click();
		await expect(page.locator('.dl-list .file').first()).toBeVisible();
		await expect(quiet).toHaveText('Installers are meant for a computer.');
		await expect(quiet.getByRole('button')).toHaveCount(0);
		const after = await measure(page);
		near(after.room, before.room, 'the room');
		near(after.button!, before.button!, 'the button');
	});

	test('keeps the lines of Play to one line each in the narrowest room', async ({ page }) => {
		// Unlocked, the flag is in the line: its text has the narrowest room, 221 px (rule 11).
		await unlock(page.request);
		await answer(page, '3003', ROWS[15]);
		// Play answered that another game runs on the TV, "Close it and play" that it started; each held back.
		let held = gate();
		await page.route('**/api/batocera/games/3003/play', async (route) => {
			await held.passed;
			if ((route.request().postDataJSON() as { closeRunning: boolean }).closeRunning) return route.fulfill({ status: 200 });
			return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'game-running', name: 'Other Game' }) });
		});
		await show(page, 15, true);
		await expect(flagButton(page)).toHaveCount(1);
		const narrowest = (m: Measured, what: string) => {
			expect(Math.abs(m.bold![2] - 221), `${what}: the room of the text`).toBeLessThanOrEqual(0.5);
			oneLineEach(m, what);
		};
		// Row 18.
		await mainButton(page).click();
		await expect(plain(page)).toHaveText('Starting the game on the TV…');
		narrowest(await measure(page), 'row 18');
		held.letGo();
		await expect(note(page)).toContainText('A game is running on the TV.');
		// Row 19.
		held = gate();
		await note(page).getByRole('button', { name: 'Close it and play' }).click();
		await expect(plain(page)).toHaveText('Closing the other game first…');
		narrowest(await measure(page), 'row 19');
		held.letGo();
		await expect(plain(page)).toHaveText('Started. Pick up the remote.');
		narrowest(await measure(page), 'row 21');
	});

	test('says nothing at the first draw', async ({ page }) => {
		// The button is on Batocera from the start: the server's first answer is part of the first draw.
		await show(page, 9, true);
		await expect(room(page).locator('.bato-said')).toHaveText('');
	});

	test('says Turn Batocera on to send with waking off', async ({ page, playwright }) => {
		const api = await playwright.request.newContext({ baseURL: BASE });
		// The settings of setup.ts, with waking on or off.
		const save = (wake: boolean) =>
			api.put('/api/settings', {
				data: {
					defaults: { os: [], sort: 'title', grouped: false, hide18: false },
					theo: false,
					preferred: 'auto',
					batocera: { on: true, address: '127.0.0.1', user: 'root', wake, shutdown: true }
				}
			});
		try {
			await unlock(api);
			expect((await save(false)).status()).toBe(200);
			await answer(page, '3003', () => game({ box: 'down' }));
			await open(page, '3003');
			await expect(plain(page)).toHaveText('Turn Batocera on to send.');
			await expect(tvButton(page)).toHaveAccessibleDescription('Batocera does not answer.');
			oneLineEach(await measure(page), 'row 3');
		} finally {
			expect((await save(true)).status()).toBe(200);
			await api.dispose();
		}
	});

	test('reaches 44 px with a finger', async ({ page }) => {
		await unlock(page.request);
		await show(page, 15, true);
		for (const [what, button] of [
			['the TV', tvButton(page)],
			['the flag', flagButton(page)],
			['the "i"', infoButton(page)]
		] as const) {
			const { width, height } = await reach(page, button);
			expect(width, what).toBeGreaterThanOrEqual(44);
			expect(height, what).toBeGreaterThanOrEqual(44);
		}
	});

	test('opens a tooltip below its icon near the window\'s top', async ({ page }) => {
		// 3016 has a description as long as a real game's: its detail scrolls the line up to the window's top.
		await answer(page, '3016', ROWS[15]);
		await open(page, '3016');
		await expect(plain(page)).toHaveText('Sent on 30 September.');
		// The detail scrolled until the "i"'s icon is just under the sheet's close button, which stays at its top right.
		const under = (await page.locator('.detail-close').evaluate((node) => node.getBoundingClientRect().bottom)) + 1;
		const info = infoButton(page);
		await info.evaluate((node, top) => {
			const sheet = node.closest('dialog')!;
			sheet.scrollTop += node.getBoundingClientRect().top - top;
		}, under);
		await expect.poll(() => info.evaluate((node) => Math.round(node.getBoundingClientRect().top))).toBe(Math.round(under));
		// What a finger touches at the icon's middle is the "i".
		const touched = await info.evaluate((node) => {
			const r = node.getBoundingClientRect();
			const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
			return !!at && node.contains(at);
		});
		expect(touched, 'the "i" under a finger at its middle').toBe(true);
		// The "i"'s three lines have no room above it: below. The TV's one line has: above, as everywhere else.
		for (const [what, button, below] of [
			['the "i"', info, true],
			['the TV', tvButton(page), false]
		] as const) {
			await button.tap();
			await expect(wrapOf(button), what).toHaveClass(/is-open/);
			if (below) await expect(wrapOf(button), what).toHaveClass(/is-below/);
			else await expect(wrapOf(button), what).not.toHaveClass(/is-below/);
			const [icon, tip] = await Promise.all([button, tipOf(button)].map((node) => node.evaluate((n) => n.getBoundingClientRect().toJSON() as DOMRect)));
			if (below) expect(tip.top, `${what}: below its icon`).toBeGreaterThan(icon.bottom);
			else expect(tip.bottom, `${what}: above its icon`).toBeLessThan(icon.top);
			await inWindow(tipOf(button));
		}
	});

	test('fits every note in two lines', async ({ page }) => {
		test.setTimeout(120_000);
		await fitsEveryNote(page, true);
	});

	test('places N7\'s "i" before its buttons', async ({ page }) => {
		await show(page, 29, true);
		const [text, info, retry] = await partsOfN7(page);
		// Under the text, at the start of the buttons' row and before "Try again": the text keeps its width.
		expect(info.top, 'under the text').toBeGreaterThanOrEqual(text.bottom);
		expect(Math.abs(info.left - text.left), 'at the start of the row').toBeLessThanOrEqual(0.5);
		expect(info.right, 'left of "Try again"').toBeLessThanOrEqual(retry.left);
		expect(Math.abs(level(info) - level(retry)), 'level with "Try again"').toBeLessThanOrEqual(0.5);
		// Its tooltip lies inside the window and moves nothing.
		const before = await measure(page);
		await noteInfo(page).tap();
		await expect(wrapOf(noteInfo(page))).toHaveClass(/is-open/);
		await inWindow(tipOf(noteInfo(page)));
		holds(await measure(page), before, 'the note\'s "i" tapped', true);
	});
});
