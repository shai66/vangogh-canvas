import { arrived, expect, place, test, UA } from './helpers';

test.describe('the system requirements', () => {
	test.use({ baseURL: process.env.CANVAS_RICH_URL });

	test('start on the system of the download block, with the minimum and the recommended', async ({ page }) => {
		await page.goto('/game/3101');
		const reqs = page.locator('.reqs');
		await expect(reqs.locator('h3')).toHaveText('System requirements');
		await expect(reqs.getByRole('tab')).toHaveText(['Windows', 'macOS', 'Linux']);
		await expect(reqs.getByRole('tab', { selected: true })).toHaveText('Windows');
		await expect(reqs.locator('h4')).toHaveText(['Minimum', 'Recommended']);
		const minimum = reqs.locator('.req-group').first();
		await expect(minimum.locator('dt')).toHaveText(['System', 'Processor', 'Memory']);
		// The empty row is left out, and the label GOG repeats in the text is taken away.
		await expect(minimum.locator('dd')).toHaveText(['Windows 10', 'Dual core 2 GHz', '4 GB RAM']);
	});

	test('change with their own tabs, leave the download block alone, and move nothing', async ({ page }) => {
		await page.goto('/game/3101');
		const reqs = page.locator('.reqs');
		const tabs = () => Promise.all([0, 1, 2].map((i) => place(page, `.req-tabs [role="tab"]:nth-child(${i + 1})`)));
		// Let the detail finish opening, and scroll first: either would move the tabs by itself.
		await arrived(page);
		await reqs.evaluate((node) => node.scrollIntoView({ block: 'center' }));
		const before = await tabs();
		await reqs.getByRole('tab', { name: 'macOS' }).click();
		await expect(reqs.getByRole('tab', { selected: true })).toHaveText('macOS');
		await expect(reqs.locator('h4')).toHaveText(['Minimum']);
		await expect(reqs.locator('dd')).toHaveText(['macOS 12', '8 GB RAM']);
		expect(await tabs()).toEqual(before);
		await expect(page.locator('.dl').getByRole('button', { name: 'Download for Windows' })).toBeVisible();
		await expect(page.locator('.dl-list').getByRole('tab', { selected: true })).toContainText('Windows');
	});

	test('hold the same height for every system, so a detail scrolled to its foot moves nothing', async ({ page }) => {
		await page.goto('/game/3101');
		await arrived(page);
		const reqs = page.locator('.reqs');
		const height = () => reqs.evaluate((node) => Math.round(node.getBoundingClientRect().height * 10) / 10);
		const tabs = () => Promise.all([0, 1, 2].map((i) => place(page, `.req-tabs [role="tab"]:nth-child(${i + 1})`)));
		const heights: number[] = [];
		for (const name of ['Windows', 'macOS', 'Linux']) {
			await reqs.getByRole('tab', { name }).click();
			await expect(reqs.getByRole('tab', { selected: true })).toHaveText(name);
			heights.push(await height());
		}
		expect(new Set(heights).size).toBe(1);

		// To the foot of the detail: a shorter system must not shrink the layer and shift the tabs.
		await reqs.getByRole('tab', { name: 'Windows' }).click();
		await page.locator('dialog.detail').evaluate((node) => (node.scrollTop = node.scrollHeight));
		const before = await tabs();
		await reqs.getByRole('tab', { name: 'macOS' }).click();
		await expect(reqs.locator('dd')).toHaveText(['macOS 12', '8 GB RAM']);
		expect(await tabs()).toEqual(before);
	});

	test('follow the download block when it shows another system, and only then', async ({ page }) => {
		await page.goto('/game/3101');
		const reqs = page.locator('.reqs');
		const files = page.locator('.dl-list');
		await reqs.getByRole('tab', { name: 'macOS' }).click();
		// The menu of the switch, opened and closed, changes nothing.
		await page.locator('.dl').getByRole('button', { name: 'Download for another system' }).click();
		await page.keyboard.press('Escape');
		await expect(reqs.getByRole('tab', { selected: true })).toHaveText('macOS');

		await files.getByRole('tab', { name: 'Linux' }).click();
		await expect(reqs.getByRole('tab', { selected: true })).toHaveText('Linux');
		await expect(reqs.locator('.plain')).toHaveText('GOG lists none for Linux.');
		// Back on Windows: the old pick does not come back.
		await files.getByRole('tab', { name: 'Windows' }).click();
		await expect(reqs.getByRole('tab', { selected: true })).toHaveText('Windows');
	});

	test('move between systems with the arrow keys', async ({ page }) => {
		await page.goto('/game/3101');
		const reqs = page.locator('.reqs');
		await reqs.getByRole('tab', { selected: true }).focus();
		await page.keyboard.press('ArrowRight');
		await expect(reqs.getByRole('tab', { selected: true })).toHaveText('macOS');
		await expect(reqs.getByRole('tab', { selected: true })).toBeFocused();
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('ArrowLeft');
		await expect(reqs.getByRole('tab', { selected: true })).toHaveText('Linux');
	});

	test('start on the visitor\'s system again when the detail is opened again', async ({ page }) => {
		await page.goto('/?q=lantern');
		await page.locator('.card').first().click();
		await page.locator('.reqs').getByRole('tab', { name: 'macOS' }).click();
		await page.keyboard.press('Escape');
		await expect(page.locator('dialog.detail')).toBeHidden();
		await page.locator('.card').first().click();
		await expect(page.locator('.reqs').getByRole('tab', { selected: true })).toHaveText('Windows');
	});

	test('are left out for a game GOG lists none for', async ({ page }) => {
		await page.goto('/game/3103');
		await expect(page.locator('.dl-list')).toBeVisible();
		await expect(page.locator('.reqs')).toHaveCount(0);
	});

	test.describe('on a phone', () => {
		test.use({ userAgent: UA.phone, viewport: { width: 390, height: 844 } });

		test('start on the first system the game has files for, and fit the screen', async ({ page }) => {
			await page.goto('/game/3101');
			await expect(page.locator('.reqs').getByRole('tab', { selected: true })).toHaveText('Windows');
			expect(await page.locator('dialog.detail').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
		});
	});
});
