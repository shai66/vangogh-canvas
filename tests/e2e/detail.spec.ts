import type { Page } from '@playwright/test';
import { expect, place, test, UA } from './helpers';
import { LONG_TITLE } from './setup';

/**
 * Where the main button, its switch and the text beside it are and how large, and where
 * the file list begins, to the tenth of a pixel. The list is as high as its files are many.
 */
function places(page: Page): Promise<number[][]> {
	return page.evaluate(() =>
		['.split > .btn', '.split-more', '.about', '.dl-list'].map((selector) => {
			const box = document.querySelector(selector)!.getBoundingClientRect();
			const size = selector === '.dl-list' ? [box.width] : [box.width, box.height];
			return [box.left, box.top, ...size].map((n) => Math.round(n * 10) / 10);
		})
	);
}

test.describe('the game detail', () => {
	test('opens over the list on a click, with an address of its own, and Esc brings the list back', async ({ page }) => {
		await page.goto('/?q=road');
		const card = page.locator('.card', { hasText: 'The Long Dark Road' });
		await card.click();

		const detail = page.locator('dialog.detail');
		await expect(detail).toBeVisible();
		await expect(page).toHaveURL(/\/game\/1001$/);
		await expect(page).toHaveTitle('The Long Dark Road | Canvas for vangogh');
		await expect(detail.locator('h1')).toHaveText('The Long Dark Road');
		await expect(detail.locator('.detail-makers')).toHaveText('Šťastný Studio, published by Road Works, 2002 · GOG.com');
		await expect(detail.locator('.relation')).toHaveText('Part of Road Trilogy');
		// The list is still there, behind the sheet.
		await expect(page.locator('.card')).toHaveCount(1);

		await page.keyboard.press('Escape');
		await expect(detail).toBeHidden();
		await expect(page).toHaveURL(/\/\?q=road$/);
		await expect(page).toHaveTitle('Canvas for vangogh');
		await expect(card).toBeFocused();
	});

	test('closes with the back button, with its own button, and with a click beside it', async ({ page }) => {
		await page.goto('/');
		const detail = page.locator('dialog.detail');
		const open = () => page.locator('.card', { hasText: 'Windows Only Game' }).click();

		await open();
		await expect(detail).toBeVisible();
		await page.goBack();
		await expect(detail).toBeHidden();

		await open();
		await detail.getByRole('button', { name: 'Close' }).click();
		await expect(detail).toBeHidden();

		await open();
		await expect(detail).toBeVisible();
		await page.mouse.click(8, 450);
		await expect(detail).toBeHidden();
		await expect(page).toHaveURL(/\/$/);
	});

	test('stays open when text in it is selected and the mouse is let go beside it', async ({ page }) => {
		await page.goto('/game/1002');
		const detail = page.locator('dialog.detail');
		await detail.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)));
		const title = (await detail.locator('h1').boundingBox())!;
		await page.mouse.move(title.x + 4, title.y + title.height / 2);
		await page.mouse.down();
		await page.mouse.move(8, 450, { steps: 8 });
		await page.mouse.up();
		// A pause, to let the sheet close if it were going to.
		await page.waitForTimeout(300);
		await expect(detail).toBeVisible();
		await expect(page).toHaveURL(/\/game\/1002$/);

		// A plain click beside it still closes it.
		await page.mouse.click(8, 450);
		await expect(detail).toBeHidden();
		await expect(page).toHaveURL(/\/$/);
	});

	test('opens from a link, and closing it leaves the list', async ({ page }) => {
		await page.goto('/game/1002');
		const detail = page.locator('dialog.detail');
		await expect(detail.locator('h1')).toHaveText('Windows Only Game');
		// GOG names no year of release for it: the makers stand alone.
		await expect(detail.locator('.detail-makers')).toHaveText('Small Team');
		await expect(page.locator('.card')).toHaveCount(7);
		await page.keyboard.press('Escape');
		await expect(detail).toBeHidden();
		await expect(page).toHaveURL(/\/$/);
	});

	test('follows the address when going back and forward', async ({ page }) => {
		await page.goto('/');
		await page.getByLabel('Search the library').fill('road');
		await page.locator('.card').first().click();
		const detail = page.locator('dialog.detail');
		await expect(detail).toBeVisible();

		await page.goBack();
		await expect(detail).toBeHidden();
		await expect(page.getByLabel('Search the library')).toHaveValue('road');
		await expect(page.locator('.card')).toHaveCount(1);

		await page.goForward();
		await expect(detail).toBeVisible();
		await expect(detail.locator('h1')).toHaveText('The Long Dark Road');
		await expect(page).toHaveURL(/\/game\/1001$/);

		await page.goBack();
		await page.getByLabel('Search the library').fill('');
		await expect(page.locator('.card')).toHaveCount(7);
		await expect(page).toHaveURL(/\/$/);
	});

	test.describe('going back to it from a real page', () => {
		const box = (page: Page) => page.getByLabel('Search the library');
		const detail = (page: Page) => page.locator('dialog.detail');

		/** Opens the game of the search "road", then searches for one of its tags. */
		async function roadThenTag(page: Page) {
			await box(page).fill('road');
			await page.locator('.card', { hasText: 'The Long Dark Road' }).click();
			await expect(detail(page)).toBeVisible();
			await detail(page).getByRole('button', { name: 'Turn-Based' }).click();
			await expect(detail(page)).toBeHidden();
			await expect(box(page)).toHaveValue('Turn-Based');
		}

		test('shows the detail again, over the list that was left', async ({ page }) => {
			await page.goto('/');
			await roadThenTag(page);
			await page.goBack();
			await expect(page).toHaveURL(/\/game\/1001$/);
			await expect(detail(page)).toBeVisible();
			await expect(box(page)).toHaveValue('road');
			await expect(page.locator('.card')).toHaveCount(1);
		});

		test('and Esc then shows that list', async ({ page }) => {
			await page.goto('/');
			await roadThenTag(page);
			await page.goBack();
			await expect(detail(page)).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(detail(page)).toBeHidden();
			await expect(page).toHaveURL(/\/\?q=road$/);
			await expect(box(page)).toHaveValue('road');
			await expect(page.locator('.card')).toHaveCount(1);
		});

		test('keeps a filter of the list that was left', async ({ page }) => {
			await page.goto('/');
			await page.getByRole('button', { name: 'Filters' }).click();
			const panel = page.locator('dialog.filters');
			await panel.getByRole('button', { name: /^Role-playing/ }).click();
			await panel.getByRole('button', { name: 'Show 1 game' }).click();
			await expect(panel).toBeHidden();
			await page.locator('.card', { hasText: 'The Long Dark Road' }).click();
			await detail(page).getByRole('button', { name: 'Turn-Based' }).click();
			await expect(detail(page)).toBeHidden();

			await page.goBack();
			await expect(detail(page)).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(detail(page)).toBeHidden();
			await expect(page).toHaveURL(/\/\?genre=Role-playing$/);
			await expect(page.locator('.active-chip')).toHaveText(['Role-playingRemove the filter Role-playing']);
			await expect(page.locator('.card')).toHaveCount(1);
		});

		test('shows the list that was left after a reload of the detail', async ({ page }) => {
			await page.goto('/');
			await box(page).fill('road');
			await page.locator('.card', { hasText: 'The Long Dark Road' }).click();
			await expect(detail(page)).toBeVisible();
			await page.reload();
			await expect(detail(page)).toBeVisible();

			await page.goBack();
			await expect(page).toHaveURL(/\/\?q=road$/);
			await expect(detail(page)).toBeHidden();
			await expect(box(page)).toHaveValue('road');
			await expect(page.locator('.card')).toHaveCount(1);
		});

		test('follows a list that was changed after the detail was closed, through Forward and a tag', async ({ page }) => {
			await page.goto('/');
			await box(page).fill('road');
			await page.locator('.card', { hasText: 'The Long Dark Road' }).click();
			await expect(detail(page)).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(detail(page)).toBeHidden();
			await box(page).fill('roa');
			await expect(page).toHaveURL(/\/\?q=roa$/);

			await page.goForward();
			await expect(detail(page)).toBeVisible();
			await detail(page).getByRole('button', { name: 'Turn-Based' }).click();
			await expect(box(page)).toHaveValue('Turn-Based');
			await page.goBack();
			await expect(detail(page)).toBeVisible();
			// Behind the sheet: the list the visitor last saw under it.
			await expect(box(page)).toHaveValue('roa');
			await expect(page.locator('.card')).toHaveCount(1);

			await page.keyboard.press('Escape');
			await expect(detail(page)).toBeHidden();
			await expect(page).toHaveURL(/\/\?q=roa$/);
			await expect(box(page)).toHaveValue('roa');
			await expect(page.locator('.card')).toHaveCount(1);
		});

		test('shows the list of the address when a change could not be written before Forward', async ({ page }) => {
			await page.goto('/');
			await box(page).fill('road');
			await page.locator('.card', { hasText: 'The Long Dark Road' }).click();
			await expect(detail(page)).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(detail(page)).toBeHidden();
			// Forward before the pause is over: the sheet comes back and the change is not written.
			await box(page).fill('zzz');
			await page.goForward();
			await expect(detail(page)).toBeVisible();

			await page.keyboard.press('Escape');
			await expect(detail(page)).toBeHidden();
			await expect(page).toHaveURL(/\/\?q=road$/);
			await expect(box(page)).toHaveValue('road');
			await expect(page.locator('.card')).toHaveCount(1);
		});

		test('shows the detail again when a platform is remembered', async ({ page }) => {
			await page.goto('/');
			await page.locator('.os-toggle').getByRole('button', { name: 'Windows' }).click();
			await page.goto('/');
			await expect(page).toHaveURL(/\/\?os=windows$/);
			await roadThenTag(page);

			await page.goBack();
			await expect(page).toHaveURL(/\/game\/1001$/);
			await expect(detail(page)).toBeVisible();
			await expect(box(page)).toHaveValue('road');
			await expect(page.locator('.os-toggle').getByRole('button', { name: 'Windows' })).toHaveAttribute('aria-pressed', 'true');
			await expect(page.locator('.card')).toHaveCount(1);
		});
	});

	test('says so when the link names a game that is not in the library', async ({ page }) => {
		for (const id of ['424242', 'constructor', '..%2Fhealthz']) {
			await page.goto(`/game/${id}`);
			await expect(page.locator('.toast')).toHaveText('This game is not in the library.');
			await expect(page.locator('dialog.detail')).toBeHidden();
			await expect(page.locator('.card')).toHaveCount(7);
		}
	});

	test('shows the description as sanitised HTML and everything else as text', async ({ page }) => {
		await page.goto('/game/1001');
		const description = page.locator('.description');
		await expect(description.locator('b')).toHaveText('long');
		await expect(description.locator('script, img')).toHaveCount(0);
	});

	test('searches for a tag when its chip is chosen', async ({ page }) => {
		await page.goto('/?os=linux');
		await page.locator('.card').first().click();
		await page.locator('dialog.detail').getByRole('button', { name: 'Turn-Based' }).click();
		await expect(page.locator('dialog.detail')).toBeHidden();
		// The platform filter is the visitor's standing setting: the tag search keeps it.
		await expect(page).toHaveURL(/\/\?q=Turn-Based&os=linux$/);
		await expect(page.locator('.os-toggle').getByRole('button', { name: 'Linux' })).toHaveAttribute('aria-pressed', 'true');
		// Two games have the tag, and one of them is for Linux.
		await expect(page.locator('.count-text')).toHaveText('1 of 7 games');
	});

	test('shows the screenshots that load, and one of them larger', async ({ page }) => {
		await page.goto('/game/1001');
		// The record names two. The archive has one.
		await expect(page.locator('.shot')).toHaveCount(1);
		await page.locator('.shot').click();
		const large = page.locator('dialog.lightbox');
		await expect(large).toBeVisible();
		await expect(large.locator('.where')).toHaveText('1 of 1');
		await page.keyboard.press('Escape');
		await expect(large).toBeHidden();
		await expect(page.locator('dialog.detail')).toBeVisible();
	});

	test('shows a record that could not be read with what is known', async ({ page }) => {
		await page.goto('/game/1003');
		const detail = page.locator('dialog.detail');
		await expect(detail.locator('h1')).toHaveText('Broken Record');
		await expect(detail.locator('.notice')).toContainText('The details of this game are not available right now.');
		await expect(detail.locator('.dl-list')).toHaveCount(0);
	});

	test('links to the game\'s page on GOG.com, in a new tab, and only where there is one', async ({ page }) => {
		await page.goto('/game/1001');
		const link = page.locator('.detail-makers .store');
		await expect(link).toHaveText('GOG.com');
		await expect(link).toHaveAttribute('href', 'https://www.gog.com/en/game/the_long_dark_road');
		await expect(link).toHaveAttribute('target', '_blank');
		await expect(link).toHaveAttribute('rel', 'noreferrer');
		await expect(link).toHaveAttribute('title', 'This game on GOG.com, in a new tab');

		await page.goto('/game/1002');
		await expect(page.locator('.detail-makers .store')).toHaveCount(0);
	});

	test('keeps the dot and the link to GOG.com together in a narrow window', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 800 });
		await page.goto('/game/1001');
		const on = page.locator('.detail-makers .store-on');
		await expect(on).toHaveText('· GOG.com');
		expect(await on.evaluate((n) => getComputedStyle(n).whiteSpace)).toBe('nowrap');
		// The dot and the link are two runs of one inline box, so they have two rectangles. Split
		// across two lines they would sit at two heights.
		const tops = await on.evaluate((node) => [...node.getClientRects()].map((r) => Math.round(r.top)));
		expect(new Set(tops).size).toBe(1);
	});

	test('says that the files are missing, and offers nothing to download', async ({ page }) => {
		await page.goto('/game/1005');
		const block = page.locator('.dl');
		await expect(block.locator('.notice-bad')).toContainText('The files of this game are missing in the archive.');
		await expect(block.locator('.dl-main, .dl-list')).toHaveCount(0);
	});

	test('names the base game of a DLC that is owned without it', async ({ page }) => {
		await page.goto('/game/2002');
		await expect(page.locator('.relation')).toHaveText('This is DLC. It needs GOG product 9999, which is not in the library.');
	});

	test('opens once on a double click, and one Esc closes it', async ({ page }) => {
		await page.goto('/');
		await page.locator('.card').first().dblclick();
		await expect(page.locator('dialog.detail')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.locator('dialog.detail')).toBeHidden();
		await expect(page).toHaveURL(/\/$/);
	});

	test('does not leave the list when it is closed twice in one moment', async ({ page }) => {
		await page.goto('/');
		await page.goto('/?q=road');
		await page.locator('.card', { hasText: 'The Long Dark Road' }).click();
		const detail = page.locator('dialog.detail');
		await expect(detail).toBeVisible();
		// Both presses in one turn of the page: the first has not taken effect when the second comes.
		await detail.getByRole('button', { name: 'Close' }).evaluate((button: HTMLElement) => {
			button.click();
			button.click();
		});
		await expect(detail).toBeHidden();
		// A pause, to let a second step back show up if there were one.
		await page.waitForTimeout(500);
		await expect(page).toHaveURL(/\/\?q=road$/);
		await expect(page.locator('.card')).toHaveCount(1);
	});
});

test.describe('the download block', () => {
	test('starts every part with one click, and says which file to open', async ({ page }) => {
		await page.goto('/game/1001');
		const block = page.locator('.dl');
		const button = block.getByRole('button', { name: 'Download for Windows' });
		await expect(block.locator('.about .on strong')).toHaveText('3 files, 7.5 GB');

		const names: string[] = [];
		page.on('download', (download) => names.push(download.suggestedFilename()));
		await button.click();
		await expect(block.locator('.notice-done')).toContainText('3 downloads have started.');
		await expect(block.locator('.notice-done code')).toHaveText('setup_the_long_dark_road_2.1.exe');
		await expect(block.getByRole('button', { name: 'Download again' })).toBeVisible();
		await expect.poll(() => names).toEqual([
			'setup_the_long_dark_road_2.1.exe',
			'setup_the_long_dark_road_2.1-1.bin',
			'setup_the_long_dark_road_2.1-2.bin'
		]);
	});

	test('starts each file once, however often and however fast the button is pressed', async ({ page }) => {
		await page.goto('/game/1001');
		let downloads = 0;
		page.on('download', () => downloads++);
		const button = page.locator('.dl-main .btn').first();
		await button.dblclick();
		await button.click({ force: true });
		await expect(page.locator('.notice-done')).toContainText('3 downloads have started.');
		await expect.poll(() => downloads).toBe(3);
		// A pause, to let a fourth show up if there were one.
		await page.waitForTimeout(1000);
		expect(downloads).toBe(3);
	});

	test('goes on starting the files when the detail is closed meanwhile', async ({ page }) => {
		await page.goto('/?q=road');
		await page.locator('.card').first().click();
		let downloads = 0;
		page.on('download', () => downloads++);
		await page.getByRole('button', { name: 'Download for Windows' }).click();
		await page.keyboard.press('Escape');
		await expect(page.locator('dialog.detail')).toBeHidden();
		await expect.poll(() => downloads).toBe(3);
	});

	test('downloads all files of another system, chosen with the switch', async ({ page }) => {
		await page.goto('/game/1001');
		const block = page.locator('.dl');
		const names: string[] = [];
		page.on('download', (download) => names.push(download.suggestedFilename()));

		const arrow = block.getByRole('button', { name: 'Download for another system' });
		await arrow.click();
		await expect(block.getByRole('menuitemradio')).toHaveText([
			'Windows This computer 3 files, 7.5 GB',
			'macOS 1 file, 7 GB',
			'Linux 1 file, 7 GB'
		]);
		await expect(block.getByRole('menuitemradio', { checked: true })).toContainText('Windows');
		await expect(block.getByRole('menuitemradio', { checked: true })).toBeFocused();

		await block.getByRole('menuitemradio', { name: 'Linux' }).click();
		await expect(block.getByRole('menu')).toHaveCount(0);
		await expect(arrow).toBeFocused();
		await expect(block.locator('.about .on strong')).toHaveText('1 file, 7 GB');
		// The file list turns to the chosen system.
		await expect(page.getByRole('tab', { selected: true })).toHaveText('Linux1 file');
		// Another system than the visitor's own: the quiet button.
		await expect(block.getByRole('button', { name: 'Download for Linux' })).not.toHaveClass(/btn-primary/);

		await block.getByRole('button', { name: 'Download for Linux' }).click();
		await expect(block.locator('.notice-done')).toContainText('The download has started.');
		await expect(block.locator('.notice-done')).toContainText('run the_long_dark_road_2_1.sh in a terminal.');
		await expect.poll(() => names).toEqual(['the_long_dark_road_2_1.sh']);
		await expect(block.getByRole('button', { name: 'Download again' })).toBeVisible();

		// Back on Windows the button is fresh, and the note still names what was started.
		await arrow.click();
		await block.getByRole('menuitemradio', { name: 'Windows' }).click();
		await expect(block.getByRole('button', { name: 'Download for Windows' })).toHaveClass(/btn-primary/);
		await expect(block.locator('.notice-done code')).toHaveText('the_long_dark_road_2_1.sh');
	});

	test('moves nothing when the switch opens, a system is chosen and a download starts', async ({ page }) => {
		await page.goto('/game/1001');
		const block = page.locator('.dl');
		const arrow = block.getByRole('button', { name: 'Download for another system' });
		// The sheet rises into place when it opens. Measure once it has arrived.
		await page.locator('dialog.detail').evaluate((node) =>
			Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished))
		);
		const before = await places(page);

		await arrow.hover();
		expect(await places(page)).toEqual(before);
		await arrow.click();
		await expect(block.getByRole('menu')).toBeVisible();
		expect(await places(page)).toEqual(before);
		// The menu lies over the page: the sheet does not grow a scrollbar of its own.
		expect(await page.locator('dialog.detail').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);

		// Windows has three files and macOS one: the text beside the button changes, its room does not.
		await block.getByRole('menuitemradio', { name: 'macOS' }).click();
		await expect(block.getByRole('button', { name: 'Download for macOS' })).toBeVisible();
		expect(await places(page)).toEqual(before);

		// The quiet "Download again" is as wide as the yellow button was.
		await block.getByRole('button', { name: 'Download for macOS' }).click();
		await expect(block.getByRole('button', { name: 'Download again' })).toBeVisible();
		const after = await places(page);
		expect(after.slice(0, 3)).toEqual(before.slice(0, 3));
	});

	test('moves nothing when a longer file list makes the sheet higher than the window', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 2000 });
		await page.goto('/game/1001');
		const sheet = page.locator('dialog.detail');
		await sheet.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)));
		// How high the sheet is with its margins, with each tab chosen.
		const needed = () => page.locator('.detail-inner').evaluate((node) => node.getBoundingClientRect().height + 48);
		await page.getByRole('tab', { name: 'macOS' }).click();
		const short = await needed();
		await page.getByRole('tab', { name: 'Windows' }).click();
		const long = await needed();
		expect(long).toBeGreaterThan(short + 40);

		// A window in which the sheet fits with the macOS tab and not with the Windows tab.
		await page.setViewportSize({ width: 1440, height: Math.round((short + long) / 2) });
		await page.getByRole('tab', { name: 'macOS' }).click();
		const scrolls = () => sheet.evaluate((node) => node.scrollHeight > node.clientHeight);
		expect(await scrolls()).toBe(false);
		// Left, top and width: the sheet grows downwards, and nothing else changes.
		const at = async () => (await Promise.all(['.detail-inner', '.split > .btn'].map((selector) => place(page, selector)))).map((p) => p.slice(0, 3));
		const before = await at();

		await page.getByRole('tab', { name: 'Windows' }).click();
		await expect(page.getByRole('tab', { selected: true })).toHaveText('Windows3 files');
		expect(await scrolls()).toBe(true);
		expect(await at()).toEqual(before);
	});

	test('scrolls the detail and not the row of tabs when the wheel turns over the tabs', async ({ page }) => {
		await page.goto('/game/1001');
		const sheet = page.locator('dialog.detail');
		const tabs = page.locator('.tabs');
		// The sheet rises into place when it opens. Measure once it has arrived.
		await sheet.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)));
		expect(await tabs.evaluate((node) => node.scrollHeight === node.clientHeight)).toBe(true);
		// A window in which the tabs are in sight and the detail can still scroll down.
		const room = await sheet.evaluate((node) => {
			const row = node.querySelector('.tabs')!.getBoundingClientRect();
			return { bottom: row.bottom, height: node.scrollHeight };
		});
		await page.setViewportSize({ width: 1440, height: Math.round(Math.min(room.bottom + 60, room.height - 120)) });
		expect(await sheet.evaluate((node) => node.scrollTop)).toBe(0);

		// The yellow line of the chosen tab lies on the line under the row.
		const bottom = (selector: string) => page.locator(selector).evaluate((node) => node.getBoundingClientRect().bottom);
		expect(await bottom('.tabs [aria-selected="true"]')).toBe(await bottom('.tabs'));

		await tabs.hover();
		await page.mouse.wheel(0, 40);
		await expect.poll(() => sheet.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
		expect(await tabs.evaluate((node) => node.scrollTop)).toBe(0);
	});

	test('downloads a file that is clicked while the parts are still being started', async ({ page }) => {
		// Each check of a file takes a second, so the start of the three parts lasts a while.
		await page.route('**/download/1001/**', async (route) => {
			if (route.request().method() === 'HEAD') await new Promise((resolve) => setTimeout(resolve, 1000));
			await route.fallback();
		});
		await page.goto('/game/1001');
		const names: string[] = [];
		page.on('download', (download) => names.push(download.suggestedFilename()));
		const button = page.getByRole('button', { name: 'Download for Windows' });
		await button.click();
		await expect(button).toBeDisabled();

		await page.getByRole('tab', { name: 'macOS' }).click();
		await page.getByRole('link', { name: 'Download the_long_dark_road_2.1.pkg' }).click();
		await expect.poll(() => names).toContain('the_long_dark_road_2.1.pkg');
		// The tab turned the button to macOS: back on Windows it is still busy with its parts.
		await page.getByRole('tab', { name: 'Windows' }).click();
		await expect(button).toBeDisabled();
		await expect.poll(() => names).toHaveLength(4);
	});

	test('closes the menu of the switch with Esc and with a click elsewhere, and leaves the detail open', async ({ page }) => {
		await page.goto('/game/1001');
		const detail = page.locator('dialog.detail');
		const block = page.locator('.dl');
		const arrow = block.getByRole('button', { name: 'Download for another system' });
		const menu = block.getByRole('menu');

		await arrow.click();
		await expect(menu).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(menu).toHaveCount(0);
		await expect(detail).toBeVisible();
		await expect(arrow).toBeFocused();
		await expect(arrow).toHaveAttribute('aria-expanded', 'false');

		await arrow.click();
		await expect(arrow).toHaveAttribute('aria-expanded', 'true');
		await detail.locator('h1').click();
		await expect(menu).toHaveCount(0);
		await expect(detail).toBeVisible();

		// With the keys alone: down opens it, down moves in it, Enter picks.
		await arrow.focus();
		await page.keyboard.press('ArrowDown');
		await expect(block.getByRole('menuitemradio', { name: 'Windows' })).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(block.getByRole('menuitemradio', { name: 'macOS' })).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(block.getByRole('button', { name: 'Download for macOS' })).toBeVisible();
		await expect(detail).toBeVisible();

		// Esc without an open menu closes the detail, as before.
		await page.keyboard.press('Escape');
		await expect(detail).toBeHidden();
	});

	test('is back on the visitor\'s system when the detail is opened again', async ({ page }) => {
		await page.goto('/?q=road');
		const block = page.locator('.dl');
		await page.locator('.card').first().click();
		await block.getByRole('button', { name: 'Download for another system' }).click();
		await block.getByRole('menuitemradio', { name: 'Linux' }).click();
		await expect(block.getByRole('button', { name: 'Download for Linux' })).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(page.locator('dialog.detail')).toBeHidden();
		await page.locator('.card').first().click();
		await expect(block.getByRole('button', { name: 'Download for Windows' })).toBeVisible();
		await expect(page.getByRole('tab', { selected: true })).toHaveText('Windows3 files');
	});

	test('turns the button to the system of a chosen tab, in the quiet style, and moves nothing', async ({ page }) => {
		await page.goto('/game/1001');
		const block = page.locator('.dl');
		await expect(block.getByRole('button', { name: 'Download for Windows' })).toHaveClass(/btn-primary/);
		// In view first: a click that has to scroll would move everything measured.
		await page.getByRole('tab', { name: 'macOS' }).scrollIntoViewIfNeeded();
		const before = await places(page);

		await page.getByRole('tab', { name: 'macOS' }).click();
		await expect(page.getByRole('tab', { selected: true })).toHaveText('macOS1 file');
		const mac = block.getByRole('button', { name: 'Download for macOS' });
		await expect(mac).toBeVisible();
		// Yellow is for this computer only.
		await expect(mac).not.toHaveClass(/btn-primary/);
		await expect(block.getByRole('button', { name: 'Download for another system' })).not.toHaveClass(/btn-primary/);
		await expect(page.locator('.about .on strong')).toHaveText('1 file, 7 GB');
		expect(await places(page)).toEqual(before);

		await page.getByRole('tab', { name: 'Windows' }).click();
		await expect(block.getByRole('button', { name: 'Download for Windows' })).toHaveClass(/btn-primary/);
		expect(await places(page)).toEqual(before);
	});

	test('has no note, and keeps no room for one, for a game that GOG says nothing against', async ({ page }) => {
		await page.goto('/game/1001');
		await expect(page.locator('.dl-list')).toBeVisible();
		await expect(page.locator('.caution')).toHaveCount(0);
		await page.getByRole('tab', { name: 'macOS' }).click();
		await expect(page.locator('.caution')).toHaveCount(0);
		await page.locator('.dl').getByRole('button', { name: 'Download for another system' }).click();
		await expect(page.locator('.menu .flag')).toHaveCount(0);
	});

	test('keeps the menu of the switch inside a narrow window', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 800 });
		await page.goto('/game/1001');
		await page.locator('.dl').getByRole('button', { name: 'Download for another system' }).click();
		const menu = await page.locator('.dl').getByRole('menu').boundingBox();
		expect(menu!.x).toBeGreaterThanOrEqual(0);
		expect(menu!.x + menu!.width).toBeLessThanOrEqual(360);
		expect(await page.locator('dialog.detail').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
	});

	test('has no switch for a game that exists for one system', async ({ page }) => {
		await page.goto('/game/1002');
		const block = page.locator('.dl');
		await expect(block.getByRole('button', { name: 'Download for Windows' })).toHaveClass(/btn-primary/);
		await expect(block.getByRole('button', { name: 'Download for another system' })).toHaveCount(0);
	});

	test('lists the files by platform, and moves between platforms with the arrow keys', async ({ page }) => {
		await page.goto('/game/1001');
		const tabs = page.getByRole('tab');
		await expect(tabs).toHaveText(['Windows3 files', 'macOS1 file', 'Linux1 file']);
		await expect(page.getByRole('tab', { selected: true })).toHaveText('Windows3 files');
		await expect(page.locator('.dl-list > div > .files .name')).toContainText(['Part 1 of 3', 'Part 2 of 3', 'Part 3 of 3']);
		await expect(page.locator('.run')).toHaveText('Open this one to install');
		await expect(page.locator('.tabs-note')).toHaveText('Version 2.1');

		await page.getByRole('tab', { selected: true }).focus();
		await page.keyboard.press('ArrowRight');
		await expect(page.getByRole('tab', { selected: true })).toHaveText('macOS1 file');
		await expect(page.getByRole('tab', { selected: true })).toBeFocused();
		await expect(page.locator('.dl-list > div > .files .fn')).toHaveText(['the_long_dark_road_2.1.pkg']);
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('ArrowLeft');
		await expect(page.getByRole('tab', { selected: true })).toHaveText('Linux1 file');
	});

	test('says next to a file that it is missing in the archive', async ({ page }) => {
		await page.goto('/game/1001');
		const dlc = page.locator('.dlc-block');
		await expect(dlc.locator('h3')).toHaveText('DLC you own');
		await dlc.getByRole('link', { name: 'Download Road Expansion' }).click();
		await expect(dlc.locator('.bad')).toHaveText('This file is missing in the archive.');
	});

	test('says that the archive is not reachable, and starts nothing', async ({ page }) => {
		await page.route('**/download/**', (route) => route.fulfill({ status: 502, body: '{"error":"archive-unreachable"}' }));
		await page.goto('/game/1001');
		let downloads = 0;
		page.on('download', () => downloads++);
		await page.getByRole('button', { name: 'Download for Windows' }).click();
		await expect(page.locator('.notice-bad')).toContainText('The archive is not reachable right now.');
		await expect(page.locator('.notice-done')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Download for Windows' })).toBeVisible();
		expect(downloads).toBe(0);
	});

	test('says that only DLC of a game is in the archive, and lists it', async ({ page }) => {
		await page.goto('/game/1007');
		const block = page.locator('.dl');
		await expect(block.locator('.notice')).toContainText('Only DLC of this game is in the archive.');
		await expect(block.locator('.notice')).toContainText('The files are listed below.');
		await expect(block.locator('.notice')).not.toContainText('exists for');
		await expect(page.locator('.dl-main')).toHaveCount(0);
		await expect(block.locator('.dl-list')).toContainText('Only Expansion');
		// Two DLC of the same name are two rows.
		await expect(block.locator('.dlc-block .file')).toHaveCount(2);
	});

	test.describe('on a Mac', () => {
		test.use({ userAgent: UA.macos });

		test('offers the Mac file of a game that has one', async ({ page }) => {
			await page.goto('/game/1001');
			await expect(page.getByRole('button', { name: 'Download for macOS' })).toBeVisible();
			await expect(page.locator('.about .on')).toContainText('1 file, 7 GB');
			await expect(page.getByRole('tab', { selected: true })).toHaveText('macOS1 file');
			await page.locator('.dl').getByRole('button', { name: 'Download for another system' }).click();
			await expect(page.getByRole('menuitemradio', { name: 'macOS' })).toContainText('This computer');
		});

		test('says that a game has no Mac file, and offers what exists with a quiet button', async ({ page }) => {
			await page.goto('/game/1002');
			const block = page.locator('.dl');
			await expect(block.locator('.notice')).toContainText('Not available for macOS.');
			await expect(block.locator('.notice')).toContainText('This game exists for Windows.');
			await expect(page.getByRole('tab', { selected: true })).toHaveText('Windows1 file');
			// Yellow is for the visitor's own system.
			const button = block.getByRole('button', { name: 'Download for Windows' });
			await expect(button).not.toHaveClass(/btn-primary/);
			await expect(block.getByRole('button', { name: 'Download for another system' })).toHaveCount(0);

			const names: string[] = [];
			page.on('download', (download) => names.push(download.suggestedFilename()));
			await button.click();
			await expect(block.locator('.notice-done')).toContainText('open setup_windows_only_game_1.0.exe. It installs the game.');
			await expect.poll(() => names).toEqual(['setup_windows_only_game_1.0.exe']);
		});
	});

	test.describe('on a phone', () => {
		test.use({ userAgent: UA.phone, viewport: { width: 390, height: 844 } });

		test('has no main button, and keeps the files out of the way until asked', async ({ page }) => {
			await page.goto('/game/1001');
			await expect(page.locator('.dl .notice')).toContainText('Installers are meant for a computer.');
			await expect(page.locator('.dl-main')).toHaveCount(0);
			await expect(page.locator('.dl-list')).toHaveCount(0);
			await page.getByRole('button', { name: 'Show the files anyway' }).click();
			await expect(page.getByRole('tab')).toHaveCount(3);
		});

		test('breaks a title of one very long word instead of being widened by it', async ({ page }) => {
			await page.goto('/game/1006');
			const detail = page.locator('dialog.detail');
			await expect(detail.locator('h1')).toHaveText(LONG_TITLE);
			expect(await detail.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
			const title = await detail.locator('h1').boundingBox();
			expect(title!.x + title!.width).toBeLessThanOrEqual(390);
		});

		test('fits the screen without scrolling sideways', async ({ page }) => {
			await page.goto('/');
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
			await page.locator('.card').first().click();
			await expect(page.locator('dialog.detail')).toBeVisible();
			expect(await page.locator('dialog.detail').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
		});
	});
});
