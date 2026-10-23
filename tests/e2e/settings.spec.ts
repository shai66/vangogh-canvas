import type { Locator, Page } from '@playwright/test';
import { arrived, expect, place, test, titles, UA } from './helpers';

// One Canvas with a PIN, 2468 (setup.ts). Its settings are one for every browser: the tests run one at a time.
test.describe.configure({ mode: 'serial' });
test.use({ baseURL: process.env.CANVAS_SETTINGS_URL });

/** Opens the PIN prompt the way a visitor does: "Settings" in the foot, a plain click. Waits until it has arrived. */
async function openPrompt(page: Page): Promise<void> {
	await page.locator('.foot .settings-link').click();
	await expect(page.locator('dialog.pin')).toBeVisible();
	await page.locator('dialog.pin').evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)));
}

/** Unlocks with the right PIN, from the prompt, and waits until the settings sheet has arrived. */
async function unlock(page: Page): Promise<void> {
	await page.locator('dialog.pin input').fill('2468');
	await page.keyboard.press('Enter');
	await expect(page.locator('dialog.detail h1')).toHaveText('Settings');
	await arrived(page);
}

test.describe('the way into the settings', () => {
	test('opens the PIN prompt from the foot, over the list', async ({ page }) => {
		await page.goto('/');
		await openPrompt(page);
		await expect(page).toHaveURL(/\/settings$/);
		await expect(page).toHaveTitle('Settings | Canvas for vangogh');
		await expect(page.locator('dialog.pin')).toContainText('Settings are locked');
		await expect(page.locator('dialog.pin input')).toBeFocused();
		await expect(page.locator('dialog.detail')).toBeHidden();
		await page.keyboard.press('Escape');
		await expect(page.locator('dialog.pin')).toBeHidden();
		await expect(page).toHaveURL(/\/$/);
	});

	test('says when the PIN is wrong, and keeps its room', async ({ page }) => {
		await page.goto('/');
		await openPrompt(page);
		const field = page.locator('dialog.pin input');
		const error = page.locator('dialog.pin .pin-error');
		const before = await place(page, 'dialog.pin .pin-unlock');
		await field.fill('1111');
		await page.keyboard.press('Enter');
		await expect(error).toHaveText('That is not the PIN. Try again.');
		expect(await place(page, 'dialog.pin .pin-unlock')).toEqual(before);
		await expect(field).toHaveClass(/\bis-wrong\b/);
		expect(await field.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([0, 4]);
		await page.keyboard.type('2');
		await expect(error).toHaveText('');
		await expect(field).not.toHaveClass(/\bis-wrong\b/);
		await expect(field).toHaveValue('2');
	});

	test('says Canvas refused the PIN when it answers 403', async ({ page }) => {
		await page.goto('/');
		await openPrompt(page);
		const before = await place(page, 'dialog.pin .pin-unlock');
		await page.route('**/api/settings/unlock', (route) =>
			route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"cross-site"}' })
		);
		await page.locator('dialog.pin input').fill('2468');
		await page.keyboard.press('Enter');
		await expect(page.locator('dialog.pin .pin-error')).toHaveText('Canvas refused the request. See the README.');
		// The line keeps to its room: nothing moves.
		expect(await place(page, 'dialog.pin .pin-unlock')).toEqual(before);
		await expect(page.locator('dialog.detail')).toBeHidden();
	});

	test('unlocks with the right PIN, and stays unlocked', async ({ page }) => {
		await page.goto('/');
		await openPrompt(page);
		await unlock(page);
		await expect(page.locator('dialog.pin')).toBeHidden();
		await expect(page).toHaveURL(/\/settings$/);
		const until = page.locator('dialog.detail .settings-until');
		await expect(until).toHaveText(/^Unlocked in this browser until \d{1,2} [A-Z][a-z]+$/);
		await page.reload();
		await expect(page.locator('dialog.detail h1')).toHaveText('Settings');
		await expect(page.locator('dialog.pin')).toBeHidden();
	});

	// Review focus 1
	test('takes a PIN pasted with spaces around it', async ({ page, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await page.goto('/');
		await openPrompt(page);
		const field = page.locator('dialog.pin input');
		const paste = async (text: string) => {
			await page.evaluate((text) => navigator.clipboard.writeText(text), text);
			await field.press('ControlOrMeta+A');
			await field.press('ControlOrMeta+V');
		};
		// The longest PIN, with a space on each side, keeps every character.
		await paste(' 12345678 ');
		await expect(field).toHaveValue(' 12345678 ');
		await paste(' 2468 ');
		await expect(field).toHaveValue(' 2468 ');
		await page.keyboard.press('Enter');
		await expect(page.locator('dialog.detail h1')).toHaveText('Settings');
		await expect(page.locator('dialog.pin')).toBeHidden();
	});

	test('locks with Lock', async ({ page }) => {
		const lock = async () => {
			await page.locator('dialog.detail .settings-lock').click();
			await expect(page.locator('dialog.detail')).toBeHidden();
			await expect(page.locator('dialog.pin')).toBeHidden();
			await expect(page).toHaveURL(/\/$/);
			await openPrompt(page);
			await expect(page.locator('dialog.pin')).toContainText('Settings are locked');
			await expect(page.locator('dialog.pin')).toContainText('Enter the PIN to change how Canvas works for everyone at home.');
		};
		// The sheet opened over the list.
		await page.goto('/');
		await openPrompt(page);
		await unlock(page);
		await lock();
		// The sheet the server drew at /settings, unlocked: closing it leaves that page for the list's.
		await unlock(page);
		await page.reload();
		await expect(page.locator('dialog.detail h1')).toHaveText('Settings');
		await arrived(page);
		await lock();
	});
});

/** The settings sheet, once it is open. */
const sheet = (page: Page) => page.locator('dialog.detail');

/** The panel "How the library opens", while its tab is chosen. */
const opens = (page: Page) => sheet(page).getByRole('tabpanel', { name: 'Library' }).locator('.settings-panel');

/** A chip of the panel "How the library opens", by its words. */
const chip = (page: Page, name: string) => opens(page).getByRole('button', { name, exact: true });

/** The switch of the panel "theo". */
const theoSwitch = (page: Page) => sheet(page).getByRole('switch', { name: "Show the theo command in a game's detail" });

/** A tab of the sheet, by its name. */
const tab = (page: Page, name: string) => sheet(page).getByRole('tab', { name, exact: true });

/** Chooses a tab of the sheet with a click, and waits until it is chosen. */
async function choose(page: Page, name: string): Promise<void> {
	await tab(page, name).click();
	await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');
}

/** The panels of the chosen tab: the others are in the page too, hidden. */
const shownPanels = (page: Page) => sheet(page).getByRole('tabpanel').locator('.settings-panel');

/** Opens the sheet at its address, unlocked with the PIN once the prompt has arrived. */
async function openSheet(page: Page): Promise<void> {
	await page.goto('/settings');
	await expect(page.locator('dialog.pin')).toBeVisible();
	await page.locator('dialog.pin').evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)));
	await unlock(page);
}

/** Where each of these elements is and how large, to the tenth of a pixel. */
function rooms(page: Page, selector: string): Promise<number[][]> {
	return page.locator(selector).evaluateAll((nodes) =>
		nodes.map((node) => {
			const box = node.getBoundingClientRect();
			return [box.left, box.top, box.width, box.height].map((n) => Math.round(n * 10) / 10);
		})
	);
}

/** The tab row, each tab, the close button and the foot: what stays where it is, whatever the tab and the scroll. */
const IN_PLACE = ['.settings-tabs', '.settings-tabs [role="tab"]', '.detail-close', '.settings-foot'].map((part) => `dialog.detail ${part}`).join(', ');

/**
 * Each tab chosen in turn: the tab row, the tabs, the close button and the foot stay where they are, the foot at the
 * window's bottom, and the first panel's edges are where Library's are.
 */
async function keepsInPlace(page: Page): Promise<void> {
	await openSheet(page);
	/** The left, the top and the width of the first panel of the chosen tab. */
	const edges = () =>
		shownPanels(page)
			.first()
			.evaluate((node) => {
				const box = node.getBoundingClientRect();
				return [box.left, box.top, box.width].map((n) => Math.round(n * 10) / 10);
			});
	const before = await rooms(page, IN_PLACE);
	expect(before).toHaveLength(7);
	const panel = await edges();
	for (const name of ['Downloads', 'Batocera', 'Server', 'Library']) {
		await choose(page, name);
		expect(await rooms(page, IN_PLACE)).toEqual(before);
		expect(await edges()).toEqual(panel);
	}
	const [bottom, height] = await page
		.locator('dialog.detail .settings-foot')
		.evaluate((node) => [Math.round(node.getBoundingClientRect().bottom * 10) / 10, innerHeight]);
	expect(bottom).toBe(height);
}

/**
 * The Batocera tab scrolled down: the tab row is held at the window's top, with the sheet's night behind it. A tab chosen
 * then starts at its top, just under the tabs, and nothing moves.
 */
async function holdsTheTabs(page: Page): Promise<void> {
	await openSheet(page);
	const row = sheet(page).locator('.settings-tabs');
	const background = () => row.evaluate((node) => getComputedStyle(node).backgroundColor);
	await choose(page, 'Batocera');
	// At rest just the text: nothing behind the tabs.
	expect(await background()).toBe('rgba(0, 0, 0, 0)');
	await sheet(page).evaluate((dialog) => dialog.scrollTo(0, 400));
	await expect.poll(() => row.evaluate((node) => node.getBoundingClientRect().top)).toBe(0);
	await expect.poll(background).toBe('rgb(13, 19, 33)');
	const held = await rooms(page, IN_PLACE);
	// No tab lies under the close button, which stays over the held row.
	const [close, ...tabs] = await rooms(page, 'dialog.detail .detail-close, dialog.detail [role="tab"]');
	for (const [left, top, width, height] of tabs) expect(left + width <= close[0] || top >= close[1] + close[3] || top + height <= close[1]).toBe(true);
	// Every tab can be chosen from the held row.
	for (const name of ['Server', 'Downloads', 'Library']) {
		await choose(page, name);
		expect(await rooms(page, IN_PLACE)).toEqual(held);
	}
	await expect(shownPanels(page).locator('h2')).toHaveText(['How the library opens in a browser that has not chosen its own view']);
	const [under, starts] = await page.evaluate(() =>
		['.settings-tabs', '.settings-section'].map((part) => {
			const box = document.querySelector(`dialog.detail ${part}`)!.getBoundingClientRect();
			return Math.round((part === '.settings-tabs' ? box.bottom : box.top) * 10) / 10;
		})
	);
	// The sheet scrolls by whole pixels: the section starts within one of the row's bottom.
	expect(Math.abs(starts - under)).toBeLessThan(1);
	await expect(shownPanels(page)).toBeInViewport({ ratio: 1 });
	// Back at the top the row is at rest again, with nothing behind it.
	await sheet(page).evaluate((dialog) => dialog.scrollTo(0, 0));
	await expect.poll(background).toBe('rgba(0, 0, 0, 0)');
}

/** In each tab, nothing in the sheet scrolls but the sheet itself. */
async function hasOneScroller(page: Page): Promise<void> {
	await openSheet(page);
	for (const name of ['Library', 'Downloads', 'Batocera', 'Server']) {
		await choose(page, name);
		const scrollers = await sheet(page).evaluate((dialog) =>
			[...dialog.querySelectorAll('*')]
				.filter((node) => {
					const style = getComputedStyle(node);
					const scrolls = (overflow: string) => overflow === 'auto' || overflow === 'scroll';
					return (
						(scrolls(style.overflowY) && node.scrollHeight > node.clientHeight) || (scrolls(style.overflowX) && node.scrollWidth > node.clientWidth)
					);
				})
				.map((node) => node.className)
		);
		expect(scrollers).toEqual([]);
	}
	// Every tab is whole: inside the row, and the row inside the window.
	const width = await page.evaluate(() => document.documentElement.clientWidth);
	const [row, ...tabs] = await rooms(page, 'dialog.detail .settings-tabs .tabs, dialog.detail [role="tab"]');
	expect(tabs).toHaveLength(4);
	expect(row[0] >= 0 && row[0] + row[2] <= width).toBe(true);
	for (const [left, , w] of tabs) expect(left >= row[0] && left + w <= row[0] + row[2] + 0.5).toBe(true);
	// Batocera's section is longer than the window: the sheet is what scrolls.
	await choose(page, 'Batocera');
	expect(await sheet(page).evaluate((dialog) => dialog.scrollHeight > dialog.clientHeight)).toBe(true);
}

/** The panel "This Canvas": the facts' rows, by their order. */
const facts = (page: Page) => sheet(page).locator('#settings-section-server .set-facts');
const fact = (page: Page, n: number) => facts(page).locator('dd').nth(n);
/** The fainter part of a fact's row. */
const faint = (page: Page, n: number) => fact(page, n).locator('.set-faint');
const readNow = (page: Page) => facts(page).locator('.set-read-now');

/** The rows of the facts, the panels of the Server tab and the tabs: what stays where it is when a value is read. */
const SERVER_ROOMS = ['.set-facts dt', '.set-facts dd', '.settings-panel', '.set-read-now']
	.map((part) => `dialog.detail #settings-section-server ${part}`)
	.concat(IN_PLACE)
	.join(', ');

/** Slows the list of products of this Canvas's vangogh, so that a read lasts; 0 ends it. */
async function slowList(ms: number): Promise<void> {
	const res = await fetch(process.env.FAKE_SETTINGS_CONTROL!, { method: 'POST', body: JSON.stringify({ listDelayMs: ms }) });
	expect(res.status).toBe(204);
}

/** The time of the library's last read, as the sheet writes it in UTC, the zone of this Canvas. */
async function builtAt(page: Page): Promise<string> {
	return ((await (await page.request.get('/api/index')).json()) as { builtAt: string }).builtAt;
}
const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16);

/** A vangogh address longer than a row is wide, on a computer too. */
const LONG_ADDRESS = 'http://archive-of-the-family-games-in-the-cellar-cupboard.home.arpa:1853';

/**
 * The rows of "This Canvas" are drawn before the server has said anything, and keep their boxes, and the Server panel its
 * place, when it has and while "Read now" reads, with the longest lines a row can have: the library last read on another
 * day, and a long vangogh address. What does not fit ends in an ellipsis, and the title says all of it.
 */
async function keepsTheRowsInPlace(page: Page): Promise<void> {
	await openSheet(page);
	let answer!: () => void;
	const held = new Promise<void>((resolve) => (answer = resolve));
	// The server's own answers, as if the library was last read on 30 September, by a vangogh with a long address.
	await page.route('**/api/settings/status', async (route) => {
		await held;
		const res = await route.fetch();
		const status = await res.json();
		status.library.builtAt = '2026-09-30T04:30:00Z';
		status.startedAt = '2026-09-30T09:03:00Z';
		status.vangogh.url = LONG_ADDRESS;
		await route.fulfill({ response: res, json: status });
	});
	await choose(page, 'Server');
	await expect(facts(page).locator('dt')).toHaveCount(5);
	await expect(faint(page, 3)).not.toContainText('next at');
	const before = await rooms(page, SERVER_ROOMS);
	// Another day is the day alone, so the next read fits the line.
	const read = /^read 30 September, next at \d\d:\d\d$/;
	/** True when an element shows all of its text, without an ellipsis. */
	const whole = (node: Locator) => node.evaluate((element) => element.scrollWidth === element.clientWidth);

	answer();
	await expect(faint(page, 3)).toHaveText(read);
	await expect(fact(page, 2).locator('.set-pill')).toHaveText('Signed in');
	expect(await rooms(page, SERVER_ROOMS)).toEqual(before);
	await expect(faint(page, 3)).toHaveAttribute('title', read);
	expect(await whole(faint(page, 3))).toBe(true);
	// "Running" keeps the time of another day, and it fits too.
	await expect(fact(page, 1).locator('.set-text')).toHaveText(/^since 30 September at \d\d:\d\d$/);
	expect(await whole(fact(page, 1).locator('.set-text'))).toBe(true);
	expect(await whole(faint(page, 1))).toBe(true);
	// The long address ends in an ellipsis, and its title says all of it.
	await expect(fact(page, 2).locator('.set-text')).toHaveAttribute('title', LONG_ADDRESS);
	expect(await whole(fact(page, 2).locator('.set-text'))).toBe(false);

	await slowList(1500);
	// A press that does not scroll first, as Playwright's click would.
	await readNow(page).evaluate((node: HTMLElement) => node.click());
	await expect(readNow(page)).toHaveAccessibleName('Reading…');
	await expect(faint(page, 3)).toHaveText('reading…');
	expect(await rooms(page, SERVER_ROOMS)).toEqual(before);
	await slowList(0);
	await expect(readNow(page)).toHaveAccessibleName('Read now', { timeout: 10_000 });
	await expect(faint(page, 3)).toHaveText(read);
	expect(await rooms(page, SERVER_ROOMS)).toEqual(before);
}

/**
 * A change that cannot be saved says "Not saved" in the foot, in red and in view, until a change is saved: then "Saved"
 * shows in its room. The foot's parts stay where they are.
 */
async function saysNotSaved(page: Page): Promise<void> {
	await openSheet(page);
	const foot = sheet(page).locator('.settings-foot');
	const saved = foot.locator('.saved');
	const notSaved = foot.locator('.not-saved');
	const FOOT = 'dialog.detail .settings-foot, dialog.detail .settings-foot > *';
	await expect(notSaved).toBeHidden();
	await expect(notSaved).toHaveText('Not saved');
	const before = await rooms(page, FOOT);
	/** A sort order that is not chosen: a change. */
	const press = () => opens(page).locator('.set-row').first().locator('button.chip[aria-pressed="false"]').first().click();

	await page.route('**/api/settings', (route) => (route.request().method() === 'PUT' ? route.abort() : route.continue()));
	await press();
	await expect(notSaved).toBeVisible();
	await expect(notSaved).toBeInViewport({ ratio: 1 });
	expect(await notSaved.evaluate((node) => getComputedStyle(node).color)).toBe('rgb(240, 85, 63)');
	await expect(foot.getByRole('status')).toHaveText('Not saved');
	await expect(saved).toBeHidden();
	expect(await rooms(page, FOOT)).toEqual(before);
	// It stays after "Saved" would have gone.
	await page.waitForTimeout(1800);
	await expect(notSaved).toBeVisible();

	await page.unroute('**/api/settings');
	await press();
	await expect(saved).toBeVisible();
	await expect(notSaved).toBeHidden();
	expect(await rooms(page, FOOT)).toEqual(before);
}

/** Every game of the library of these tests, A to Z. */
const EVERY_GAME = ['Broken Record', 'Foreign Only Game', 'Lonely Expansion', 'The Long Dark Road', 'Missing Files Game', 'Windows Only Game'];

const UNWRITABLE = 'Canvas cannot save settings: the folder /settings cannot be written. Give the container a volume there, as the README shows.';
const UNREACHABLE = 'Canvas did not answer. The change was not saved.';
const REFUSED = 'Canvas refused the change. The README says why, under "The settings page".';

test.describe('the settings sheet', () => {
	// The settings are one for every browser: they go back to none, so that a second run starts as the first did.
	test.afterAll(async ({ playwright }) => {
		const api = await playwright.request.newContext({ baseURL: process.env.CANVAS_SETTINGS_URL });
		expect((await api.post('/api/settings/unlock', { data: { pin: '2468' } })).status()).toBe(204);
		// NO_SETTINGS.
		const reset = await api.put('/api/settings', {
			data: {
				defaults: { os: [], sort: 'title', grouped: false, hide18: false },
				theo: false,
				preferred: 'auto',
				batocera: { on: false, address: '', user: 'root', wake: false, shutdown: false },
				server: { rebuildAt: null, timeZone: null, versionCheck: null }
			}
		});
		expect(reset.status()).toBe(200);
		await api.dispose();
	});

	test('shows how the library opens and the theo switch', async ({ page }) => {
		await page.goto('/');
		await openPrompt(page);
		await unlock(page);
		const panels = shownPanels(page);
		await expect(panels.locator('h2')).toHaveText(['How the library opens in a browser that has not chosen its own view']);
		const rows = panels.first().locator('.set-row');
		await expect(rows.locator('.set-k')).toHaveText(['Sorted', 'Platforms', 'Collections', 'Age']);
		await expect(rows.nth(0).locator('button.chip')).toHaveText(['A to Z', 'Recently added', 'Release year']);
		await expect(rows.nth(1).locator('button.chip')).toHaveText(['Windows', 'macOS', 'Linux']);
		await expect(rows.nth(2).locator('button.chip')).toHaveText(['Show collections']);
		await expect(rows.nth(3).locator('button.chip')).toHaveText(['Hide 18+']);
		await expect(panels.first().locator('button.chip[aria-pressed="true"]')).toHaveText(['A to Z']);
		await expect(panels.first().locator('button.chip[aria-pressed="false"]')).toHaveCount(7);
		await expect(sheet(page).getByText('None chosen: all games')).toBeVisible();
		await expect(panels.first().locator('.set-note')).toHaveText('A browser where someone already chose a view keeps their choice.');

		await choose(page, 'Downloads');
		await expect(panels.locator('h2')).toHaveText(["Preferred platform what a game's main button starts on", 'theo for people who install games with theo']);
		await expect(theoSwitch(page)).toHaveAttribute('aria-checked', 'false');
		await expect(panels.nth(1)).toContainText('theo installs games from vangogh and starts them, on macOS and Linux.');
		const link = panels.nth(1).getByRole('link', { name: 'theo on GitHub' });
		await expect(link).toHaveAttribute('href', 'https://github.com/arelate/theo');
		await expect(link).toHaveAttribute('target', '_blank');
		await expect(sheet(page).locator('.notice')).toHaveCount(0);
	});

	test('saves each change at once', async ({ page }) => {
		await page.goto('/');
		await openPrompt(page);
		await unlock(page);
		const saved = sheet(page).locator('.settings-foot .saved');
		await expect(saved).toBeHidden();
		await expect(saved).toHaveText('Saved');

		await chip(page, 'Recently added').click();
		await expect(chip(page, 'Recently added')).toHaveAttribute('aria-pressed', 'true');
		await expect(chip(page, 'A to Z')).toHaveAttribute('aria-pressed', 'false');
		await expect(saved).toBeVisible();
		await expect(saved).toBeHidden();

		await chip(page, 'macOS').click();
		await expect(chip(page, 'macOS')).toHaveAttribute('aria-pressed', 'true');
		await expect(saved).toBeVisible();
		await expect(saved).toBeHidden();

		await choose(page, 'Downloads');
		await theoSwitch(page).click();
		await expect(theoSwitch(page)).toHaveAttribute('aria-checked', 'true');
		await expect(saved).toBeVisible();

		await page.reload();
		await expect(sheet(page).locator('h1')).toHaveText('Settings');
		await expect(opens(page).locator('button.chip[aria-pressed="true"]')).toHaveText(['Recently added', 'macOS']);
		await choose(page, 'Downloads');
		await expect(theoSwitch(page)).toHaveAttribute('aria-checked', 'true');
	});

	test('keeps the room of "None chosen" and of "Saved"', async ({ page }) => {
		await page.goto('/');
		await openPrompt(page);
		await unlock(page);
		const saved = sheet(page).locator('.settings-foot .saved');
		const none = sheet(page).getByText('None chosen: all games');
		/** The four rows, "None chosen", "Unlocked in this browser until …" and "Lock". */
		const rooms = () =>
			Promise.all([
				...[1, 2, 3, 4].map((n) => place(page, `dialog.detail .set-row:nth-of-type(${n})`)),
				place(page, 'dialog.detail .set-hint'),
				place(page, 'dialog.detail .settings-until'),
				place(page, 'dialog.detail .settings-lock')
			]);
		/** A press that does not scroll first, as Playwright's click would. */
		const press = (name: string) => chip(page, name).evaluate((node: HTMLElement) => node.click());

		// No platform chosen: "None chosen" shows.
		await press('macOS');
		await expect(none).toBeVisible();
		await expect(saved).toBeVisible();
		await expect(saved).toBeHidden();
		const before = await rooms();

		await press('Linux');
		await expect(none).toBeHidden();
		expect(await rooms()).toEqual(before);
		await expect(saved).toBeVisible();
		expect(await rooms()).toEqual(before);
		await expect(saved).toBeHidden();
		expect(await rooms()).toEqual(before);

		// Back to macOS alone, for the tests that follow.
		const answered = () => page.waitForResponse((r) => new URL(r.url()).pathname === '/api/settings' && r.request().method() === 'PUT');
		let put = answered();
		await press('Linux');
		await put;
		put = answered();
		await press('macOS');
		expect((await put).status()).toBe(200);
	});

	test('opens the library with the defaults in a browser that never chose', async ({ page }) => {
		await page.goto('/');
		expect(await titles(page)).toEqual(['The Long Dark Road']);
		await expect(page.locator('.sort button[aria-pressed="true"]')).toHaveText('Recently added');
		await expect(page.locator('.os-toggle button[aria-pressed="true"]')).toHaveText(['macOS']);
	});

	test('leaves a browser that chose its own view as it was', async ({ page }) => {
		await page.context().addCookies([{ name: 'canvas-view', value: '|title', url: process.env.CANVAS_SETTINGS_URL! }]);
		await page.goto('/');
		expect(await titles(page)).toEqual(EVERY_GAME);
		await expect(page.locator('.sort button[aria-pressed="true"]')).toHaveText('A to Z');
		await expect(page.locator('.os-toggle button[aria-pressed="true"]')).toHaveCount(0);
	});

	test('puts a chip back and says why when the save fails', async ({ page }) => {
		await page.goto('/');
		await openPrompt(page);
		await unlock(page);
		const notice = sheet(page).locator('.notice.notice-bad');
		await expect(notice).toHaveCount(0);

		await page.route('**/api/settings', (route) =>
			route.request().method() === 'PUT'
				? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"settings-unwritable"}' })
				: route.continue()
		);
		await chip(page, 'Release year').click();
		await expect(notice).toHaveText(UNWRITABLE);
		await expect(chip(page, 'Release year')).toHaveAttribute('aria-pressed', 'false');
		await expect(chip(page, 'Recently added')).toHaveAttribute('aria-pressed', 'true');
		// The sheet says so from the moment it opens again.
		await page.keyboard.press('Escape');
		await expect(sheet(page)).toBeHidden();
		await page.locator('.foot .settings-link').click();
		await expect(notice).toHaveText(UNWRITABLE);

		await page.unroute('**/api/settings');
		await page.route('**/api/settings', (route) => (route.request().method() === 'PUT' ? route.abort() : route.continue()));
		await chip(page, 'Release year').click();
		await expect(notice).toHaveText(UNREACHABLE);
		await expect(chip(page, 'Release year')).toHaveAttribute('aria-pressed', 'false');
		await expect(chip(page, 'Recently added')).toHaveAttribute('aria-pressed', 'true');
	});

	test('says Canvas refused the change when it answers 403', async ({ page }) => {
		await page.goto('/');
		await openPrompt(page);
		await unlock(page);
		const notice = sheet(page).locator('.notice.notice-bad');
		await expect(notice).toHaveCount(0);

		await page.route('**/api/settings', (route) =>
			route.request().method() === 'PUT'
				? route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"cross-site"}' })
				: route.continue()
		);
		await chip(page, 'Release year').click();
		await expect(notice).toHaveText(REFUSED);
		await expect(chip(page, 'Release year')).toHaveAttribute('aria-pressed', 'false');
		await expect(chip(page, 'Recently added')).toHaveAttribute('aria-pressed', 'true');
	});

	test('asks for the PIN again when the settings were locked meanwhile', async ({ page }) => {
		await page.goto('/');
		await openPrompt(page);
		await unlock(page);
		// Another tab locks: the request shares the page's cookies.
		expect((await page.request.post('/api/settings/lock')).status()).toBe(204);
		await chip(page, 'Release year').click();
		await expect(page.locator('dialog.pin')).toContainText('Settings were locked again. Enter the PIN.');
		await expect(sheet(page)).toBeHidden();
		await expect(page).toHaveURL(/\/settings$/);

		await unlock(page);
		await expect(chip(page, 'Release year')).toHaveAttribute('aria-pressed', 'false');
		await expect(opens(page).locator('button.chip[aria-pressed="true"]')).toHaveText(['Recently added', 'macOS']);
		await choose(page, 'Downloads');
		await expect(theoSwitch(page)).toHaveAttribute('aria-checked', 'true');
	});

	test('opens again with what was saved, over the list of another address', async ({ page }) => {
		// The page comes by the address of the settings.
		await page.goto('/settings');
		await expect(page.locator('dialog.pin')).toBeVisible();
		await unlock(page);
		await chip(page, 'Release year').click();
		await expect(sheet(page).locator('.settings-foot .saved')).toBeVisible();
		// Closing leaves that address for the list's own, a page of its own.
		await page.keyboard.press('Escape');
		await expect(sheet(page)).toBeHidden();
		await expect(page).toHaveURL((url) => url.pathname === '/');
		await page.locator('.foot .settings-link').click();
		await expect(sheet(page).locator('h1')).toHaveText('Settings');
		await expect(opens(page).locator('button.chip[aria-pressed="true"]')).toHaveText(['Release year', 'macOS']);
	});

	test('shows the settings in four tabs, Library first', async ({ page }) => {
		await page.goto('/');
		await openPrompt(page);
		await unlock(page);
		const tabs = sheet(page).getByRole('tab');
		const section = sheet(page).getByRole('tabpanel');
		const panelTitles = section.locator('.settings-panel h2');
		const LIBRARY = ['How the library opens in a browser that has not chosen its own view'];
		const SERVER = ['This Canvas what the server says now', 'Server what Canvas does on its own'];
		await expect(tabs).toHaveText(['Library', 'Downloads', 'Batocera', 'Server']);
		await expect(sheet(page).getByRole('tab', { selected: true })).toHaveText('Library');
		await expect(section).toHaveAccessibleName('Library');
		// Its panel is the only one shown; each tab has a section of its own.
		await expect(sheet(page).locator('.settings-panel').filter({ visible: true })).toHaveCount(1);
		await expect(panelTitles).toHaveText(LIBRARY);
		const ids = ['library', 'downloads', 'batocera', 'server'].map((name) => `settings-section-${name}`);
		expect(await tabs.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-controls')))).toEqual(ids);
		expect(await sheet(page).locator('[role="tabpanel"]').evaluateAll((nodes) => nodes.map((node) => node.id))).toEqual(ids);
		await expect(section).toHaveAttribute('id', 'settings-section-library');

		// Arrow keys, Home and End move between the tabs and choose them, as the file list's tabs do.
		await tabs.first().focus();
		const steps: [string, string, string[]][] = [
			['ArrowRight', 'Downloads', ["Preferred platform what a game's main button starts on", 'theo for people who install games with theo']],
			['ArrowRight', 'Batocera', ['Batocera Experimental for sending games to a Batocera box by the TV']],
			['ArrowRight', 'Server', SERVER],
			['ArrowRight', 'Library', LIBRARY],
			['ArrowLeft', 'Server', SERVER],
			['Home', 'Library', LIBRARY],
			['End', 'Server', SERVER]
		];
		for (const [key, name, panels] of steps) {
			await page.keyboard.press(key);
			await expect(tab(page, name)).toBeFocused();
			await expect(sheet(page).getByRole('tab', { selected: true })).toHaveText(name);
			await expect(section).toHaveAccessibleName(name);
			expect(await tabs.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).tabIndex))).toEqual(
				['Library', 'Downloads', 'Batocera', 'Server'].map((other) => (other === name ? 0 : -1))
			);
			await expect(panelTitles).toHaveText(panels);
		}

		// Batocera is off on this Canvas: its chip waits, and says where it is set up.
		await choose(page, 'Downloads');
		await expect(section.getByRole('button', { name: 'Batocera', exact: true })).toHaveAttribute('title', 'Batocera: once it is set up in the Batocera tab');

		// The sheet opens on Library each time.
		await page.keyboard.press('Escape');
		await expect(sheet(page)).toBeHidden();
		await page.locator('.foot .settings-link').click();
		await expect(sheet(page).getByRole('tab', { selected: true })).toHaveText('Library');
	});

	test('keeps the tabs, the close button and the foot in place across the tabs', async ({ page }) => {
		await keepsInPlace(page);
	});

	test('shows Saved in view after a change at the top', async ({ page }) => {
		await page.goto('/');
		await openPrompt(page);
		await unlock(page);
		const saved = sheet(page).locator('.settings-foot .saved');
		// A sort order that is not chosen yet: a change.
		await opens(page).locator('.set-row').first().locator('button.chip[aria-pressed="false"]').first().click();
		await expect(saved).toBeVisible();
		await expect(saved).toBeInViewport({ ratio: 1 });
	});

	test('holds the tabs at the top while Batocera scrolls', async ({ page }) => {
		await holdsTheTabs(page);
	});

	test('has one scroller', async ({ page }) => {
		await hasOneScroller(page);
	});

	test('shows what the server says now', async ({ page }) => {
		const { version, startedAt } = (await (await page.request.get('/healthz')).json()) as { version: string; startedAt: string };
		const index = (await (await page.request.get('/api/index')).json()) as { entries: unknown[]; collections: unknown[] };
		await openSheet(page);
		await choose(page, 'Server');
		await expect(shownPanels(page).locator('h2')).toHaveText(['This Canvas what the server says now', 'Server what Canvas does on its own']);
		await expect(facts(page).locator('dt')).toHaveText(['Version', 'Running', 'vangogh', 'Library', 'Batocera']);
		// The check is off on this Canvas: no pill, and no time.
		await expect(fact(page, 0).locator('.set-value')).toHaveText(version);
		await expect(fact(page, 0).locator('.set-pill')).toHaveCount(0);
		await expect(faint(page, 0)).toHaveText('Update check off');
		// The day Canvas started, in UTC, the zone of this Canvas: "today" only on that day.
		const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(startedAt));
		const today = startedAt.slice(0, 10) === new Date().toISOString().slice(0, 10);
		await expect(fact(page, 1).locator('.set-value')).toHaveText(`since ${today ? 'today' : day} at ${hhmm(startedAt)}`);
		await expect(faint(page, 1)).toHaveText(/^\d+ (minutes?|hours?)$/);
		await expect(fact(page, 2).locator('.set-value')).toHaveText(/^http:\/\/127\.0\.0\.1:\d+\s*Signed in$/);
		await expect(fact(page, 2).locator('.set-pill')).toHaveText('Signed in');
		const games = index.entries.length;
		const collections = index.collections.length;
		await expect(fact(page, 3).locator('.set-value')).toHaveText(
			`${games} ${games === 1 ? 'game' : 'games'}, ${collections} ${collections === 1 ? 'collection' : 'collections'}`
		);
		await expect(faint(page, 3)).toHaveText(`read today at ${hhmm(await builtAt(page))}, next at 04:30`);
		await expect(readNow(page)).toHaveAccessibleName('Read now');
		await expect(fact(page, 4).locator('.set-value')).toHaveText('Off');
		await expect(faint(page, 4)).toHaveText('no send running');

		// The three settings, as the stack has them: REBUILD_AT not set, TZ UTC, VERSION_CHECK off.
		const server = shownPanels(page).nth(1);
		await expect(server.locator('.set-k, .set-switch-label')).toHaveText(['Daily rebuild', 'Time zone', 'Check for updates']);
		await expect(sheet(page).getByLabel('Daily rebuild')).toHaveValue('04:30');
		const zone = sheet(page).getByLabel('Time zone');
		await expect(zone.locator('option')).toHaveCount(34);
		await expect(zone).toHaveValue('UTC');
		await expect(zone.locator('option:checked')).toHaveText('UTC · UTC');
		await expect(sheet(page).getByRole('switch', { name: 'Check for updates' })).toHaveAttribute('aria-checked', 'false');
		await expect(server.locator('.set-hint, .set-switch-text')).toHaveText([
			"Canvas reads vangogh's library again every day at this time, after vangogh's own sync at night. Starts from REBUILD_AT in the stack.",
			'Now UTC. Canvas shows its times in it: when the library was read, when a game went to Batocera. Starts from TZ in the stack.',
			'Canvas asks GitHub once a day whether a newer Canvas is out, and its foot says so. Starts from VERSION_CHECK in the stack.'
		]);
		await expect(server.locator('.set-from code')).toHaveText(['REBUILD_AT', 'TZ', 'VERSION_CHECK']);
	});

	test('keeps the rows in place when the server answers and while it reads', async ({ page }) => {
		await keepsTheRowsInPlace(page);
	});

	test('reads the library again with Read now', async ({ page }) => {
		await openSheet(page);
		await choose(page, 'Server');
		await expect(faint(page, 3)).toContainText('next at 04:30');
		const before = await builtAt(page);
		const rows = await rooms(page, SERVER_ROOMS);
		let posts = 0;
		page.on('request', (request) => {
			if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/rebuild') posts++;
		});
		// The list behind the sheet is read again too.
		const listRead = page.waitForRequest((request) => new URL(request.url()).pathname.endsWith('/__data.json'));

		await slowList(1500);
		await readNow(page).click();
		await expect(readNow(page)).toHaveAccessibleName('Reading…');
		await expect(faint(page, 3)).toHaveText('reading…');
		expect(await rooms(page, SERVER_ROOMS)).toEqual(rows);
		// A second press while it reads starts nothing.
		await readNow(page).click();
		await slowList(0);

		await expect(readNow(page)).toHaveAccessibleName('Read now', { timeout: 10_000 });
		await listRead;
		const after = await builtAt(page);
		expect(Date.parse(after)).toBeGreaterThan(Date.parse(before));
		await expect(faint(page, 3)).toHaveText(`read today at ${hhmm(after)}, next at 04:30`);
		expect(await rooms(page, SERVER_ROOMS)).toEqual(rows);
		expect(posts).toBe(1);
		await expect(sheet(page).locator('h1')).toHaveText('Settings');
	});

	test('waits for a read that is already running', async ({ page }) => {
		await openSheet(page);
		await slowList(1500);
		// A read the sheet did not start, as the daily one or curl's.
		expect((await page.request.post('/api/rebuild')).status()).toBe(202);
		// The tab opens on it, and waits for it.
		await choose(page, 'Server');
		await expect(readNow(page)).toHaveAccessibleName('Reading…');
		await expect(faint(page, 3)).toHaveText('reading…');
		await expect(readNow(page)).toHaveAccessibleName('Read now', { timeout: 10_000 });
		await expect(faint(page, 3)).toHaveText(`read today at ${hhmm(await builtAt(page))}, next at 04:30`);

		// Pressed while another read runs: Canvas answers 409, and the sheet waits for that one.
		const first = await builtAt(page);
		expect((await page.request.post('/api/rebuild')).status()).toBe(202);
		const answered = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/rebuild');
		await readNow(page).click();
		expect((await answered).status()).toBe(409);
		await expect(readNow(page)).toHaveAccessibleName('Reading…');
		await slowList(0);
		await expect(readNow(page)).toHaveAccessibleName('Read now', { timeout: 10_000 });
		const second = await builtAt(page);
		expect(Date.parse(second)).toBeGreaterThan(Date.parse(first));
		await expect(faint(page, 3)).toHaveText(`read today at ${hhmm(second)}, next at 04:30`);
	});

	test("keeps the stack's zone until the list is changed", async ({ page }) => {
		await openSheet(page);
		const put = page.waitForRequest((r) => r.method() === 'PUT' && new URL(r.url()).pathname === '/api/settings');
		await opens(page).locator('.set-row').first().locator('button.chip[aria-pressed="false"]').first().click();
		// A change outside the Server tab sends no Server settings: what is saved stays.
		expect((await put).postDataJSON()).not.toHaveProperty('server');
		await expect(sheet(page).locator('.settings-foot .saved')).toBeVisible();
		const answer = await (await page.request.get('/api/settings')).json();
		expect(answer.server).toEqual({ rebuildAt: null, timeZone: null, versionCheck: null });
		expect(answer.inEffect).toEqual({ rebuildAt: '04:30', timeZone: 'UTC', versionCheck: false });
	});

	test('saves the server settings', async ({ page }) => {
		await openSheet(page);
		await choose(page, 'Server');
		await expect(faint(page, 3)).toContainText('next at 04:30');
		const saved = sheet(page).locator('.settings-foot .saved');
		const time = sheet(page).getByLabel('Daily rebuild');
		const zone = sheet(page).getByLabel('Time zone');
		const updates = sheet(page).getByRole('switch', { name: 'Check for updates' });
		// Scrolled to its end, the tab holds every control above the foot: the presses below do not scroll it.
		await sheet(page).evaluate((dialog) => dialog.scrollTo(0, dialog.scrollHeight));
		await expect.poll(() => sheet(page).locator('.settings-tabs').evaluate((node) => node.getBoundingClientRect().top)).toBe(0);
		const rows = await rooms(page, SERVER_ROOMS);
		/** Waits for the answer of the save a change makes, and for "Saved". */
		const saves = async (change: () => Promise<unknown>) => {
			const answer = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/settings');
			await change();
			expect((await answer).status()).toBe(200);
			await expect(saved).toBeVisible();
		};

		await saves(() => time.fill('05:15'));
		// The next read follows the box at once.
		await expect(faint(page, 3)).toContainText('next at 05:15');
		await saves(() => zone.selectOption('Europe/Berlin'));
		await expect(zone.locator('option:checked')).toHaveText('UTC+1 · Amsterdam, Berlin, Bratislava, Lagos, Paris, Prague, Rome, Vienna');
		await expect(sheet(page).locator('#settings-section-server .set-hint').nth(1)).toHaveText(/^(It follows summer time: now UTC\+2|Now UTC\+1)\. Canvas shows/);
		await saves(() => updates.click());
		await expect(updates).toHaveAttribute('aria-checked', 'true');
		await saves(() => updates.click());
		await expect(updates).toHaveAttribute('aria-checked', 'false');
		expect(await rooms(page, SERVER_ROOMS)).toEqual(rows);
		const answer = await (await page.request.get('/api/settings')).json();
		expect(answer.server).toEqual({ rebuildAt: '05:15', timeZone: 'Europe/Berlin', versionCheck: false });

		await page.reload();
		await expect(sheet(page).locator('h1')).toHaveText('Settings');
		await choose(page, 'Server');
		await expect(time).toHaveValue('05:15');
		await expect(zone).toHaveValue('Europe/Berlin');
		// The zone of the stack is no longer the one in effect, and keeps its own entry: the way back is one choice.
		await expect(zone.locator('option')).toHaveCount(34);
		await expect(zone.locator('option[value="UTC"]')).toHaveText('UTC · UTC');
		await expect(updates).toHaveAttribute('aria-checked', 'false');
		await expect(faint(page, 3)).toContainText('next at 05:15');
		await saves(() => zone.selectOption('UTC'));
		await expect(zone.locator('option:checked')).toHaveText('UTC · UTC');
		expect((await (await page.request.get('/api/settings')).json()).server.timeZone).toBe('UTC');
	});

	test('keeps the Server settings saved elsewhere when another tab is changed', async ({ page }) => {
		await openSheet(page);
		// Another device saves a rebuild time while this sheet is open.
		const before = await (await page.request.get('/api/settings')).json();
		const other = await page.request.put('/api/settings', { data: { ...before, server: { ...before.server, rebuildAt: '06:10' } } });
		expect(other.status()).toBe(200);
		const put = page.waitForRequest((r) => r.method() === 'PUT' && new URL(r.url()).pathname === '/api/settings');
		await opens(page).locator('.set-row').first().locator('button.chip[aria-pressed="false"]').first().click();
		// This sheet sends no Server settings for a change of the Library tab, so it does not put back what it opened with.
		expect((await put).postDataJSON()).not.toHaveProperty('server');
		await expect(sheet(page).locator('.settings-foot .saved')).toBeVisible();
		expect((await (await page.request.get('/api/settings')).json()).server.rebuildAt).toBe('06:10');
	});

	test('says Not saved in the foot until a change is saved', async ({ page }) => {
		await saysNotSaved(page);
	});

	test.describe('on a phone', () => {
		test.use({ userAgent: UA.phone, viewport: { width: 390, height: 844 }, isMobile: true });

		test('fills a phone\'s screen and stacks the rows', async ({ page }) => {
			await openSheet(page);
			const [left, , width] = await place(page, 'dialog.detail .settings-inner');
			expect([left, width]).toEqual([0, 390]);
			for (const shown of ['Library', 'Downloads', 'Batocera', 'Server']) {
				await choose(page, shown);
				for (const row of await sheet(page).getByRole('tabpanel').locator('.set-row').all()) {
					const name = (await row.locator('.set-k').boundingBox())!;
					const chips = (await row.locator('.set-k + *').boundingBox())!;
					expect(name.y + name.height).toBeLessThanOrEqual(chips.y);
					expect(chips.x).toBe(name.x);
				}
				expect(await sheet(page).evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
			}
		});

		test('keeps the tabs, the close button and the foot in place across the tabs', async ({ page }) => {
			await keepsInPlace(page);
		});

		test('holds the tabs at the top while Batocera scrolls', async ({ page }) => {
			await holdsTheTabs(page);
		});

		test('has one scroller', async ({ page }) => {
			await hasOneScroller(page);
		});

		test('keeps the rows in place when the server answers and while it reads', async ({ page }) => {
			await keepsTheRowsInPlace(page);
		});

		test('says Not saved in the foot until a change is saved', async ({ page }) => {
			await saysNotSaved(page);
		});

		// The four tabs and the close button's corner fit the row of a narrow phone too.
		for (const [width, height] of [
			[360, 800],
			[320, 700]
		]) {
			test.describe(`${width} px wide`, () => {
				test.use({ viewport: { width, height } });

				test('has one scroller, and every tab whole', async ({ page }) => {
					await hasOneScroller(page);
				});

				test('holds the tabs at the top, none under the close button', async ({ page }) => {
					await holdsTheTabs(page);
				});
			});
		}
	});
});
