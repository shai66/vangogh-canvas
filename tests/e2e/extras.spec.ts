import type { Locator } from '@playwright/test';
import { arrived, expect, place, test, UA } from './helpers';

const KEEPER_KINDS = 'Manual (4), Audio (4), Artwork (4), Wallpaper (4), Avatars (2), Video (2), Add-on (2), Comic book (2)';

/** The classes of the children of a card's row that stand on its one seen line, and of those below it. */
function lines(row: Locator): Promise<{ seen: string[]; below: string[] }> {
	return row.evaluate((node) => {
		const box = node.getBoundingClientRect();
		const kids = [...node.children].filter((k) => k.getBoundingClientRect().width > 0);
		const seen = kids.filter((k) => k.getBoundingClientRect().top < box.top + box.height);
		return {
			seen: seen.map((k) => k.className),
			below: kids.filter((k) => !seen.includes(k)).map((k) => k.className)
		};
	});
}

test.describe('the extras', () => {
	test.use({ baseURL: process.env.CANVAS_RICH_URL });

	test('show a gift and the number on the card, and name the kinds in its tooltip', async ({ page }) => {
		await page.goto('/');
		const keeper = page.locator('.card', { hasText: 'Lantern Keeper' });
		// The number, not the gift: the icon's svg is aria-hidden too.
		await expect(keeper.locator('.xtr > span[aria-hidden="true"]')).toHaveText('24');
		await expect(keeper.locator('.xtr .sr')).toHaveText('24 extras');
		await expect(keeper.locator('.xtr')).toHaveAttribute('title', `Extras: ${KEEPER_KINDS}`);
		const small = page.locator('.card', { hasText: 'Small Hours' });
		await expect(small.locator('.xtr')).toHaveAttribute('title', 'Extras: Manual, Audio');
		await expect(page.locator('.card', { hasText: 'Quiet Archive' }).locator('.xtr')).toHaveCount(0);
	});

	test('keep the fullest row on one line: co-op and multiplayer give way first, then the gift', async ({ page }) => {
		for (const width of [1440, 1280, 1100, 900, 761, 600, 390]) {
			await page.setViewportSize({ width, height: 900 });
			await page.goto('/');
			const rows = page.locator('.card-meta');
			// Every row keeps its one line, and every card its height.
			expect(new Set(await rows.evaluateAll((all) => all.map((r) => Math.round(r.getBoundingClientRect().height))))).toEqual(new Set([18]));
			expect(new Set(await page.locator('.card').evaluateAll((all) => all.map((c) => Math.round(c.getBoundingClientRect().height))))).toHaveProperty('size', 1);

			const { seen, below } = await lines(page.locator('.card', { hasText: 'Lantern Keeper' }).locator('.card-meta'));
			expect(seen).toEqual(expect.arrayContaining(['group os', 'dlc']));
			// Three systems, "12 DLC", the gift with 24, co-op and multiplayer never fit a card.
			expect(below).toContain('group people');
			// The gift goes only after the marks of playing together.
			if (below.includes('dlc xtr')) expect(below.indexOf('dlc xtr')).toBeLessThan(below.indexOf('group people'));
		}
	});

	test('are folded at first; opening shows every one, keeps the focus and moves nothing above', async ({ page }) => {
		await page.goto('/game/3101');
		const panel = page.locator('.extras');
		const head = panel.locator('.extras-head');
		await expect(head).toHaveAttribute('aria-expanded', 'false');
		await expect(panel.locator('.t .n')).toHaveText('24 files, 288 MB');
		await expect(panel.locator('.kinds')).toHaveText(KEEPER_KINDS);
		await expect(panel.locator('.file')).toHaveCount(0);
		// The sheet rises into place when it opens; measure once it has arrived.
		await arrived(page);
		const before = [await place(page, '.extras-head'), await place(page, '.dl-list'), await place(page, '.split > .btn')];

		await head.click();
		await expect(head).toHaveAttribute('aria-expanded', 'true');
		await expect(head).toBeFocused();
		// Not the one of "0 MB", and not the one that is not in the archive.
		await expect(panel.locator('.file')).toHaveCount(24);
		expect([await place(page, '.extras-head'), await place(page, '.dl-list'), await place(page, '.split > .btn')]).toEqual(before);
		const first = panel.locator('.file').first();
		await expect(first.locator('.kind')).toHaveText('Manual');
		await expect(first.locator('.name')).toHaveText('Manual 1');
		await expect(first.locator('.size')).toHaveText('12 MB');
		await expect(panel.locator('.file').last().locator('.kind')).toHaveText('Comic book');

		await head.click();
		await expect(panel.locator('.file')).toHaveCount(0);
		expect(await place(page, '.extras-head')).toEqual(before[0]);
	});

	test('download an extra with one click', async ({ page }) => {
		const names: string[] = [];
		page.on('download', (download) => names.push(download.suggestedFilename()));
		await page.goto('/game/3101');
		await page.locator('.extras-head').click();
		await page.locator('.extras .file').first().getByRole('link').click();
		await expect.poll(() => names).toEqual(['lantern_keeper_manual_1.zip']);
	});

	test('start folded again when the detail is opened again', async ({ page }) => {
		await page.goto('/?q=lantern');
		await page.locator('.card').first().click();
		await page.locator('.extras-head').click();
		await expect(page.locator('.extras .file')).toHaveCount(24);
		await page.keyboard.press('Escape');
		await expect(page.locator('dialog.detail')).toBeHidden();
		await page.locator('.card').first().click();
		await expect(page.locator('.extras-head')).toHaveAttribute('aria-expanded', 'false');
	});

	test('have no panel for a game without extras', async ({ page }) => {
		await page.goto('/game/3103');
		await expect(page.locator('.dl-list')).toBeVisible();
		await expect(page.locator('.extras')).toHaveCount(0);
	});

	test.describe('on a phone', () => {
		test.use({ userAgent: UA.phone, viewport: { width: 390, height: 844 } });

		test('are there without the files, the kinds as icons, and fit the screen', async ({ page }) => {
			await page.goto('/game/3101');
			await expect(page.getByRole('button', { name: 'Show the files anyway' })).toBeVisible();
			await page.locator('.extras-head').click();
			const first = page.locator('.extras .file').first();
			await expect(first.locator('.kind .ic')).toBeVisible();
			// Visually hidden, not removed: the word still reads for a screen reader and takes no room.
			const word = first.locator('.kind > span');
			await expect(word).toHaveText('Manual');
			expect((await word.boundingBox())!.width).toBeLessThanOrEqual(1);
			// A finger reaches the download button.
			const button = (await first.getByRole('link').boundingBox())!;
			expect(button.height).toBeGreaterThanOrEqual(44);
			expect(await page.locator('dialog.detail').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
		});
	});
});
