import type { Page } from '@playwright/test';
import { expect, reach, test, UA } from './helpers';

test.describe('on a phone, the page does not zoom or keep a pointer look', () => {
	test.use({ userAgent: UA.phone, viewport: { width: 390, height: 844 }, hasTouch: true });

	test('the search box has text of 16 px: a phone zooms into a field with smaller text', async ({ page }) => {
		await page.goto('/');
		expect(await page.locator('.search input').evaluate((node) => getComputedStyle(node).fontSize)).toBe('16px');
		expect((await reach(page, page.locator('.search input'))).height).toBe(44);
	});

	test('held sideways, the phone gets the wide bar and still 16 px in the search box', async ({ page }) => {
		await page.setViewportSize({ width: 844, height: 390 });
		await page.goto('/');
		expect(await page.locator('.search input').evaluate((node) => getComputedStyle(node).fontSize)).toBe('16px');
	});

	test('the genres in a game are a step smaller than the systems', async ({ page }) => {
		await page.goto('/game/1001');
		const facts = page.locator('dialog.detail .detail-info .facts');
		expect(await facts.nth(0).evaluate((node) => getComputedStyle(node).fontSize)).toBe('13px');
		expect(await facts.nth(1).evaluate((node) => getComputedStyle(node).fontSize)).toBe('12.5px');
	});

	test('the filter panel fills the screen', async ({ page }) => {
		await page.goto('/');
		await page.locator('.filter-button').click();
		const panel = page.locator('dialog.filters');
		await expect(panel).toBeVisible();
		expect(await panel.evaluate((node) => Math.round(node.getBoundingClientRect().width))).toBe(390);
	});

	test('a file row that was touched does not light its button', async ({ page }) => {
		await page.goto('/game/1001');
		await page.getByRole('button', { name: 'Show the files anyway' }).click();
		const row = page.locator('.dl-list .file').first();
		await row.locator('.name').hover();
		expect(await row.locator('.icon-btn').evaluate((node) => getComputedStyle(node).color)).toBe('rgb(166, 174, 196)');
	});

	test('a card that was touched shows no ring; a card reached by the keyboard does', async ({ page }) => {
		await page.goto('/');
		const ring = (n: number) => page.locator('.grid > .card .poster').nth(n).evaluate((node) => getComputedStyle(node, '::after').opacity);
		// A touch leaves the card "pointed at" until the next touch: the ring is drawn only where a pointer can point.
		await page.locator('.grid > .card').first().hover();
		await page.waitForTimeout(300);
		expect(await ring(0)).toBe('0');

		await page.getByLabel('Search the library').press('ArrowDown');
		await expect(page.locator('.grid > .card').first()).toBeFocused();
		await expect.poll(() => ring(0)).toBe('1');
	});
});

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
		expect.soft((await reach(page, page.locator('.status .glance-count'))).height).toBeGreaterThanOrEqual(40);

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

	test('in the system requirements', async ({ page }) => {
		await page.goto(process.env.CANVAS_RICH_URL + '/game/3101');
		const tabs = page.locator('.req-tabs button');
		expect(await tabs.count()).toBeGreaterThan(1);
		await tabs.first().evaluate((node) => node.scrollIntoView({ block: 'center' }));
		for (let i = 0; i < (await tabs.count()); i++) expect.soft((await reach(page, tabs.nth(i))).height, `tab ${i}`).toBeGreaterThanOrEqual(44);
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
