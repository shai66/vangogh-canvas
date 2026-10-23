import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { bold, flagButton, infoButton, mainButton, note, open, pickBatocera, plain, room, tvButton, unlock } from './batocera-helpers';
import { arrived, expect, place, test, UA } from './helpers';
import { installerOf } from './setup';

// One Canvas with Batocera set up with the fake box (setup.ts). The box, the sends and the settings are one for
// every browser: the tests run one at a time, each setting the fake box first.
test.describe.configure({ mode: 'serial' });
const BASE = process.env.CANVAS_BATOCERA_URL;
test.use({ baseURL: BASE });

const ROOT = process.env.FAKE_BATOCERA_ROOT ?? '';
const CONTROL = process.env.FAKE_BATOCERA_CONTROL ?? '';
const GB = 1024 ** 3;
const WINDOWS = join(ROOT, 'userdata', 'roms', 'windows');

/**
 * Sets the fake box through its control address: its free space, its screen, the game on the TV, whether it is on,
 * how slowly it greets, wakes and writes.
 */
async function box(state: Record<string, unknown>): Promise<void> {
	const res = await fetch(CONTROL, { method: 'POST', body: JSON.stringify(state) });
	expect(res.status).toBe(204);
}

/** Writes Canvas's marker into a game's folder on the fake box, as a send of those installer files would have. */
async function putOnBox(id: string, title: string, files: string[], version: string): Promise<void> {
	const dir = join(WINDOWS, `${title}.pc`);
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(dir, 'canvas.json'),
		JSON.stringify({ gameId: id, system: 'windows', files, version, sentAt: '2026-10-20T21:14:03Z', canvas: '0.12.0' })
	);
}

/** The hint at the end of the "i" of a game on the box. */
const HINT = 'Some games need extra settings in Batocera before they run well, such as the controls.';

test.describe('Batocera in a game\'s detail', () => {
	test.setTimeout(60_000);

	test.beforeAll(async ({ playwright }) => {
		// Three games already on the box: one sent from other installer files than vangogh has now, two as vangogh has
		// them. A passed connection test looks at the box again (spec 4.2), so the server knows them.
		await putOnBox('3009', 'Copper Bell', ['setup_game_3009_0.9.exe'], '0.9');
		await putOnBox('3010', 'Silver Reel', [installerOf('3010')], '1.0');
		await putOnBox('3011', 'Moss Garden', [installerOf('3011')], '1.0');
		const api = await playwright.request.newContext({ baseURL: BASE });
		try {
			await unlock(api);
			const tested = await api.post('/api/settings/batocera/test', { data: { address: '127.0.0.1', user: 'root' } });
			expect(await tested.text()).toContain('"ready":true');
		} finally {
			await api.dispose();
		}
	});

	test.beforeEach(async ({ request }) => {
		// On, with room for every game and a screen, nothing on the TV, and no countdown left by a test before.
		await box({ on: true, freeBytes: 400 * GB, primary: 'HDMI-1', running: null, idle: true, esUp: true });
		expect((await request.post('/api/batocera/keep-on')).status()).toBe(204);
	});

	test('shows nothing of Batocera while it is not set up', async ({ page }) => {
		// The Canvas of the settings tests has a PIN, and Batocera off.
		await page.goto(`${process.env.CANVAS_SETTINGS_URL}/game/1001`);
		const block = page.locator('.dl');
		await block.getByRole('button', { name: 'Download for another system' }).click();
		await expect(block.getByRole('menuitemradio')).toHaveCount(3);
		await expect(block.getByRole('menu')).not.toContainText('Batocera');
		await expect(block.locator('.menu-sep')).toHaveCount(0);

		// Set up, and a game without Windows files: as before, one system and no switch.
		await page.goto('/game/3004');
		await expect(mainButton(page)).toHaveAccessibleName('Download for macOS');
		await expect(block.locator('.split-more')).toHaveCount(0);
		await expect(block).not.toContainText('Batocera');
	});

	test('sends from the menu on a computer', async ({ page }) => {
		await open(page, '3001');
		const block = page.locator('.dl');
		const button = mainButton(page);
		// Windows only: with Batocera the game has the arrow, and a menu of two.
		await expect(button).toHaveAccessibleName('Download for Windows');
		const width = (await button.boundingBox())!.width;
		await block.getByRole('button', { name: 'Other systems and Batocera' }).click();
		await expect(block.getByRole('menu', { name: 'Other systems and Batocera' })).toBeVisible();
		await expect(block.getByRole('menuitemradio')).toHaveCount(2);
		await expect(block.locator('.menu-sep')).toHaveCount(1);
		const row = block.getByRole('menuitemradio', { name: 'Batocera' });
		await expect(row.locator('.n .on')).toHaveText('Not there yet');
		await expect(row).toHaveAttribute('aria-checked', 'false');
		await row.click();

		await expect(button).toHaveAccessibleName('Send to Batocera');
		await expect(button).toHaveClass(/btn-primary/);
		await expect(bold(page)).toHaveText('Windows version, 2 MB');
		await expect(plain(page)).toHaveText('Not on Batocera yet.');
		await expect(infoButton(page)).toHaveAccessibleDescription('Canvas copies the installers to Batocera, which unpacks them.');
		await expect(tvButton(page)).toHaveAccessibleDescription('Batocera is on.');
		// Batocera has no files: the list stays on its tab.
		await expect(page.getByRole('tab', { selected: true })).toHaveText('Windows1 file');

		await button.click();
		await expect(button).toHaveAccessibleName('Stop sending');
		await expect(button).not.toHaveClass(/btn-primary/);
		// The send begins by waiting for the box's answer, which is on.
		await expect(bold(page)).toHaveText(/^(Waiting for Batocera|Copying to Batocera|Unpacking on Batocera|Reloading Batocera's list), [1-3] of 3$/);
		await expect(plain(page)).toHaveText(/^(\d{1,3} %( · about \d+ minutes? left)?|Batocera is on)$/);
		await expect(room(page).getByRole('progressbar')).toBeVisible();
		await expect(infoButton(page)).toHaveAccessibleDescription('You can close this: the server goes on.');
		await expect(note(page)).toHaveCount(0);

		await expect(bold(page)).toHaveText('On Batocera', { timeout: 20_000 });
		await expect(bold(page).locator('.bato-check')).toHaveCount(1);
		await expect(plain(page)).toHaveText(/^Sent on \d{1,2} [A-Z][a-z]+\.$/);
		await expect(infoButton(page)).toHaveAccessibleDescription(`Version 1.2. It is in Batocera's list, under Windows. ${HINT}`);
		await expect(note(page)).toHaveCount(0);
		await expect(button).toHaveAccessibleName('Play on the TV');
		await expect(button).toHaveClass(/btn-primary/);
		expect((await button.boundingBox())!.width).toBe(width);
		const marker = JSON.parse(await readFile(join(WINDOWS, 'Night Harbour.pc', 'canvas.json'), 'utf8'));
		expect(marker).toMatchObject({ gameId: '3001', system: 'windows', version: '1.2' });
	});

	test("sends from the phone's button", async ({ browser }) => {
		const phone = await browser.newContext({ baseURL: BASE, userAgent: UA.phone, viewport: { width: 390, height: 844 } });
		try {
			const page = await phone.newPage();
			await open(page, '3003');
			const block = page.locator('.dl');
			const button = mainButton(page);
			await expect(button).toHaveAccessibleName('Send to Batocera');
			await expect(button).toHaveClass(/btn-primary/);
			await expect(block.locator('.split-more')).toHaveCount(0);
			await expect(bold(page)).toHaveText('DOS game, 1 MB');
			await expect(plain(page)).toHaveText('Not on Batocera yet.');
			// Under the button: the quiet line about installers, with its link.
			const installers = block.locator('.bato-quiet', { hasText: 'Installers are meant for a computer.' });
			expect((await button.boundingBox())!.y).toBeLessThan((await installers.boundingBox())!.y);
			await expect(installers.getByRole('button', { name: 'Show the files anyway' })).toBeVisible();

			await button.click();
			await expect(button).toHaveAccessibleName('Play on the TV', { timeout: 20_000 });
			await expect(note(page)).toHaveCount(0);
			await expect(infoButton(page)).toHaveAccessibleDescription(`Version 1.0. It is in Batocera's list, under DOS. ${HINT}`);
			expect((await room(page).boundingBox())!.y).toBeLessThan((await installers.boundingBox())!.y);
			expect(await readdir(join(ROOT, 'userdata', 'roms', 'dos'))).toContain('Cellar Quest.pc');
		} finally {
			await phone.close();
		}
	});

	test('stops a send', async ({ page }) => {
		await open(page, '3006');
		await pickBatocera(page);
		const button = mainButton(page);
		await button.click();
		await expect(button).toHaveAccessibleName('Stop sending');

		await button.click();
		await expect(button).toHaveAccessibleName('Send to Batocera');
		await expect(note(page)).toHaveCount(0);
		await expect(bold(page)).toHaveText('Windows version, 1 MB');
		await expect(plain(page)).toHaveText('Not on Batocera yet.');
		// Nothing of the game was left on the box.
		expect((await readdir(WINDOWS)).filter((name) => name.startsWith('Ember Hollow'))).toEqual([]);
	});

	test('tries again after a failed send', async ({ page }) => {
		await box({ freeBytes: 512 * 1024 ** 2 });
		await open(page, '3007');
		await pickBatocera(page);
		const button = mainButton(page);
		await button.click();
		await expect(plain(page)).toHaveText('The send stopped.');
		await expect(note(page)).toHaveClass(/notice-bad/);
		await expect(note(page)).not.toHaveClass(/notice-done/);
		await expect(note(page)).toContainText('Batocera has no room to unpack it. 512 MB free, 1 GB needed.');
		// Its own "i" holds the reason in full.
		await expect(note(page).getByRole('button', { name: 'More about this' })).toHaveAccessibleDescription(
			'Batocera has 512 MB free, and the send needs 1 GB while it unpacks. Nothing was left on the box.'
		);
		await expect(button).toHaveAccessibleName('Send to Batocera');

		await box({ freeBytes: 400 * GB });
		await note(page).getByRole('button', { name: 'Try again' }).click();
		await expect(button).toHaveAccessibleName('Play on the TV', { timeout: 20_000 });
		await expect(note(page)).toHaveCount(0);
		await expect(bold(page)).toHaveText('On Batocera');
		await expect(bold(page).locator('.bato-check')).toHaveCount(1);
	});

	test('asks before closing a game on the TV', async ({ page }) => {
		await box({ running: 'Harbour Lights Deluxe' });
		await open(page, '3010');
		await pickBatocera(page);
		const button = mainButton(page);
		await expect(button).toHaveAccessibleName('Play on the TV');
		await expect(plain(page)).toHaveText('Sent on 20 October.');

		await button.click();
		await expect(note(page)).toContainText('A game is running on the TV.');
		await expect(note(page)).not.toHaveClass(/notice-done|notice-bad/);
		await expect(note(page)).toContainText('Close it and start this one?');
		await expect(note(page).getByRole('button', { name: 'Close it and play' })).toHaveClass(/btn-primary/);
		// One yellow button at a time: the main button is quiet while the note asks, and can still be pressed.
		await expect(button).not.toHaveClass(/btn-primary/);
		await expect(button).toBeEnabled();
		await note(page).getByRole('button', { name: 'Cancel' }).click();
		await expect(note(page)).toHaveCount(0);
		// The server keeps the answer, and the question does not come back by itself.
		await open(page, '3010');
		await pickBatocera(page);
		await expect(note(page)).toHaveCount(0);

		await button.click();
		await expect(note(page)).toContainText('A game is running on the TV.');
		await note(page).getByRole('button', { name: 'Close it and play' }).click();
		await expect(plain(page)).toHaveText('Started. Pick up the remote.');
		await expect(note(page)).toHaveCount(0);
	});

	test('says that Play is starting while the box is slow to greet, and nothing moves', async ({ page }) => {
		await open(page, '3010');
		await pickBatocera(page);
		const button = mainButton(page);
		await expect(button).toHaveAccessibleName('Play on the TV');
		await expect(button).toHaveClass(/btn-primary/);
		const at = () => Promise.all(['.dl .split > .btn', '.dl .bato-line'].map((selector) => place(page, selector)));
		const before = await at();
		// The box takes 2 seconds before it says its first line, as the user's does.
		await box({ greetingDelayMs: 2000 });
		try {
			await button.evaluate((node: HTMLElement) => node.click());
			await expect(button).toHaveAccessibleName('Starting…');
			await expect(button).toBeDisabled();
			await expect(button).not.toHaveClass(/btn-primary/);
			await expect(button.locator('.bato-icon')).toHaveClass(/is-turning/);
			await expect(plain(page)).toHaveText('Starting the game on the TV…');
			await expect(note(page)).toHaveCount(0);
			expect(await at()).toEqual(before);

			await expect(plain(page)).toHaveText('Started. Pick up the remote.', { timeout: 10_000 });
			await expect(button).toHaveAccessibleName('Play on the TV');
			await expect(button).toHaveClass(/btn-primary/);
			await expect(button).toBeEnabled();
			expect(await at()).toEqual(before);

			// "Close it and play": the same wait, the question stays with its buttons waiting, and the line says that
			// the game on the TV is closed first.
			await box({ running: 'Harbour Lights Deluxe' });
			await button.evaluate((node: HTMLElement) => node.click());
			await expect(note(page)).toContainText('A game is running on the TV.', { timeout: 10_000 });
			await note(page).getByRole('button', { name: 'Close it and play' }).evaluate((node: HTMLElement) => node.click());
			await expect(button).toHaveAccessibleName('Starting…');
			await expect(button).toBeDisabled();
			await expect(plain(page)).toHaveText('Closing the other game first…');
			await expect(note(page)).toContainText('A game is running on the TV.');
			await expect(note(page).getByRole('button', { name: 'Close it and play' })).toBeDisabled();
			await expect(note(page).getByRole('button', { name: 'Cancel' })).toBeDisabled();
			expect(await at()).toEqual(before);
			await expect(plain(page)).toHaveText('Started. Pick up the remote.', { timeout: 10_000 });
			await expect(button).toHaveAccessibleName('Play on the TV');
			expect(await at()).toEqual(before);
		} finally {
			await box({ greetingDelayMs: 0 });
		}
	});

	test('counts down after a send it woke the box for, and keeps it on', async ({ page }) => {
		await box({ on: false });
		await open(page, '3008');
		await pickBatocera(page);
		await mainButton(page).click();
		await expect(note(page)).toContainText(/Batocera shuts down in 0:0[0-4]\./, { timeout: 20_000 });
		await expect(note(page)).toContainText('Canvas woke it for this send.');
		await expect(note(page)).not.toHaveClass(/notice-done|notice-bad/);
		await expect(tvButton(page)).toHaveAccessibleDescription('Batocera is on. Canvas woke it for this send.');

		await note(page).getByRole('button', { name: 'Keep it on' }).evaluate((node: HTMLElement) => node.click());
		await expect(note(page)).toHaveCount(0);
		await expect(tvButton(page)).toHaveAccessibleDescription('Batocera stays on.');
		await expect(mainButton(page)).toHaveAccessibleName('Play on the TV');
	});

	test('offers an update when vangogh has a newer version', async ({ page }) => {
		await open(page, '3009');
		const block = page.locator('.dl');
		await block.getByRole('button', { name: 'Other systems and Batocera' }).click();
		const row = block.getByRole('menuitemradio', { name: 'Batocera' });
		await expect(row.locator('.n .on')).toHaveText('Newer version');
		await expect(row.locator('.n')).toHaveClass(/is-on/);
		await row.click();
		await expect(mainButton(page)).toHaveAccessibleName('Play on the TV');
		await expect(plain(page)).toHaveText('Sent on 20 October.');
		await expect(infoButton(page)).toHaveAccessibleDescription(`Batocera has 0.9; vangogh has 1.0. ${HINT}`);
		await expect(note(page)).toContainText('vangogh has a newer version.');
		await expect(note(page)).toContainText('Saves stay as they are.');
		await expect(note(page)).not.toHaveClass(/notice-done|notice-bad/);

		// The line beside the button keeps its room while the update is sent: nothing moves.
		const at = () => Promise.all(['.dl .split > .btn', '.dl .bato-line'].map((selector) => place(page, selector)));
		const before = await at();
		await note(page).getByRole('button', { name: 'Update on Batocera' }).evaluate((node: HTMLElement) => node.click());
		await expect(bold(page)).toHaveText(/^(Waiting to be sent|(Waiting for Batocera|Copying to Batocera|Unpacking on Batocera|Reloading Batocera's list), [1-3] of 3)$/);
		expect(await at()).toEqual(before);
		await expect(bold(page)).toHaveText('On Batocera', { timeout: 20_000 });
		await expect(plain(page)).toHaveText(/^Sent on .+\.$/);
		expect(await at()).toEqual(before);
		// The same folder, now with vangogh's files.
		const marker = JSON.parse(await readFile(join(WINDOWS, 'Copper Bell.pc', 'canvas.json'), 'utf8'));
		expect(marker.files).toEqual([installerOf('3009')]);
	});

	test('marks a game only with the settings unlocked', async ({ page, browser }) => {
		await open(page, '3011');
		await pickBatocera(page);
		await expect(plain(page)).toHaveText('Sent on 20 October.');
		await expect(flagButton(page)).toHaveCount(0);

		await unlock(page.request);
		await open(page, '3011');
		await pickBatocera(page);
		await expect(plain(page)).toHaveText('Sent on 20 October.');
		await expect(flagButton(page)).toHaveAccessibleName("Doesn't run? Mark it");
		await flagButton(page).click();
		await expect(bold(page)).toHaveText("Doesn't run on Batocera");
		await expect(plain(page)).toHaveText('Hidden for everyone else.');
		await expect(flagButton(page)).toHaveAccessibleName('Take the mark back');
		await expect(flagButton(page)).toHaveClass(/is-marked/);
		await expect(mainButton(page)).toHaveAccessibleName('Send to Batocera');
		await expect(mainButton(page)).toBeDisabled();
		await expect(mainButton(page)).not.toHaveClass(/btn-primary/);

		try {
			// A fresh browser on a computer: the row is there, reads "Doesn't run there", and cannot be picked.
			const computer = await browser.newContext({ baseURL: BASE, userAgent: UA.windows });
			try {
				const other = await computer.newPage();
				await open(other, '3011');
				await expect(mainButton(other)).toHaveAccessibleName('Download for Windows');
				await other.locator('.dl').getByRole('button', { name: 'Other systems and Batocera' }).click();
				const row = other.locator('.dl').getByRole('menuitemradio', { name: 'Batocera' });
				await expect(row).toHaveAttribute('aria-disabled', 'true');
				await expect(row.locator('.n .on')).toHaveText("Doesn't run there");
				// Playwright waits for a disabled row to become usable: the click is the page's own.
				await row.evaluate((node: HTMLElement) => node.click());
				await expect(mainButton(other)).toHaveAccessibleName('Download for Windows');
			} finally {
				await computer.close();
			}

			// A phone: no button, and the line in its place.
			const phone = await browser.newContext({ baseURL: BASE, userAgent: UA.phone, viewport: { width: 390, height: 844 } });
			try {
				const small = await phone.newPage();
				await open(small, '3011');
				await expect(small.locator('.dl .split')).toHaveCount(0);
				await expect(room(small).locator('.bato-prohibit')).toHaveCount(1);
				await expect(bold(small)).toHaveText("Doesn't run on Batocera");
				await expect(plain(small)).toHaveText('It was tried on the box and marked in Canvas.');
				await expect(note(small)).toHaveCount(0);
				await expect(small.locator('.dl').getByRole('button', { name: 'Show the files anyway' })).toBeVisible();
			} finally {
				await phone.close();
			}
		} finally {
			await flagButton(page).click();
			await expect(plain(page)).toHaveText('Sent on 20 October.');
			await expect(flagButton(page)).toHaveAccessibleName("Doesn't run? Mark it");
			await expect(mainButton(page)).toBeEnabled();
		}
	});

	test('starts on the preferred platform', async ({ page, playwright }) => {
		const api = await playwright.request.newContext({ baseURL: BASE });
		// The settings of setup.ts, with another preferred platform.
		const save = (preferred: string) =>
			api.put('/api/settings', {
				data: {
					defaults: { os: [], sort: 'title', grouped: false, hide18: false },
					theo: false,
					preferred,
					batocera: { on: true, address: '127.0.0.1', user: 'root', wake: true, shutdown: true }
				}
			});
		try {
			await unlock(api);
			expect((await save('batocera')).status()).toBe(200);
			await open(page, '3012');
			await expect(mainButton(page)).toHaveAccessibleName('Send to Batocera');
			await page.locator('.dl').getByRole('button', { name: 'Other systems and Batocera' }).click();
			await expect(page.locator('.dl').getByRole('menuitemradio', { checked: true })).toHaveAccessibleName(/^Batocera/);

			// A game Batocera cannot take starts as with Autoselect.
			await page.goto('/game/3004');
			await expect(mainButton(page)).toHaveAccessibleName('Download for macOS');
		} finally {
			expect((await save('auto')).status()).toBe(200);
			await api.dispose();
		}
		await open(page, '3012');
		await expect(mainButton(page)).toHaveAccessibleName('Download for Windows');
	});

	test('keeps the button on Batocera when the game is marked from its line', async ({ page, playwright }) => {
		const api = await playwright.request.newContext({ baseURL: BASE });
		const save = (preferred: string) =>
			api.put('/api/settings', {
				data: {
					defaults: { os: [], sort: 'title', grouped: false, hide18: false },
					theo: false,
					preferred,
					batocera: { on: true, address: '127.0.0.1', user: 'root', wake: true, shutdown: true }
				}
			});
		try {
			await unlock(api);
			expect((await save('batocera')).status()).toBe(200);
			await unlock(page.request);
			// On the box, and on Batocera by the preferred platform, not by a pick.
			await open(page, '3011');
			await expect(mainButton(page)).toHaveAccessibleName('Play on the TV');

			await expect(flagButton(page)).toHaveAccessibleName("Doesn't run? Mark it");
			await flagButton(page).click();
			await expect(bold(page)).toHaveText("Doesn't run on Batocera");
			await expect(plain(page)).toHaveText('Hidden for everyone else.');
			await expect(flagButton(page)).toHaveAccessibleName('Take the mark back');
			await expect(flagButton(page)).toHaveClass(/is-marked/);
			await expect(mainButton(page)).toHaveAccessibleName('Send to Batocera');
			await expect(mainButton(page)).toBeDisabled();

			await flagButton(page).click();
			await expect(mainButton(page)).toHaveAccessibleName('Play on the TV');
			await expect(mainButton(page)).toBeEnabled();
		} finally {
			expect((await api.delete('/api/batocera/marks/3011')).status()).toBe(204);
			expect((await save('auto')).status()).toBe(200);
			await api.dispose();
		}
	});

	test('nothing moves while a send runs', async ({ page }) => {
		await open(page, '3005');
		await pickBatocera(page);
		const button = mainButton(page);
		await expect(button).toHaveAccessibleName('Send to Batocera');
		// The button, the line's room, its two slots and the file list's tabs; the bar's box while it shows.
		const still = ['.dl .split > .btn', '.dl .bato-line', '.dl .bato-slot:nth-child(1)', '.dl .bato-slot:nth-child(2)', '.dl-list .tabs'];
		const at = () => Promise.all(still.map((selector) => place(page, selector)));
		const before = await at();

		await button.evaluate((node: HTMLElement) => node.click());
		await expect(bold(page)).toHaveText(/^Waiting for Batocera|^Copying to Batocera|^Unpacking on Batocera/);
		expect(await at()).toEqual(before);
		const bar = await place(page, '.dl .bato-line-bar');

		await expect(bold(page)).toHaveText(/^Unpacking on Batocera/);
		expect(await at()).toEqual(before);
		expect(await place(page, '.dl .bato-line-bar')).toEqual(bar);
		// The next answer, the numbers changed.
		await page.waitForTimeout(2100);
		await expect(button).toHaveAccessibleName('Stop sending');
		expect(await at()).toEqual(before);
		expect(await place(page, '.dl .bato-line-bar')).toEqual(bar);

		await expect(bold(page)).toHaveText('On Batocera', { timeout: 20_000 });
		expect(await at()).toEqual(before);
	});

	test('says that it waits for a woken Batocera before the copy, and nothing moves when the copy starts', async ({ page, request }) => {
		// The box is off and answers 5 seconds after the packet; each piece of the copy takes longer than the page's 2 seconds between answers.
		await box({ on: false, bootMs: 5000, writeDelayMs: 3000 });
		try {
			await open(page, '3013');
			await pickBatocera(page);
			await mainButton(page).evaluate((node: HTMLElement) => node.click());
			const at = () => Promise.all(['.dl .split > .btn', '.dl .bato-line', '.dl .bato-line-bar'].map((selector) => place(page, selector)));

			await expect(bold(page)).toHaveText('Waiting for Batocera, 1 of 3', { timeout: 10_000 });
			await expect(plain(page)).toHaveText('Batocera is waking up');
			await expect(tvButton(page)).toHaveClass(/is-yellow/);
			await expect(tvButton(page)).toHaveAccessibleDescription('Batocera is waking up. Canvas woke it for this send.');
			const waiting = await at();

			await expect(bold(page)).toHaveText('Copying to Batocera, 1 of 3', { timeout: 15_000 });
			await expect(plain(page)).not.toContainText('MB');
			await expect(tvButton(page)).toHaveAccessibleDescription('Batocera is on. Canvas woke it for this send.');
			expect(await at()).toEqual(waiting);

			await expect(bold(page)).toHaveText('On Batocera', { timeout: 20_000 });
		} finally {
			await box({ bootMs: 300, writeDelayMs: 0 });
			// Canvas woke the box for this: no shutdown during the next test.
			expect((await request.post('/api/batocera/keep-on')).status()).toBe(204);
		}
	});

	test.describe('the note "Not available for" on a Mac', () => {
		test.use({ userAgent: UA.macos });

		test('names the preferred system when the game does not have it', async ({ page, playwright }) => {
			const api = await playwright.request.newContext({ baseURL: BASE });
			const save = (preferred: string) => api.put('/api/settings', { data: { ...settingsBody(), preferred } });
			try {
				await unlock(api);
				expect((await save('windows')).status()).toBe(200);
				const block = page.locator('.dl');
				// Windows and macOS: the button starts on Windows, and there is no note.
				await open(page, '3003');
				await expect(mainButton(page)).toHaveAccessibleName('Download for Windows');
				await expect(block.locator('.notice')).toHaveCount(0);

				// macOS only: the note names Windows, not the Mac the visitor sits at.
				await page.goto('/game/3004');
				await arrived(page);
				await expect(mainButton(page)).toHaveAccessibleName('Download for macOS');
				await expect(block.locator('.notice')).toContainText('Not available for Windows.');
				await expect(block.locator('.notice')).toContainText('This game exists for macOS. The files are listed below.');
			} finally {
				expect((await save('auto')).status()).toBe(200);
				await api.dispose();
			}
		});

		test('names Batocera only for a game without a Windows version, and a pick moves nothing', async ({ page, playwright }) => {
			const api = await playwright.request.newContext({ baseURL: BASE });
			const save = (preferred: string) => api.put('/api/settings', { data: { ...settingsBody(), preferred } });
			try {
				await unlock(api);
				expect((await save('batocera')).status()).toBe(200);
				const block = page.locator('.dl');
				// A game that can go: no note, though it has no macOS version.
				await open(page, '3012');
				await expect(mainButton(page)).toHaveAccessibleName('Send to Batocera');
				await expect(block.locator('.notice')).toHaveCount(0);
				const at = () => Promise.all(['.dl .split > .btn', '.dl-list .tabs'].map((selector) => place(page, selector)));
				const before = await at();

				// Picking Windows adds no note: the note follows the preferred platform, not the pick.
				await block.getByRole('button', { name: 'Other systems and Batocera' }).click();
				await block.getByRole('menuitemradio', { name: /^Windows/ }).click();
				await expect(block.getByRole('menu')).toHaveCount(0);
				await expect(mainButton(page)).toHaveAccessibleName('Download for Windows');
				await expect(block.locator('.notice')).toHaveCount(0);
				expect(await at()).toEqual(before);

				// No Windows version: the note names Batocera.
				await page.goto('/game/3004');
				await arrived(page);
				await expect(block.locator('.notice')).toContainText('Not available for Batocera.');
				await expect(block.locator('.notice')).toContainText('This game has no Windows version. The files are listed below.');
			} finally {
				expect((await save('auto')).status()).toBe(200);
				await api.dispose();
			}
		});

		test('shows the Windows files while the button is on Batocera, also after a pick', async ({ page, playwright }) => {
			const api = await playwright.request.newContext({ baseURL: BASE });
			const save = (preferred: string) => api.put('/api/settings', { data: { ...settingsBody(), preferred } });
			const shown = () => page.locator('.dl').getByRole('tab', { selected: true });
			try {
				await unlock(api);
				expect((await save('batocera')).status()).toBe(200);
				const block = page.locator('.dl');
				// Windows and macOS: on Batocera by the preferred platform, the list shows what goes, not the Mac's files.
				await open(page, '3003');
				await expect(block.getByRole('button', { name: 'Other systems and Batocera' })).toBeVisible();
				await expect(shown()).toHaveText(/^Windows/);

				// A tab turns the button to its system; Batocera picked again turns the list back to Windows.
				await block.getByRole('tab', { name: /^macOS/ }).click();
				await expect(mainButton(page)).toHaveAccessibleName('Download for macOS');
				await block.getByRole('button', { name: 'Other systems and Batocera' }).click();
				await block.getByRole('menuitemradio', { name: /^Batocera/ }).click();
				await expect(shown()).toHaveText(/^Windows/);
			} finally {
				expect((await save('auto')).status()).toBe(200);
				await api.dispose();
			}
			// With Autoselect the list opens on the Mac's files, as before.
			await open(page, '3003');
			await expect(shown()).toHaveText(/^macOS/);
		});
	});
});

/** The settings of setup.ts, Batocera on with the fake box, waking and "Shut down after sending" on; `batocera` changes some. */
const settingsBody = (batocera: Record<string, unknown> = {}) => ({
	defaults: { os: [], sort: 'title', grouped: false, hide18: false },
	theo: false,
	preferred: 'auto',
	batocera: { on: true, address: '127.0.0.1', user: 'root', wake: true, shutdown: true, ...batocera }
});

/** Chooses a tab of the settings sheet, and waits until it is chosen. */
async function choose(sheet: Locator, name: string): Promise<void> {
	const tab = sheet.getByRole('tab', { name, exact: true });
	await tab.click();
	await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** Unlocks this browser, opens the settings sheet at its address, waits until it has arrived, and chooses a tab. */
async function settingsSheet(page: Page, tab: string): Promise<Locator> {
	await unlock(page.request);
	await page.goto('/settings');
	const sheet = page.locator('dialog.detail');
	await expect(sheet.locator('h1')).toHaveText('Settings');
	await arrived(page);
	await choose(sheet, tab);
	return sheet;
}

/** The text a line of the checks shows: its texts are stacked in one place, and one is seen. */
const shown = (line: Locator) => line.locator('.stack > .on');

/** Where each of these elements is and how large, to the tenth of a pixel. */
function rooms(page: Page, selector: string): Promise<number[][]> {
	return page.locator(selector).evaluateAll((nodes) =>
		nodes.map((node) => {
			const box = node.getBoundingClientRect();
			return [box.left, box.top, box.width, box.height].map((n) => Math.round(n * 10) / 10);
		})
	);
}

/** Every row of the panel "Batocera", each line of its checks, and the foot of the sheet. */
const BATOCERA_ROOMS = [
	'dialog.detail .bato-settings',
	'dialog.detail .bato-settings .set-row',
	'dialog.detail .bato-settings .set-switch-row',
	'dialog.detail .bato-settings .set-checks > li',
	'dialog.detail .settings-foot'
].join(', ');

test.describe('Batocera in the settings', () => {
	test.setTimeout(60_000);

	test.beforeEach(async () => {
		await box({ on: true, freeBytes: 400 * GB, primary: 'HDMI-1', running: null, idle: true, esUp: true });
	});

	// Each test may change the login, end "set up" or turn the box off: the box goes on, and the settings back to those of
	// setup.ts, tested again.
	test.afterEach(async ({ playwright }) => {
		await box({ on: true, innoextract: true });
		const api = await playwright.request.newContext({ baseURL: BASE });
		try {
			await unlock(api);
			expect((await api.put('/api/settings', { data: settingsBody({ password: 'linux' }) })).status()).toBe(200);
			const tested = await api.post('/api/settings/batocera/test', { data: { address: '127.0.0.1', user: 'root' } });
			expect(await tested.text()).toContain('"ready":true');
		} finally {
			await api.dispose();
		}
	});

	test('chooses the preferred platform', async ({ page }) => {
		const sheet = await settingsSheet(page, 'Downloads');
		const panels = sheet.getByRole('tabpanel').locator('.settings-panel');
		await expect(panels.locator('h2')).toHaveText(["Preferred platform what a game's main button starts on", 'theo for people who install games with theo']);
		const panel = panels.first();
		await expect(panel.locator('.set-k')).toHaveText(['Starts on']);
		await expect(panel.locator('button.chip')).toHaveText(['Autoselect', 'Windows', 'macOS', 'Linux', 'Batocera']);
		await expect(panel.locator('button.chip[aria-pressed="true"]')).toHaveText(['Autoselect']);
		await expect(panel.locator('.set-note')).toHaveText(
			"Autoselect starts on the visitor's own system, as before. Another choice applies when the game has it, else Autoselect. A phone or tablet starts on Batocera whenever Batocera is set up."
		);
		const batocera = panel.getByRole('button', { name: 'Batocera', exact: true });
		await expect(batocera).not.toHaveAttribute('aria-disabled', 'true');

		const saved = sheet.locator('.settings-foot .saved');
		await batocera.click();
		await expect(batocera).toHaveAttribute('aria-pressed', 'true');
		await expect(panel.locator('button.chip[aria-pressed="true"]')).toHaveText(['Batocera']);
		await expect(saved).toBeVisible();
		await page.reload();
		await choose(sheet, 'Downloads');
		await expect(panel.locator('button.chip[aria-pressed="true"]')).toHaveText(['Batocera']);
		await panel.getByRole('button', { name: 'Autoselect' }).click();
		await expect(panel.locator('button.chip[aria-pressed="true"]')).toHaveText(['Autoselect']);
		await expect(saved).toBeVisible();

		// The Canvas of the settings tests has Batocera off: its chip waits until Batocera is set up, and a press does nothing.
		await page.goto(`${process.env.CANVAS_SETTINGS_URL}/settings`);
		await expect(sheet.locator('h1')).toHaveText('Settings');
		await choose(sheet, 'Downloads');
		const off = sheet.getByRole('tabpanel').locator('.settings-panel').first().getByRole('button', { name: 'Batocera', exact: true });
		await expect(off).toHaveAttribute('aria-disabled', 'true');
		await expect(off).toHaveAttribute('title', 'Batocera: once it is set up in the Batocera tab');
		await off.evaluate((node: HTMLElement) => node.click());
		await expect(off).toHaveAttribute('aria-pressed', 'false');
		await expect(sheet.getByRole('tabpanel').locator('.settings-panel').first().locator('button.chip[aria-pressed="true"]')).toHaveText(['Autoselect']);
	});

	test('dims the rows while Batocera is off, and nothing moves', async ({ page }) => {
		const sheet = await settingsSheet(page, 'Batocera');
		const panel = sheet.locator('.bato-settings');
		const rows = panel.locator('.set-row, .set-switch-row');
		await expect(rows).toHaveCount(7);
		await expect(panel.locator('.set-k')).toHaveText(['Address', 'User', 'Password', 'Connection']);
		const opacities = () => rows.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).opacity));
		const link = panel.getByRole('link', { name: 'About Batocera' });
		await expect(link).toHaveAttribute('href', 'https://batocera.org');
		await expect(link).toHaveAttribute('target', '_blank');
		// Batocera is experimental: a tag after the title, and a sentence under the switch that stays bright while it is off.
		const experimental = panel.locator('.set-experimental');
		await expect(panel.locator('h2 .set-tag')).toHaveText('Experimental');
		await expect(experimental).toHaveText('Experimental: most games need settings in Batocera before they run well, and some do not run at all.');
		expect(await opacities()).toEqual(['1', '1', '1', '1', '1', '1', '1']);
		const before = await rooms(page, BATOCERA_ROOMS);

		const on = panel.getByRole('switch', { name: 'Send games to Batocera' });
		await expect(on).toHaveAttribute('aria-checked', 'true');
		await on.evaluate((node: HTMLElement) => node.click());
		await expect(on).toHaveAttribute('aria-checked', 'false');
		await expect(sheet.locator('.settings-foot .saved')).toBeVisible();
		expect(await opacities()).toEqual(['1', '0.42', '0.42', '0.42', '0.42', '0.42', '0.42']);
		await expect(experimental).toBeVisible();
		expect(await rooms(page, BATOCERA_ROOMS)).toEqual(before);
		// The rows under the switch cannot be used: a box does not take the focus.
		expect(await panel.locator('#bato-address').evaluate((node: HTMLElement) => (node.focus(), document.activeElement === node))).toBe(false);
		// Off is not set up: the preferred platform's chip waits.
		await choose(sheet, 'Downloads');
		await expect(sheet.getByRole('tabpanel').locator('.settings-panel').first().getByRole('button', { name: 'Batocera', exact: true })).toHaveAttribute('aria-disabled', 'true');
		await choose(sheet, 'Batocera');

		await on.evaluate((node: HTMLElement) => node.click());
		await expect(on).toHaveAttribute('aria-checked', 'true');
		expect(await opacities()).toEqual(['1', '1', '1', '1', '1', '1', '1']);
		expect(await rooms(page, BATOCERA_ROOMS)).toEqual(before);
		await choose(sheet, 'Downloads');
		await expect(sheet.getByRole('tabpanel').locator('.settings-panel').first().getByRole('button', { name: 'Batocera', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
	});

	test('presses Autoselect when Batocera is switched off while it is the preferred platform', async ({ page }) => {
		const sheet = await settingsSheet(page, 'Downloads');
		const panel = sheet.getByRole('tabpanel').locator('.settings-panel').first();
		const pressed = panel.locator('button.chip[aria-pressed="true"]');
		await panel.getByRole('button', { name: 'Batocera', exact: true }).click();
		await expect(pressed).toHaveText(['Batocera']);
		await expect(sheet.locator('.settings-foot .saved')).toBeVisible();
		const PREFERRED_ROOMS = 'dialog.detail #settings-section-downloads .settings-panel, dialog.detail #settings-section-downloads .settings-panel button.chip';
		const before = await rooms(page, PREFERRED_ROOMS);
		await choose(sheet, 'Batocera');
		const beforeBatocera = await rooms(page, BATOCERA_ROOMS);

		const on = sheet.locator('.bato-settings').getByRole('switch', { name: 'Send games to Batocera' });
		await on.evaluate((node: HTMLElement) => node.click());
		await expect(on).toHaveAttribute('aria-checked', 'false');
		await expect(sheet.locator('.settings-foot .saved')).toBeVisible();
		expect(await rooms(page, BATOCERA_ROOMS)).toEqual(beforeBatocera);
		await choose(sheet, 'Downloads');
		await expect(pressed).toHaveText(['Autoselect']);
		expect(await rooms(page, PREFERRED_ROOMS)).toEqual(before);
		await page.reload();
		await choose(sheet, 'Downloads');
		await expect(pressed).toHaveText(['Autoselect']);
	});

	test('saves a field when it is left', async ({ page }) => {
		const sheet = await settingsSheet(page, 'Batocera');
		const panel = sheet.locator('.bato-settings');
		const saved = sheet.locator('.settings-foot .saved');
		const address = panel.locator('#bato-address');
		const user = panel.locator('#bato-user');
		const first = panel.locator('.set-connection > li').first();
		await expect(address).toHaveValue('127.0.0.1');
		await expect(user).toHaveValue('root');
		await expect(panel.locator('.set-row').first()).toContainText('Batocera shows it in its menu, under Network settings.');

		// A test that passed fills the lines.
		await panel.getByRole('button', { name: 'Test connection' }).click();
		await expect(shown(first)).toHaveText('Batocera answers at 127.0.0.1');
		await expect(panel.locator('.set-connection > .check-mac')).toBeVisible();

		// Changed and left: saved, and the lines go back to waiting for a test, since a new address ends "set up".
		await address.fill('localhost');
		await address.press('Tab');
		await expect(saved).toBeVisible();
		await expect(shown(first)).toHaveText('Batocera answers');
		await expect(first).toHaveClass(/\bis-todo\b/);
		await expect(panel.locator('.set-connection > .check-mac')).toBeHidden();
		await choose(sheet, 'Downloads');
		await expect(sheet.getByRole('tabpanel').locator('.settings-panel').first().getByRole('button', { name: 'Batocera', exact: true })).toHaveAttribute('aria-disabled', 'true');
		await choose(sheet, 'Batocera');
		await expect(saved).toBeHidden();
		// Enter saves too.
		await user.fill('pi');
		await user.press('Enter');
		await expect(saved).toBeVisible();
		await page.reload();
		await choose(sheet, 'Batocera');
		await expect(address).toHaveValue('localhost');
		await expect(user).toHaveValue('pi');

		// What Canvas cannot take is not sent, and stays in the box to be mended.
		let puts = 0;
		page.on('request', (r) => r.method() === 'PUT' && new URL(r.url()).pathname === '/api/settings' && puts++);
		await address.fill('my box');
		await address.press('Tab');
		await expect(address).toHaveAttribute('aria-invalid', 'true');
		await expect(address).toHaveValue('my box');
		await address.fill('localhost');
		await expect(address).not.toHaveAttribute('aria-invalid', 'true');
		expect(puts).toBe(0);
	});

	test('tests the connection', async ({ page }) => {
		// Another address saved: Batocera is not set up, and the games do not show it.
		expect((await page.request.post('/api/settings/unlock', { data: { pin: '2468' } })).status()).toBe(204);
		expect((await page.request.put('/api/settings', { data: settingsBody({ address: 'localhost' }) })).status()).toBe(200);
		const sheet = await settingsSheet(page, 'Downloads');
		const panel = sheet.locator('.bato-settings');
		const lines = panel.locator('.set-connection > li:not(.check-mac)');
		const mac = panel.locator('.set-connection > .check-mac');
		const chip = sheet.getByRole('tabpanel').locator('.settings-panel').first().getByRole('button', { name: 'Batocera', exact: true });
		await expect(chip).toHaveAttribute('aria-disabled', 'true');
		await choose(sheet, 'Batocera');
		// Before a test: each line waits, faint, and the room of the network card is kept.
		await expect(lines).toHaveCount(5);
		for (const [i, text] of ['Batocera answers', 'The login works', 'Canvas can write games to the box', "Free space and Batocera's version", 'EmulationStation answers'].entries()) {
			await expect(shown(lines.nth(i))).toHaveText(text);
			await expect(lines.nth(i)).toHaveClass(/\bis-todo\b/);
		}
		await expect(mac).toBeHidden();

		// The order in which the lines pass.
		await page.evaluate(() => {
			const passed: number[] = [];
			(window as unknown as { passed: number[] }).passed = passed;
			const items = [...document.querySelectorAll('.bato-settings .set-connection > li:not(.check-mac)')];
			const observer = new MutationObserver(() =>
				items.forEach((item, i) => item.classList.contains('is-ok') && !passed.includes(i + 1) && passed.push(i + 1))
			);
			for (const item of items) observer.observe(item, { attributes: true, attributeFilter: ['class'] });
		});
		await panel.locator('#bato-address').fill('127.0.0.1');
		await panel.getByRole('button', { name: 'Test connection' }).click();
		await expect(mac).toBeVisible();
		await expect(mac).toHaveText("The box's network card is saved for waking it: 02:00:00:aa:bb:cc");
		for (const [i, text] of [
			'Batocera answers at 127.0.0.1',
			'The login works',
			'Canvas can write games to roms/windows and roms/dos',
			'400 GB free, Batocera 43.1',
			'EmulationStation answers'
		].entries()) {
			await expect(shown(lines.nth(i))).toHaveText(text);
			await expect(lines.nth(i)).toHaveClass(/\bis-ok\b/);
		}
		expect(await page.evaluate(() => (window as unknown as { passed: number[] }).passed)).toEqual([1, 2, 3, 4, 5]);

		// Set up again, known to the page at once: the chip can be pressed, and its save keeps Batocera set up.
		await choose(sheet, 'Downloads');
		await expect(chip).not.toHaveAttribute('aria-disabled', 'true');
		await chip.click();
		await expect(chip).toHaveAttribute('aria-pressed', 'true');
		await expect(sheet.locator('.settings-foot .saved')).toBeVisible();
		const answer = await (await page.request.get('/api/settings')).json();
		expect(answer.batocera).toMatchObject({ on: true, address: '127.0.0.1', ready: true, mac: '02:00:00:aa:bb:cc' });

		// A game opened from the list has Batocera again.
		await page.keyboard.press('Escape');
		await expect(sheet).toBeHidden();
		await page.locator('.card', { hasText: 'Quiet Signal' }).click();
		await expect(mainButton(page)).toHaveAccessibleName('Send to Batocera');
	});

	test('says a refused login', async ({ page }) => {
		const sheet = await settingsSheet(page, 'Batocera');
		const panel = sheet.locator('.bato-settings');
		const lines = panel.locator('.set-connection > li:not(.check-mac)');
		const password = panel.locator('#bato-password');
		await password.fill('not the password');
		await panel.getByRole('button', { name: 'Test connection' }).click();
		await expect(lines.nth(1)).toHaveClass(/\bis-bad\b/);
		await expect(shown(lines.nth(1))).toHaveText('The login was refused. Check the user and the password.');
		await expect(shown(lines.nth(0))).toHaveText('Batocera answers at 127.0.0.1');
		await expect(lines.nth(0)).toHaveClass(/\bis-ok\b/);
		for (const [i, text] of [[2, 'Canvas can write games to the box'], [3, "Free space and Batocera's version"], [4, 'EmulationStation answers']] as const) {
			await expect(shown(lines.nth(i))).toHaveText(text);
			await expect(lines.nth(i)).toHaveClass(/\bis-todo\b/);
		}
		await expect(panel.locator('.set-connection > .check-mac')).toBeHidden();
		// The password was saved when the box was left, and the box was emptied.
		await expect(password).toHaveValue('');
	});

	test('keeps a running test while another tab is chosen', async ({ page }) => {
		const sheet = await settingsSheet(page, 'Batocera');
		const panel = sheet.locator('.bato-settings');
		const first = panel.locator('.set-connection > li').first();
		// The answer waits until the test lets it go.
		let release!: () => void;
		const answer = new Promise<void>((resolve) => (release = resolve));
		await page.route('**/api/settings/batocera/test', async (route) => {
			await answer;
			await route.continue();
		});
		await panel.getByRole('button', { name: 'Test connection' }).click();
		await expect(first.locator('.bato-icon')).toHaveClass(/\bis-turning\b/);

		await choose(sheet, 'Downloads');
		await choose(sheet, 'Batocera');
		await expect(first.locator('.bato-icon')).toHaveClass(/\bis-turning\b/);
		// A second press while the test runs starts no other.
		let tests = 0;
		page.on('request', (r) => new URL(r.url()).pathname === '/api/settings/batocera/test' && tests++);
		await panel.getByRole('button', { name: 'Test connection' }).click();

		release();
		await expect(shown(first)).toHaveText('Batocera answers at 127.0.0.1');
		await expect(first).toHaveClass(/\bis-ok\b/);
		await expect(panel.locator('.set-connection > .check-mac')).toBeVisible();
		expect(tests).toBe(0);
	});

	test('says when SSH did not start, in the room of line 2', async ({ page }) => {
		const sheet = await settingsSheet(page, 'Batocera');
		const panel = sheet.locator('.bato-settings');
		const lines = panel.locator('.set-connection > li:not(.check-mac)');
		// The server's answer for a box whose SSH did not start in time, without waiting the 20 seconds.
		const answer = [{ step: 1, result: 'ok', address: '127.0.0.1' }, { step: 2, result: 'fail', login: 'no-ssh' }, { done: true, ready: false, mac: null }];
		await page.route('**/api/settings/batocera/test', (route) =>
			route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: answer.map((line) => `${JSON.stringify(line)}\n`).join('') })
		);
		const before = await rooms(page, BATOCERA_ROOMS);
		await panel.getByRole('button', { name: 'Test connection' }).evaluate((node: HTMLElement) => node.click());
		await expect(lines.nth(1)).toHaveClass(/\bis-bad\b/);
		await expect(shown(lines.nth(1))).toHaveText('Batocera answers, but its SSH did not start within 20 seconds.');
		expect(await rooms(page, BATOCERA_ROOMS)).toEqual(before);
	});

	test('says when the box has no innoextract', async ({ page }) => {
		await box({ innoextract: false });
		const sheet = await settingsSheet(page, 'Batocera');
		const panel = sheet.locator('.bato-settings');
		const lines = panel.locator('.set-connection > li:not(.check-mac)');
		const before = await rooms(page, BATOCERA_ROOMS);
		await panel.getByRole('button', { name: 'Test connection' }).evaluate((node: HTMLElement) => node.click());
		await expect(lines.nth(2)).toHaveClass(/\bis-bad\b/);
		await expect(shown(lines.nth(2))).toHaveText('Batocera has no innoextract, which unpacking a game needs.');
		for (const [i, text] of [[3, "Free space and Batocera's version"], [4, 'EmulationStation answers']] as const) {
			await expect(shown(lines.nth(i))).toHaveText(text);
			await expect(lines.nth(i)).toHaveClass(/\bis-todo\b/);
		}
		await expect(panel.locator('.set-connection > .check-mac')).toBeHidden();
		expect(await rooms(page, BATOCERA_ROOMS)).toEqual(before);
	});

	test('ends set up when a test fails', async ({ page }) => {
		const sheet = await settingsSheet(page, 'Downloads');
		const panel = sheet.locator('.bato-settings');
		const lines = panel.locator('.set-connection > li:not(.check-mac)');
		const chip = sheet.getByRole('tabpanel').locator('.settings-panel').first().getByRole('button', { name: 'Batocera', exact: true });
		await expect(chip).not.toHaveAttribute('aria-disabled', 'true');
		await choose(sheet, 'Batocera');
		// The saved login, and the box off: nothing answers.
		await box({ on: false });
		await panel.getByRole('button', { name: 'Test connection' }).click();
		await expect(lines.nth(0)).toHaveClass(/\bis-bad\b/);
		await expect(shown(lines.nth(0))).toHaveText('Nothing answers at 127.0.0.1. Is Batocera on, and is the address right?');
		await choose(sheet, 'Downloads');
		await expect(chip).toHaveAttribute('aria-disabled', 'true');

		// A game opened from the list no longer shows Batocera.
		await page.keyboard.press('Escape');
		await expect(sheet).toBeHidden();
		await page.locator('.card', { hasText: 'Quiet Signal' }).click();
		await expect(mainButton(page)).toHaveAccessibleName('Download for Windows');
		await expect(page.locator('.dl .split-more')).toHaveCount(0);
		await expect(page.locator('.dl')).not.toContainText('Batocera');

		// The box on again, and a test that passes: set up again.
		await box({ on: true });
		await page.goto('/settings');
		await expect(sheet.locator('h1')).toHaveText('Settings');
		await choose(sheet, 'Batocera');
		await panel.getByRole('button', { name: 'Test connection' }).click();
		await expect(panel.locator('.set-connection > .check-mac')).toBeVisible();
		await choose(sheet, 'Downloads');
		await expect(chip).not.toHaveAttribute('aria-disabled', 'true');
	});

	test('never shows the password', async ({ page }) => {
		expect((await page.request.post('/api/settings/unlock', { data: { pin: '2468' } })).status()).toBe(204);
		expect((await page.request.put('/api/settings', { data: settingsBody({ password: 'Quiet $ignal 7' }) })).status()).toBe(200);
		const sheet = await settingsSheet(page, 'Batocera');
		const panel = sheet.locator('.bato-settings');
		const password = panel.locator('#bato-password');
		await expect(password).toHaveValue('');
		await expect(password).toHaveAttribute('type', 'password');
		await expect(password).toHaveAttribute('placeholder', 'Saved. Type to change it.');
		await expect(panel.locator('.set-row').nth(2)).toContainText(
			"Canvas starts with linux, Batocera's own default. With Enforce security on, Batocera shows its password under Security."
		);
		await expect(panel.locator('.set-row').nth(2).locator('b')).toHaveText('linux');
		expect(await page.content()).not.toContain('Quiet $ignal');
		expect(await (await page.request.get('/settings')).text()).not.toContain('Quiet $ignal');

		// A new one is sent once, and the box is emptied.
		await password.fill('Harbour lights 9');
		await password.press('Tab');
		await expect(sheet.locator('.settings-foot .saved')).toBeVisible();
		await expect(password).toHaveValue('');
		expect(await page.content()).not.toContain('Harbour lights');
		expect(await (await page.request.get('/api/settings')).text()).not.toContain('Harbour lights');
	});

	test('tests the wake', async ({ page }) => {
		const sheet = await settingsSheet(page, 'Batocera');
		const panel = sheet.locator('.bato-settings');
		const line = panel.locator('.set-wake > li');
		await expect(shown(line)).toHaveText('Canvas shuts Batocera down, then wakes it. Takes about a minute.');
		await expect(line).toHaveClass(/\bis-todo\b/);
		// Every text the line shows, in order.
		await page.evaluate(() => {
			const seen: string[] = [];
			(window as unknown as { seen: string[] }).seen = seen;
			const item = document.querySelector('.bato-settings .set-wake > li')!;
			const note = () => {
				const text = item.querySelector('.stack > .on')?.textContent ?? '';
				if (seen.at(-1) !== text) seen.push(text);
			};
			new MutationObserver(note).observe(item, { subtree: true, attributes: true, attributeFilter: ['class'], characterData: true, childList: true });
		});
		await panel.getByRole('button', { name: 'Test wake' }).click();
		await expect(shown(line)).toHaveText(/^Batocera woke and answered after \d+ seconds?\.$/, { timeout: 30_000 });
		await expect(line).toHaveClass(/\bis-ok\b/);
		const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
		expect(seen.slice(0, 2)).toEqual(['Batocera is shutting down…', 'Woke it, waiting for an answer…']);
		expect(seen.at(-1)).toMatch(/^Batocera woke and answered after \d+ seconds?\.$/);

		// Without a network card saved there is nothing to wake: the Canvas of the settings tests.
		await page.goto(`${process.env.CANVAS_SETTINGS_URL}/settings`);
		await expect(sheet.locator('h1')).toHaveText('Settings');
		await choose(sheet, 'Batocera');
		await expect(sheet.locator('.bato-settings').getByRole('button', { name: 'Test wake' })).toBeDisabled();
	});

	test('nothing moves when the checks fill', async ({ page }) => {
		const sheet = await settingsSheet(page, 'Batocera');
		const panel = sheet.locator('.bato-settings');
		const lines = panel.locator('.set-connection > li:not(.check-mac)');
		const at = () => rooms(page, BATOCERA_ROOMS);
		const before = await at();

		await panel.getByRole('button', { name: 'Test connection' }).evaluate((node: HTMLElement) => node.click());
		await expect(panel.locator('.set-connection > .check-mac')).toBeVisible();
		await expect(lines.nth(4)).toHaveClass(/\bis-ok\b/);
		expect(await at()).toEqual(before);

		await panel.getByRole('button', { name: 'Test wake' }).evaluate((node: HTMLElement) => node.click());
		await expect(panel.locator('.set-wake > li')).toHaveClass(/\bis-ok\b/, { timeout: 30_000 });
		expect(await at()).toEqual(before);

		// A refused login: the lines go back to waiting when the password changes, then the second one fails in its room.
		await panel.locator('#bato-password').fill('not the password');
		await panel.locator('#bato-password').press('Enter');
		await expect(lines.nth(0)).toHaveClass(/\bis-todo\b/);
		// Typing scrolled the sheet to the box: the sizes are those before, and the places are measured again.
		const typed = await at();
		expect(typed.map((room) => room.slice(2))).toEqual(before.map((room) => room.slice(2)));
		await panel.getByRole('button', { name: 'Test connection' }).evaluate((node: HTMLElement) => node.click());
		await expect(lines.nth(1)).toHaveClass(/\bis-bad\b/);
		expect(await at()).toEqual(typed);
	});
});
