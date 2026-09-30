import { expect, test } from './helpers';

test.describe('when there is no library yet', () => {
	test.use({ baseURL: process.env.CANVAS_EMPTY_URL });

	test('says that the library is being prepared, on every address', async ({ page }) => {
		for (const path of ['/', '/game/1001', '/?q=road']) {
			await page.goto(path);
			await expect(page.locator('h1')).toHaveText('The library is being prepared');
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
