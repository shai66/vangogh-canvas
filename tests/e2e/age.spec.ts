import type { Page } from '@playwright/test';
import { expect, place, test, titles, UA } from './helpers';

// src/lib/server/testing/fixtures.ts: of the seven entries, The Long Dark Road (1001) is rated
// PEGI 18 and ESRB Mature 17+, Windows Only Game (1002) ESRB Teen, and the rest carry no rating.

test.describe('the chip "Hide 18+"', () => {
	test('hides the game for adults, counts as one filter, and stands in the count line', async ({ page }) => {
		await page.goto('/');
		await page.locator('.filter-button').click();
		const panel = page.locator('dialog.filters');
		const section = panel.locator('section', { has: page.getByRole('heading', { name: 'Age' }) });
		const chip = section.getByRole('button', { name: /^Hide 18\+/ });
		await expect(chip).toHaveText('Hide 18+1');
		await expect(chip).toHaveAttribute('aria-pressed', 'false');
		// The section stands after Platform and before Play together.
		const headings = panel.locator('.filters-body section h3');
		await expect(headings.nth(0)).toHaveText('Platform');
		await expect(headings.nth(1)).toHaveText('Age');
		await expect(headings.nth(2)).toHaveText('Play together');

		// The panel slides in: measure once it has arrived.
		await panel.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)));
		const before = await place(page, 'dialog.filters [aria-pressed]:has-text("Hide 18+")');
		await chip.evaluate((node) => (node as HTMLElement).click());
		await expect(chip).toHaveAttribute('aria-pressed', 'true');
		expect(await place(page, 'dialog.filters [aria-pressed]:has-text("Hide 18+")')).toEqual(before);
		await expect(panel.getByRole('button', { name: 'Show 6 games' })).toBeVisible();
		await panel.getByRole('button', { name: 'Show 6 games' }).click();

		await expect(page.locator('.count-text')).toHaveText('6 of 7 games', { useInnerText: true });
		expect(await titles(page)).not.toContain('The Long Dark Road');
		await expect(page.locator('.filter-button .count')).toHaveText('1');
		await expect(page).toHaveURL(/\/\?hide=18$/);
		await expect(page.locator('.active-chip')).toHaveText(['Hide 18+Remove the filter Hide 18+']);

		await page.getByRole('button', { name: 'Remove the filter Hide 18+' }).click();
		await expect(page.locator('.count-text')).toHaveText('7 games', { useInnerText: true });
		await expect(page).toHaveURL(/\/$/);
	});

	test('is not found by the search while hidden, and comes back with Clear all', async ({ page }) => {
		await page.goto('/?hide=18&q=road');
		expect(await titles(page)).toEqual([]);
		await expect(page.locator('.empty')).toContainText('with the filters that are on');
		await page.getByRole('button', { name: 'Clear search and filters' }).click();
		await expect(page.locator('.count-text')).toHaveText('7 games', { useInnerText: true });
		await expect(page).toHaveURL(/\/$/);
	});

	test('is remembered through a reload and by the logo, and a direct link still opens the game', async ({ page }) => {
		await page.goto('/');
		await page.locator('.filter-button').click();
		await page.locator('dialog.filters').getByRole('button', { name: /^Hide 18\+/ }).click();
		await page.locator('dialog.filters').getByRole('button', { name: 'Show 6 games' }).click();
		await expect.poll(() => page.evaluate(() => document.cookie)).toBe('canvas-view=|title|hide18');
		await page.reload();
		await expect(page.locator('.count-text')).toHaveText('6 of 7 games', { useInnerText: true });
		await page.goto('/?q=road');
		await expect(page.locator('.count-text')).toHaveText('1 of 7 games', { useInnerText: true });
		await page.locator('.brand').click();
		await expect(page).toHaveURL(/\/\?hide=18$/);
		await page.goto('/game/1001');
		await expect(page.locator('dialog.detail h1')).toHaveText('The Long Dark Road');
	});

	test('"Clear filters" in the panel switches it off and forgets it', async ({ page }) => {
		await page.goto('/?hide=18');
		await page.locator('.filter-button').click();
		await page.locator('dialog.filters').getByRole('button', { name: 'Clear filters' }).click();
		await expect(page.locator('.count-text')).toHaveText('7 games', { useInnerText: true });
		await expect.poll(() => page.evaluate(() => document.cookie)).toBe('canvas-view=|title');
	});

	test("is kept by a tag chosen in a game's detail", async ({ page }) => {
		await page.goto('/?hide=18');
		await page.locator('.card', { hasText: 'Windows Only Game' }).click();
		await page.locator('dialog.detail').getByRole('button', { name: 'Turn-Based' }).click();
		await expect(page).toHaveURL(/\/\?q=Turn-Based&hide=18$/);
		// The Long Dark Road has the tag too: without the chip it would be found.
		await expect(page.locator('.count-text')).toHaveText('1 of 7 games', { useInnerText: true });
		expect(await titles(page)).toEqual(['Windows Only Game']);
	});
});

test.describe('the chip on a phone', () => {
	test.use({ userAgent: UA.phone, viewport: { width: 390, height: 844 } });

	test('is in the panel and in the count line', async ({ page }) => {
		await page.goto('/');
		await page.locator('.filter-button').click();
		const chip = page.locator('dialog.filters').getByRole('button', { name: /^Hide 18\+/ });
		await expect(chip).toBeVisible();
		await chip.click();
		await page.locator('dialog.filters').getByRole('button', { name: 'Show 6 games' }).click();
		await expect(page.locator('.active-chip')).toHaveText(['Hide 18+Remove the filter Hide 18+']);
		// The count line stays inside the window.
		const [left, , width] = await place(page, '.active-chip');
		expect(left + width).toBeLessThanOrEqual(390);
	});
});

// setup.ts: in the collections library, Saltwater Detectives (4103), the last of the three games of
// the series Thornwick Mysteries, is rated PEGI 18.
test.describe('the chip in a collection', () => {
	test.use({ baseURL: process.env.CANVAS_COLLECTIONS_URL });

	const hide18 = (page: Page) =>
		page.context().addCookies([{ name: 'canvas-view', value: '|title|hide18', url: process.env.CANVAS_COLLECTIONS_URL! }]);

	test("a collection's sheet lists the games the chip lets through", async ({ page }) => {
		await hide18(page);
		await page.goto('/collection/s500');
		const sheet = page.locator('dialog.detail');
		await expect(sheet.locator('.detail-makers')).toHaveText('Series, 2 games in your library, 1996–1998');
		await expect(sheet.locator('.coll-grid .card .card-title')).toHaveText(['Thornwick Mysteries', 'Thornwick Mysteries 2']);
		await page.context().clearCookies();
		await page.reload();
		await expect(sheet.locator('.detail-makers')).toHaveText('Series, 3 games in your library, 1996–2001');
		await expect(sheet.locator('.coll-grid .card')).toHaveCount(3);
	});

	test("the row in a game's detail lists the games the chip lets through, and keeps the open game", async ({ page }) => {
		await hide18(page);
		await page.goto('/game/4101');
		const shelf = page.locator('dialog.detail .coll-shelf');
		await shelf.locator('button.shelf-line').click();
		await expect(shelf.locator('.shelf-card .t')).toHaveText(['Thornwick Mysteries', 'Thornwick Mysteries 2']);
		// The hidden game by a direct link: it stays in its own row.
		await page.goto('/game/4103');
		await shelf.locator('button.shelf-line').click();
		await expect(shelf.locator('.shelf-card .t')).toHaveText(['Thornwick Mysteries', 'Thornwick Mysteries 2', 'Saltwater Detectives']);
		await expect(shelf.locator('.shelf-card.is-here .t')).toHaveText('Saltwater Detectives');
	});
});

test.describe('the rating in the detail', () => {
	const facts = (page: Page) => page.locator('dialog.detail .facts').first().locator('span:not(.sep):not(.sr)');

	test('stands after the systems, one body only: PEGI, else ESRB by its age, else nothing', async ({ page }) => {
		await page.goto('/game/1001');
		await expect(facts(page)).toHaveText(['Windows', 'macOS', 'Linux', 'PEGI 18', 'Multiplayer', 'Co-op']);
		await page.goto('/game/1002');
		await expect(facts(page)).toHaveText(['Windows', 'ESRB 13+']);
		await page.goto('/game/1005');
		await expect(facts(page)).toHaveText(['Windows']);
	});

	test('wraps with the line on a phone and is not cut', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/game/1001');
		const rating = page.locator('dialog.detail .facts span', { hasText: 'PEGI 18' });
		await expect(rating).toBeVisible();
		const box = (await rating.boundingBox())!;
		expect(box.x + box.width).toBeLessThanOrEqual(390);
	});
});
