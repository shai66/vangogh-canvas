import { expect, test } from './helpers';

test.describe('when there is no library yet', () => {
	test.use({ baseURL: process.env.CANVAS_EMPTY_URL });

	// This Canvas's vangogh is not there, so its first reading fails at once (0.10.2: it says so, not "being prepared").
	test('says that the archive cannot be read, on every address, while vangogh does not answer', async ({ page }) => {
		for (const path of ['/', '/game/1001', '/?q=road', '/glance']) {
			await expect
				.poll(async () => {
					await page.goto(path);
					return page.locator('h1').textContent();
				})
				.toBe('Canvas cannot read the archive');
			await expect(page.locator('.prepare p')).toContainText('The log of the Canvas container names the cause');
			await expect(page.locator('.card')).toHaveCount(0);
		}
	});
});

test.describe('an address that is not a page', () => {
	test('gets a plain page and a way back, not a technical one', async ({ page }) => {
		const answer = await page.goto('/no/such/page');
		expect(answer?.status()).toBe(404);
		await expect(page.locator('h1')).toHaveText('This page does not exist');
		await page.getByRole('link', { name: 'Go to the library' }).click();
		await expect(page.locator('.card')).toHaveCount(7);
	});
});
