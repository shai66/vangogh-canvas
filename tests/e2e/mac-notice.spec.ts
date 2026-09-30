import type { Page } from '@playwright/test';
import { expect, test, UA } from './helpers';
import { MAC_NOTICE } from './setup';

const GOG_SAYS = `GOG says: ${MAC_NOTICE}`;
const UNLISTED = 'GOG does not list this game for macOS. The installer may not work on a current Mac.';
const HAS_NOTICE = 'There is a notice about this installer';

/**
 * Where the main button, its switch, the text beside it and the note are and how large,
 * and where the file list begins, to the tenth of a pixel. The list is as high as its
 * files are many.
 */
function places(page: Page): Promise<number[][]> {
	return page.evaluate(() =>
		['.split > .btn', '.split-more', '.about', '.dl-main .caution', '.dl-list'].map((selector) => {
			const box = document.querySelector(selector)!.getBoundingClientRect();
			const size = selector === '.dl-list' ? [box.width] : [box.width, box.height];
			return [box.left, box.top, ...size].map((n) => Math.round(n * 10) / 10);
		})
	);
}

/** The sheet rises into place when it opens. Measure once it has arrived. */
function arrived(page: Page): Promise<unknown> {
	return page.locator('dialog.detail').evaluate((node) =>
		Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished))
	);
}

test.describe('the note about an old macOS installer', () => {
	test.use({ baseURL: process.env.CANVAS_MAC_URL });

	test('stays out of sight on Windows, and takes the room kept for it when macOS is chosen', async ({ page }) => {
		await page.goto('/game/2101');
		const block = page.locator('.dl');
		const note = block.locator('.dl-main .caution');
		const arrow = block.getByRole('button', { name: 'Download for another system' });
		await expect(block.getByRole('button', { name: 'Download for Windows' })).toHaveClass(/btn-primary/);
		await expect(note).toBeHidden();
		await arrived(page);
		const before = await places(page);

		await arrow.click();
		await expect(block.getByRole('menuitemradio', { name: 'macOS' })).toContainText(HAS_NOTICE);
		await expect(block.getByRole('menuitemradio', { name: 'Windows' })).not.toContainText(HAS_NOTICE);
		await expect(block.locator('.menu .flag')).toHaveClass(/is-sure/);
		await block.getByRole('menuitemradio', { name: 'macOS' }).click();

		await expect(note).toBeVisible();
		await expect(note).toHaveText(GOG_SAYS);
		await expect(note).toHaveClass(/is-sure/);
		// Yellow says "press this", and GOG says that it will not work.
		await expect(block.getByRole('button', { name: 'Download for macOS' })).not.toHaveClass(/btn-primary/);
		await expect(arrow).not.toHaveClass(/btn-primary/);
		// Said once: not with the files too.
		await expect(page.getByRole('tab', { selected: true })).toContainText('macOS');
		await expect(block.locator('.dl-list .caution')).toHaveCount(0);
		// Windows has two parts and a longer text beside the button, macOS one file: nothing moved.
		expect(await places(page)).toEqual(before);

		await arrow.click();
		await block.getByRole('menuitemradio', { name: 'Windows' }).click();
		await expect(note).toBeHidden();
		await expect(block.getByRole('button', { name: 'Download for Windows' })).toHaveClass(/btn-primary/);
		expect(await places(page)).toEqual(before);
	});

	test('stands with the macOS files while the button is on another system', async ({ page }) => {
		await page.goto('/game/2101');
		const block = page.locator('.dl');
		await expect(block.locator('.dl-list .caution')).toHaveCount(0);
		await page.getByRole('tab', { name: 'macOS' }).click();
		await expect(block.locator('.dl-list .caution')).toHaveText(GOG_SAYS);
		await expect(block.locator('.dl-main .caution')).toBeHidden();
		await expect(block.getByRole('button', { name: 'Download for Windows' })).toHaveClass(/btn-primary/);
		await page.getByRole('tab', { name: 'Windows' }).click();
		await expect(block.locator('.dl-list .caution')).toHaveCount(0);
	});

	test('says in its own words that GOG does not list the game for macOS, and leaves the button yellow', async ({ page }) => {
		await page.goto('/game/2102');
		const block = page.locator('.dl');
		await block.getByRole('button', { name: 'Download for another system' }).click();
		await expect(block.getByRole('menuitemradio', { name: 'macOS' })).toContainText(HAS_NOTICE);
		await expect(block.locator('.menu .flag')).not.toHaveClass(/is-sure/);
		await block.getByRole('menuitemradio', { name: 'macOS' }).click();
		const note = block.locator('.dl-main .caution');
		await expect(note).toHaveText(UNLISTED);
		await expect(note).not.toHaveClass(/is-sure/);
		await expect(block.getByRole('button', { name: 'Download for macOS' })).toHaveClass(/btn-primary/);
	});

	test('wraps in a narrow window instead of widening the sheet', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 800 });
		await page.goto('/game/2101');
		const block = page.locator('.dl');
		await block.getByRole('button', { name: 'Download for another system' }).click();
		await block.getByRole('menuitemradio', { name: 'macOS' }).click();
		await expect(block.locator('.dl-main .caution')).toBeVisible();
		expect(await page.locator('dialog.detail').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
	});

	test.describe('on a Mac', () => {
		test.use({ userAgent: UA.macos });

		test('keeps the sign in the menu on the line of the name, also in a narrow window', async ({ page }) => {
			for (const width of [1440, 700]) {
				await page.setViewportSize({ width, height: 900 });
				await page.goto('/game/2101');
				const block = page.locator('.dl');
				await block.getByRole('button', { name: 'Download for another system' }).click();
				const row = block.getByRole('menuitemradio', { name: 'macOS' });
				const flag = (await row.locator('.flag').boundingBox())!;
				const here = (await row.locator('.here').boundingBox())!;
				if (width > 760) {
					// Wide: the name, the sign, "This computer", on one line.
					expect(flag.x + flag.width).toBeLessThanOrEqual(here.x);
					expect(flag.y).toBeLessThan(here.y + here.height);
					expect(flag.y + flag.height).toBeGreaterThan(here.y);
				} else {
					// Narrow: "This computer" has a line of its own, and the sign stays above it.
					expect(flag.y + flag.height).toBeLessThanOrEqual(here.y + 1);
				}
			}
		});

		test('shows the words of GOG under a quiet button, which still downloads', async ({ page }) => {
			await page.goto('/game/2101');
			const block = page.locator('.dl');
			const note = block.locator('.dl-main .caution');
			await expect(note).toHaveText(GOG_SAYS);
			const button = block.getByRole('button', { name: 'Download for macOS' });
			await expect(button).not.toHaveClass(/btn-primary/);
			await expect(page.getByRole('tab', { selected: true })).toContainText('macOS');
			await expect(block.locator('.dl-list .caution')).toHaveCount(0);

			const names: string[] = [];
			page.on('download', (download) => names.push(download.suggestedFilename()));
			await button.click();
			await expect(block.locator('.notice-done')).toContainText('open old_mac_game_1.0.pkg and follow the installer.');
			await expect.poll(() => names).toEqual(['old_mac_game_1.0.pkg']);
			// The note stays after the click.
			await expect(note).toBeVisible();
		});

		test('shows the quieter note under a yellow button when GOG says nothing', async ({ page }) => {
			await page.goto('/game/2102');
			const block = page.locator('.dl');
			await expect(block.locator('.dl-main .caution')).toHaveText(UNLISTED);
			await expect(block.getByRole('button', { name: 'Download for macOS' })).toHaveClass(/btn-primary/);
		});
	});

	test.describe('on a phone', () => {
		test.use({ userAgent: UA.phone, viewport: { width: 390, height: 844 } });

		test('stands with the macOS files, and fits the screen', async ({ page }) => {
			await page.goto('/game/2101');
			await page.getByRole('button', { name: 'Show the files anyway' }).click();
			await expect(page.locator('.caution')).toHaveCount(0);
			await page.getByRole('tab', { name: 'macOS' }).click();
			await expect(page.locator('.dl-list .caution')).toHaveText(GOG_SAYS);
			expect(await page.locator('dialog.detail').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
		});
	});
});
