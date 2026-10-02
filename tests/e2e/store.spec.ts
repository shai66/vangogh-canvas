import { expect, test } from './helpers';

test.describe('the link to the game\'s page on GOG.com', () => {
	test.use({ baseURL: process.env.CANVAS_RICH_URL });

	test('stands alone, without a dot, when the game has no makers and no year', async ({ page }) => {
		await page.goto('/game/3103');
		const makers = page.locator('.detail-makers');
		await expect(makers).toHaveText('GOG.com');
		await expect(makers.locator('b')).toHaveCount(0);
		await expect(makers.locator('.store')).toHaveAttribute('href', 'https://www.gog.com/en/game/quiet_archive');
	});
});
