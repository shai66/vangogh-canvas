import type { Locator, Page } from '@playwright/test';
import { expect, test, UA } from './helpers';

/**
 * How many pixels of a control a finger can reach: from the middle of its box, walk
 * up and down (or left and right) while the element under that point is the control or
 * inside it. A pseudo-element of the control is hit as the control itself.
 */
async function reach(page: Page, locator: Locator): Promise<{ height: number; width: number }> {
	const handle = await locator.first().elementHandle();
	expect(handle).not.toBeNull();
	return page.evaluate((node) => {
		const box = node!.getBoundingClientRect();
		const cx = box.left + box.width / 2;
		const cy = box.top + box.height / 2;
		const hits = (x: number, y: number) => {
			const found = document.elementFromPoint(x, y);
			return !!found && (found === node || node!.contains(found));
		};
		const walk = (dx: number, dy: number) => {
			let n = 0;
			while (n < 200 && hits(cx + dx * (n + 1), cy + dy * (n + 1))) n++;
			return n;
		};
		return {
			height: 1 + walk(0, -1) + walk(0, 1),
			width: 1 + walk(-1, 0) + walk(1, 0)
		};
	}, handle);
}

async function height(page: Page, selector: string): Promise<number> {
	return page.locator(selector).first().evaluate((node) => node.getBoundingClientRect().height);
}

test.describe('on a phone, what a finger uses is high enough', () => {
	test.use({ userAgent: UA.phone, viewport: { width: 390, height: 844 } });

	test('in the bar and the list', async ({ page }) => {
		await page.goto('/');
		const toggles = page.locator('.os-toggle button');
		expect(await toggles.count()).toBe(3);
		for (let i = 0; i < 3; i++) expect.soft((await reach(page, toggles.nth(i))).height, `toggle ${i}`).toBeGreaterThanOrEqual(40);

		expect.soft((await reach(page, page.locator('.search input'))).height).toBeGreaterThanOrEqual(44);
		expect.soft((await reach(page, page.locator('.filter-button'))).height).toBeGreaterThanOrEqual(44);

		await page.locator('.search input').fill('road');
		const clear = await reach(page, page.locator('.search .clear'));
		expect.soft(clear.height).toBeGreaterThanOrEqual(44);
		expect.soft(clear.width).toBeGreaterThanOrEqual(40);
		await page.locator('.search input').fill('');

		const sort = page.locator('.sort button');
		for (let i = 0; i < (await sort.count()); i++) expect.soft((await reach(page, sort.nth(i))).height, `sort ${i}`).toBeGreaterThanOrEqual(40);

		await toggles.first().click();
		await expect(page.locator('.status .active-chip').first()).toBeVisible();
		expect.soft((await reach(page, page.locator('.status .active-chip'))).height).toBeGreaterThanOrEqual(40);
		expect.soft((await reach(page, page.locator('.status .link-button'))).height).toBeGreaterThanOrEqual(40);
	});

	test('in the filter panel', async ({ page }) => {
		await page.goto('/');
		await page.locator('.filter-button').click();
		await expect(page.locator('.filters .chip').first()).toBeVisible();
		expect.soft((await reach(page, page.locator('.filters .chip'))).height).toBeGreaterThanOrEqual(40);
		const more = page.locator('.filters .link-button');
		if ((await more.count()) > 0) expect.soft((await reach(page, more)).height).toBeGreaterThanOrEqual(40);
	});

	test('in the game detail', async ({ page }) => {
		await page.goto('/game/1001');
		const detail = page.locator('dialog.detail');
		await expect(detail).toBeVisible();
		expect.soft((await reach(page, detail.getByRole('button', { name: 'Close' }))).height).toBeGreaterThanOrEqual(44);
		await detail.locator('.side .chip').first().evaluate((node) => node.scrollIntoView({ block: 'center' }));
		expect.soft((await reach(page, detail.locator('.side .chip'))).height).toBeGreaterThanOrEqual(40);

		await page.getByRole('button', { name: 'Show the files anyway' }).evaluate((node) => node.scrollIntoView({ block: 'center' }));
		expect.soft((await reach(page, page.getByRole('button', { name: 'Show the files anyway' }))).height).toBeGreaterThanOrEqual(40);
		await page.getByRole('button', { name: 'Show the files anyway' }).click();
		const tab = page.getByRole('tab').first();
		await tab.evaluate((node) => node.scrollIntoView({ block: 'center' }));
		expect.soft((await reach(page, tab)).height).toBeGreaterThanOrEqual(40);
		const download = page.locator('.file .icon-btn').first();
		await download.evaluate((node) => node.scrollIntoView({ block: 'center' }));
		expect.soft((await reach(page, download)).height).toBeGreaterThanOrEqual(44);
	});
});

test('on a desktop the same controls keep the height they have', async ({ page }) => {
	await page.goto('/');
	expect(await height(page, '.os-toggle button')).toBe(32);
	expect(await height(page, '.search input')).toBe(40);
	await page.locator('.os-toggle button').first().click();
	await expect(page.locator('.status .active-chip').first()).toBeVisible();
	expect(await height(page, '.status .active-chip')).toBe(28);
	await page.goto('/game/1001');
	await expect(page.locator('dialog.detail')).toBeVisible();
	expect(await height(page, '.side .chip')).toBe(28);
});
