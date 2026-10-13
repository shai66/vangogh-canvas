import { readFileSync } from 'node:fs';
import { expect, test } from './helpers';

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
