import type { Page } from '@playwright/test';
import { arrived, expect, place, test, titles, UA } from './helpers';

/** Opens the library at a glance the way a visitor does, without Playwright scrolling anything into view first. */
async function openGlance(page: Page): Promise<void> {
	await page.locator('.glance-count').evaluate((node: HTMLElement) => node.click());
	await expect(page.locator('dialog.detail .glance-inner')).toBeVisible();
	await arrived(page);
}

test.describe('the way into the library at a glance', () => {
	test.use({ baseURL: process.env.CANVAS_COLLECTIONS_URL });

	test('the count is a link with a bar chart before it, the chart on the left edge of the cards', async ({ page }) => {
		await page.goto('/');
		const link = page.locator('.status .glance-count');
		await expect(link).toHaveAttribute('href', '/glance');
		await expect(link).toHaveAttribute('title', 'Library at a glance');
		await expect(link.locator('.count-text')).toHaveText('17 games', { useInnerText: true });
		const [chartLeft] = await place(page, '.glance-count .ic');
		const [cardLeft] = await place(page, '.grid > .card');
		expect(Math.abs(chartLeft - cardLeft)).toBeLessThanOrEqual(1);
		expect((await place(page, '.glance-count'))[3]).toBe(28);
		expect((await place(page, '.status'))[3]).toBe(62);
	});

	test('pointing at it changes only colours: nothing in the count line or the grid moves', async ({ page }) => {
		await page.goto('/');
		const watched = ['.glance-count', '.count-text', '.sort button:nth-of-type(1)', '.grid > .card'];
		const before = await Promise.all(watched.map((s) => place(page, s)));
		const ground = () => page.locator('.glance-count').evaluate((node) => getComputedStyle(node).backgroundColor);
		expect(await ground()).toBe('rgba(0, 0, 0, 0)');
		await page.locator('.glance-count').hover();
		expect(await ground()).toBe('rgb(31, 42, 69)');
		expect(await Promise.all(watched.map((s) => place(page, s)))).toEqual(before);
	});

	test('it stays where it is when a filter comes and when the toggle is switched', async ({ page }) => {
		await page.goto('/');
		const spot = async () => {
			const [left, top, , height] = await place(page, '.glance-count');
			return [left, top, height, (await place(page, '.status'))[3]];
		};
		const before = await spot();
		await page.locator('.os-toggle button').first().evaluate((node: HTMLElement) => node.click());
		await expect(page.locator('.status .active-chip')).toHaveCount(1);
		expect(await spot()).toEqual(before);
		await page.locator('.view-toggle').evaluate((node: HTMLElement) => node.click());
		await expect(page.locator('.card.is-collection').first()).toBeVisible();
		expect(await spot()).toEqual(before);
	});

	test('its name begins with the count it shows, and the count is still read out beside it', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('link', { name: /^17 games\W+Library at a glance$/ })).toBeVisible();
		const status = page.locator('.status [role="status"]');
		await expect(status).toHaveText('17 games');
		await page.locator('.view-toggle').evaluate((node: HTMLElement) => node.click());
		await expect(status).toHaveText('17 games · 3 collections');
		await expect(page.getByRole('link', { name: /^17 games · 3 collections\W+Library at a glance$/ })).toBeVisible();
	});

	test('a click with a modifier key opens it in a new tab and leaves this one', async ({ page, context }) => {
		await page.goto('/');
		const [other] = await Promise.all([context.waitForEvent('page'), page.locator('.glance-count').click({ modifiers: ['ControlOrMeta'] })]);
		await other.waitForLoadState();
		await expect(other).toHaveURL(/\/glance$/);
		await expect(other.locator('dialog.detail h1')).toHaveText('Library at a glance');
		await expect(page).toHaveURL(/\/$/);
		await expect(page.locator('dialog.detail')).toBeHidden();
	});
});

test.describe('the library at a glance over the list', () => {
	test.use({ baseURL: process.env.CANVAS_COLLECTIONS_URL });

	test('a click opens it over the list at /glance, and the title of the page names it', async ({ page }) => {
		await page.goto('/');
		await openGlance(page);
		await expect(page).toHaveURL(/\/glance$/);
		await expect(page).toHaveTitle('Library at a glance | Canvas for vangogh');
		await expect(page.locator('dialog.detail h1')).toHaveText('Library at a glance');
		await expect(page.locator('.glance-head .detail-makers')).toContainText('17 games, 3 collections · as of ');
	});

	const ways: [string, (page: Page) => Promise<unknown>][] = [
		['Esc', (page) => page.keyboard.press('Escape')],
		['the cross', (page) => page.locator('dialog.detail .detail-close').click()],
		['a click beside it', (page) => page.mouse.click(60, 450)],
		['Back', (page) => page.goBack()]
	];
	for (const [how, shut] of ways) {
		test(`${how} closes it, and the list is where it was`, async ({ page }) => {
			await page.goto('/');
			await page.evaluate(() => window.scrollTo(0, 200));
			await openGlance(page);
			await shut(page);
			await expect(page.locator('dialog.detail')).toBeHidden();
			await expect(page).toHaveURL(/\/$/);
			await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(200);
		});
	}

	test('Forward opens it again', async ({ page }) => {
		await page.goto('/');
		await openGlance(page);
		await page.goBack();
		await expect(page.locator('dialog.detail')).toBeHidden();
		await page.goForward();
		await expect(page.locator('dialog.detail h1')).toHaveText('Library at a glance');
		await expect(page).toHaveURL(/\/glance$/);
	});

	test('a search typed just before the click is kept: closing shows the list it found', async ({ page }) => {
		await page.goto('/');
		await page.locator('.search input').fill('night');
		await page.locator('.glance-count').evaluate((node: HTMLElement) => node.click());
		await expect(page.locator('dialog.detail h1')).toHaveText('Library at a glance');
		await page.keyboard.press('Escape');
		await expect(page).toHaveURL(/\/\?q=night$/);
		expect(await titles(page)).toEqual(['Night Ferry']);
	});

	test('opened by its address it lies over the list, and closing it shows the list', async ({ page }) => {
		await page.goto('/glance');
		await expect(page.locator('dialog.detail h1')).toHaveText('Library at a glance');
		expect(await titles(page)).toHaveLength(17);
		await page.locator('dialog.detail .detail-close').click();
		await expect(page.locator('dialog.detail')).toBeHidden();
		await expect(page).toHaveURL(/\/$/);
	});

	test('nothing behind it moves when it opens, and its layer always has its scrollbar', async ({ page }) => {
		await page.goto('/');
		const watched = ['.brand', '.glance-count', '.sort button:nth-of-type(1)', '.grid > .card'];
		const before = await Promise.all(watched.map((s) => place(page, s)));
		await openGlance(page);
		expect(await Promise.all(watched.map((s) => place(page, s)))).toEqual(before);
		expect(await page.locator('dialog.detail').evaluate((node) => getComputedStyle(node).overflowY)).toBe('scroll');
	});
});

test.describe('what the library at a glance shows', () => {
	test.use({ baseURL: process.env.CANVAS_COLLECTIONS_URL });

	test('the space, the systems, the decades and the genres of the library', async ({ page }) => {
		await page.goto('/glance');
		const sheet = page.locator('dialog.detail');
		await expect(sheet.locator('.glance-hero')).toHaveText('about 1.9 GB');
		const space = sheet.locator('.glance-space');
		await expect(space.locator('.k')).toHaveText(['Windows', 'macOS', 'Linux', 'Extras']);
		await expect(space.locator('.v')).toHaveText(['1.6 GB', '100 MB', '200 MB', '0 MB']);
		await expect(space.locator('li').first()).toHaveAttribute('title', 'Windows: installers and DLC, 1.6 GB');
		const systems = sheet.locator('.glance-systems');
		await expect(systems.locator('.section-title span')).toHaveText('games for each');
		await expect(systems.locator('.v')).toHaveText(['16', '1', '2']);
		await expect(systems.locator('li').nth(2)).toHaveAttribute('title', '2 of 17 games for Linux');
		const decades = sheet.locator('.glance-decades');
		await expect(decades.locator('.section-title span')).toHaveText('of their first release');
		await expect(decades.locator('.lbl')).toHaveText(['1980s', '1990s', '2000s', '2010s']);
		await expect(decades.locator('.v')).toHaveText(['1', '3', '2', '11']);
		await expect(decades.locator('li').nth(3)).toHaveAttribute('title', '11 games from the 2010s');
		expect(await decades.locator('.col').nth(3).evaluate((node) => Math.round(node.getBoundingClientRect().height))).toBe(108);
		const genres = sheet.locator('.glance-genres');
		await expect(genres.locator('.section-title span')).toHaveText('the most common');
		await expect(genres.locator('.k')).toHaveText(['Adventure']);
		await expect(genres.locator('.v')).toHaveText(['17']);
	});

	test('a bar is as long as its share, and nothing shows for nothing', async ({ page }) => {
		await page.goto('/glance');
		const widths = await page.locator('.glance-systems .glance-bars').evaluate((list) =>
			[...list.querySelectorAll('li')].map((li) => {
				const track = li.querySelector('.track')!.getBoundingClientRect().width;
				return Math.round((li.querySelector('.fill')!.getBoundingClientRect().width / track) * 1000) / 10;
			})
		);
		expect(widths).toEqual([94.1, 5.9, 11.8]);
		expect(await page.locator('.glance-space .fill').nth(3).evaluate((node) => node.getBoundingClientRect().width)).toBe(0);
	});

	test('bars and columns are in the colours of the text, and Canvas night lies behind the head', async ({ page }) => {
		await page.goto('/glance');
		const look = await page.locator('dialog.detail').evaluate((sheet) => ({
			fill: getComputedStyle(sheet.querySelector('.glance-bars .fill')!).backgroundColor,
			track: getComputedStyle(sheet.querySelector('.glance-bars .track')!).backgroundColor,
			col: getComputedStyle(sheet.querySelector('.glance-cols .col')!).backgroundColor,
			night: getComputedStyle(sheet.querySelector('.glance-night')!).backgroundImage
		}));
		expect(look.fill).toBe('rgb(138, 149, 177)');
		expect(look.track).toBe('rgb(31, 42, 69)');
		expect(look.col).toBe('rgb(138, 149, 177)');
		expect(look.night).toContain('radial-gradient');
		expect(look.night).toContain('rgba(111, 160, 255, 0.2)');
	});

	test('two columns end on one line', async ({ page }) => {
		await page.goto('/glance');
		const ends = await page.locator('.glance-col').evaluateAll((columns) =>
			columns.map((column) => Math.round(column.lastElementChild!.getBoundingClientRect().bottom))
		);
		expect(ends).toHaveLength(2);
		expect(ends[0]).toBe(ends[1]);
	});
});

test.describe('the library at a glance on a phone', () => {
	test.use({ baseURL: process.env.CANVAS_COLLECTIONS_URL, userAgent: UA.phone, viewport: { width: 390, height: 844 } });

	test('the panels stand in one column, in order, and nothing is wider than the screen', async ({ page }) => {
		await page.goto('/glance');
		const boxes = await page.locator('.glance-panel').evaluateAll((panels) => panels.map((p) => [Math.round(p.getBoundingClientRect().left), Math.round(p.getBoundingClientRect().top)]));
		expect(boxes).toHaveLength(4);
		expect(new Set(boxes.map(([left]) => left)).size).toBe(1);
		for (let i = 1; i < boxes.length; i++) expect(boxes[i][1]).toBeGreaterThan(boxes[i - 1][1]);
		expect(await page.locator('dialog.detail').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
		await expect(page.locator('.glance-hero')).toHaveText('about 1.9 GB');
	});
});

test.describe('a library without years or genres', () => {
	test.use({ baseURL: process.env.CANVAS_MAC_URL });

	test('says so in place of a chart', async ({ page }) => {
		await page.goto('/glance');
		const decades = page.locator('.glance-decades');
		await expect(decades.locator('.section-title span')).toHaveText('of their first release, 2 without a year');
		await expect(decades.locator('.glance-none')).toHaveText('No year is known.');
		await expect(decades.locator('.glance-cols')).toHaveCount(0);
		const genres = page.locator('.glance-genres');
		await expect(genres.locator('.glance-none')).toHaveText('No genre is known.');
		await expect(genres.locator('.section-title span')).toHaveCount(0);
	});
});
