import { arrived, expect, place, test, UA } from './helpers';

// A Canvas with theo switched on in its settings file before it started (setup.ts), and a vangogh of its own.
test.use({ baseURL: process.env.CANVAS_THEO_URL });

declare global {
	interface Window {
		/** What the page put on the clipboard through the hidden text area, as the copy event saw it. */
		copied?: string;
	}
}

test.describe('the theo panel', () => {
	test('shows the theo command between the file list and the extras', async ({ page }) => {
		await page.goto('/game/1001');
		const panel = page.locator('.theo-panel');
		await expect(panel).toContainText('Install with theo');
		await expect(panel.locator('code')).toHaveText('theo install 1001');
		const about = panel.getByRole('link', { name: 'About theo' });
		await expect(about).toHaveAttribute('href', 'https://github.com/arelate/theo');
		await expect(about).toHaveAttribute('target', '_blank');

		await arrived(page);
		const list = (await page.locator('.dl-list').boundingBox())!;
		const box = (await panel.boundingBox())!;
		const extras = (await page.locator('.extras').boundingBox())!;
		expect(box.y).toBeGreaterThan(list.y + list.height);
		expect(box.y + box.height).toBeLessThan(extras.y);
	});

	test('leaves the panel out for a game without files, a game in another language only, and on a phone', async ({ page, browser }) => {
		await page.goto('/game/1005');
		await expect(page.locator('.notice-bad')).toContainText('The files of this game are missing in the archive.');
		await expect(page.locator('.theo-panel')).toHaveCount(0);

		await page.goto('/game/1008');
		await expect(page.locator('.dl-note')).toContainText('These files are in Deutsch.');
		await expect(page.locator('.theo-panel')).toHaveCount(0);

		const phone = await browser.newContext({
			baseURL: process.env.CANVAS_THEO_URL,
			userAgent: UA.phone,
			viewport: { width: 390, height: 844 }
		});
		try {
			const small = await phone.newPage();
			await small.goto('/game/1001');
			await expect(small.locator('.extras')).toBeVisible();
			await expect(small.locator('.theo-panel')).toHaveCount(0);
			// Not with the files shown either: a phone does not install games.
			await small.getByRole('button', { name: 'Show the files anyway' }).click();
			await expect(small.locator('.dl-list')).toBeVisible();
			await expect(small.locator('.theo-panel')).toHaveCount(0);
		} finally {
			await phone.close();
		}
	});

	test('copies the command, and the button keeps its width', async ({ page, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await page.goto('/game/1001');
		const copy = page.locator('.theo-copy');
		const label = copy.locator('.stack > .on');
		await expect(copy).toHaveAccessibleName('Copy the command');
		await expect(label).toHaveText('Copy');
		await arrived(page);
		const before = await place(page, '.theo-copy');

		await copy.evaluate((node: HTMLElement) => node.click());
		await expect(label).toHaveText('Copied');
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('theo install 1001');
		expect(await place(page, '.theo-copy')).toEqual(before);

		await expect(label).toHaveText('Copy', { timeout: 2000 });
		expect(await place(page, '.theo-copy')).toEqual(before);
	});

	test('copies without the clipboard API, as over plain HTTP', async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined });
			document.addEventListener('copy', () => {
				const field = document.activeElement;
				window.copied =
					field instanceof HTMLTextAreaElement
						? field.value.slice(field.selectionStart, field.selectionEnd)
						: String(document.getSelection());
			});
		});
		await page.goto('/game/1001');
		await page.locator('.theo-copy').click();
		await expect(page.locator('.theo-copy .stack > .on')).toHaveText('Copied');
		expect(await page.evaluate(() => window.copied)).toBe('theo install 1001');
	});

	test('shows no panel while theo is off', async ({ page }) => {
		await page.goto(`${process.env.CANVAS_URL}/game/1001`);
		await expect(page.locator('.dl-list')).toBeVisible();
		await expect(page.locator('.theo-panel')).toHaveCount(0);
	});
});
