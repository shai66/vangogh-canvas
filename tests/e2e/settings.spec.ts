import type { Page } from '@playwright/test';
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

/** A chip of the panel "How the library opens", by its words. */
const chip = (page: Page, name: string) => sheet(page).locator('.settings-panel').getByRole('button', { name, exact: true });

/** The switch of the panel "theo". */
const theoSwitch = (page: Page) => sheet(page).getByRole('switch', { name: "Show the theo command in a game's detail" });

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
		const reset = await api.put('/api/settings', { data: { defaults: { os: [], sort: 'title', grouped: false, hide18: false }, theo: false } });
		expect(reset.status()).toBe(200);
		await api.dispose();
	});

	test('shows how the library opens and the theo switch', async ({ page }) => {
		await page.goto('/');
		await openPrompt(page);
		await unlock(page);
		const panels = sheet(page).locator('.settings-panel');
		await expect(panels.locator('h2')).toHaveText(['How the library opens in a browser that has not chosen its own view', 'theo for people who install games with theo']);
		const rows = panels.first().locator('.set-row');
		await expect(rows.locator('.set-k')).toHaveText(['Sorted', 'Platforms', 'Collections', 'Age']);
		await expect(rows.nth(0).locator('button.chip')).toHaveText(['A to Z', 'Recently added', 'Release year']);
		await expect(rows.nth(1).locator('button.chip')).toHaveText(['Windows', 'macOS', 'Linux']);
		await expect(rows.nth(2).locator('button.chip')).toHaveText(['Show collections']);
		await expect(rows.nth(3).locator('button.chip')).toHaveText(['Hide 18+']);
		await expect(panels.locator('button.chip[aria-pressed="true"]')).toHaveText(['A to Z']);
		await expect(panels.locator('button.chip[aria-pressed="false"]')).toHaveCount(7);
		await expect(sheet(page).getByText('None chosen: all games')).toBeVisible();
		await expect(panels.first().locator('.set-note')).toHaveText('A browser where someone already chose a view keeps their choice.');

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

		await theoSwitch(page).click();
		await expect(theoSwitch(page)).toHaveAttribute('aria-checked', 'true');
		await expect(saved).toBeVisible();

		await page.reload();
		await expect(sheet(page).locator('h1')).toHaveText('Settings');
		await expect(sheet(page).locator('.settings-panel button.chip[aria-pressed="true"]')).toHaveText(['Recently added', 'macOS']);
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
		await expect(sheet(page).locator('.settings-panel button.chip[aria-pressed="true"]')).toHaveText(['Recently added', 'macOS']);
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
		await expect(sheet(page).locator('.settings-panel button.chip[aria-pressed="true"]')).toHaveText(['Release year', 'macOS']);
	});

	test.describe('on a phone', () => {
		test.use({ userAgent: UA.phone, viewport: { width: 390, height: 844 }, isMobile: true });

		test('fills a phone\'s screen and stacks the rows', async ({ page }) => {
			await page.goto('/settings');
			await expect(page.locator('dialog.pin')).toBeVisible();
			await page.locator('dialog.pin').evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)));
			await unlock(page);
			const [left, , width] = await place(page, 'dialog.detail .settings-inner');
			expect([left, width]).toEqual([0, 390]);
			for (const row of await sheet(page).locator('.set-row').all()) {
				const name = (await row.locator('.set-k').boundingBox())!;
				const chips = (await row.locator('.chip-set').boundingBox())!;
				expect(name.y + name.height).toBeLessThanOrEqual(chips.y);
				expect(chips.x).toBe(name.x);
			}
			expect(await sheet(page).evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
		});
	});
});
