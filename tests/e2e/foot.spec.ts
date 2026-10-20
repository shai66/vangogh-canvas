import { readFileSync } from 'node:fs';
import { expect, place, test, UA } from './helpers';

/** The running version, which the rich Canvas's fake answers as the latest release (setup.ts). */
const OWN = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;

/** The check runs 10 seconds after start: wait until /healthz has the release the fake answers. */
async function checked(base: string, expected: string): Promise<void> {
	await expect
		.poll(async () => ((await (await fetch(`${base}/healthz`)).json()) as { update: { latest: string | null } | null }).update?.latest, { timeout: 20_000 })
		.toBe(expected);
}

test.describe('the notice of a newer release', () => {
	test('names the update after the version and links to the release', async ({ page, baseURL }) => {
		await checked(baseURL!, '99.0.0');
		await page.goto('/');
		const notice = page.locator('.foot .newer');
		await expect(notice).toHaveText('Update available', { useInnerText: true });
		await expect(notice).toHaveAttribute('href', 'https://github.com/shai66/vangogh-canvas/releases/tag/v99.0.0');
		await expect(notice).toHaveAttribute('target', '_blank');
		await expect(notice).toHaveAttribute('title', 'Canvas 99.0.0 is released');
		// Directly after the mark, on the mark's line.
		const mark = (await page.locator('.foot .mark').boundingBox())!;
		const box = (await notice.boundingBox())!;
		expect(box.x).toBeGreaterThan(mark.x + mark.width);
		expect(Math.abs(box.y + box.height / 2 - (mark.y + mark.height / 2))).toBeLessThan(2);
	});

	test('is not there when the running Canvas is the latest, and the foot keeps its height', async ({ page, baseURL }) => {
		await checked(process.env.CANVAS_RICH_URL!, OWN);
		await checked(baseURL!, '99.0.0');
		await page.goto(process.env.CANVAS_RICH_URL + '/');
		await expect(page.locator('.foot .mark')).toBeVisible();
		await expect(page.locator('.foot .newer')).toHaveCount(0);
		const without = (await page.locator('.foot').boundingBox())!.height;
		await page.goto('/');
		await expect(page.locator('.foot .newer')).toBeVisible();
		expect((await page.locator('.foot').boundingBox())!.height).toBe(without);
	});
});

test.describe('"Settings" in the foot, without a PIN', () => {
	test('says how to turn settings on when no PIN is set', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('.foot .links > *')).toHaveText(['Settings', 'Canvas on GitHub'], { useInnerText: true });
		const button = page.locator('.foot .settings-link');
		await expect(button).toHaveAttribute('aria-describedby', 'settings-tip');
		const tip = page.locator('#settings-tip');
		await expect(tip).toBeHidden();
		await button.scrollIntoViewIfNeeded();
		const before = await place(page, '.foot');
		await button.hover();
		await expect(tip).toBeVisible();
		await expect(tip).toContainText('SETTINGS_PIN, 4 to 8 digits');
		expect(await place(page, '.foot')).toEqual(before);
		await expect(page).toHaveURL(/\/$/);
	});

	test.describe('on a phone', () => {
		test.use({ userAgent: UA.phone, viewport: { width: 390, height: 844 } });

		test('shows the tooltip on a tap on a phone, and Esc hides it', async ({ page }) => {
			await page.goto('/');
			const tap = () => page.locator('.foot .settings-link').evaluate((node: HTMLElement) => node.click());
			const tip = page.locator('#settings-tip');
			await expect(tip).toBeHidden();
			await tap();
			await expect(tip).toBeVisible();
			// Within the screen, with room to spare on both sides.
			const [left, , width] = await place(page, '#settings-tip');
			expect(left).toBeGreaterThanOrEqual(8);
			expect(left + width).toBeLessThanOrEqual(390 - 8);
			await page.keyboard.press('Escape');
			await expect(tip).toBeHidden();
			await tap();
			await expect(tip).toBeVisible();
			await page.locator('main').click({ position: { x: 4, y: 4 } });
			await expect(tip).toBeHidden();
			await expect(page).toHaveURL(/\/$/);
		});
	});
});
