import type { Page } from '@playwright/test';
import { arrived, expect, place, test, UA } from './helpers';
import { pictureOf } from './setup';

// setup.ts gives this Canvas three own collections over the seventeen games of collectionLibrary():
//   h1  Rainy Sundays  the pack 4801, which is joined into the series 500 (4101, 4102, 4103), with Night Ferry (4117)
//                      and Quiet Harbour (4116): 5 games, 1996 to 2015
//   h2  Racing nights  the pack 4802 (4104, 4105) and Night Ferry: 3 games
//   h3  Late night     Saltwater Detectives (4103), rated PEGI 18
test.describe('own collections in the list', () => {
	test.use({ baseURL: process.env.CANVAS_OWN_URL });

	test.beforeEach(async ({ page }) => {
		await page.goto('/?view=collections');
	});

	test('shows own cards beside GOG cards, and leaves out what they hold', async ({ page }) => {
		// A to Z.
		await expect(page.locator('a.card.is-own .card-title')).toHaveText(['Late night', 'Racing nights', 'Rainy Sundays']);
		await expect(page.locator('a[href="/collection/s500"], a[href="/collection/p4802"]')).toHaveCount(0);
		await expect(page.locator('a[href="/game/4117"]')).toHaveCount(0);
	});

	test('says Hand-picked and the years', async ({ page }) => {
		// The " · " between them is drawn by the style sheet, as on GOG's cards.
		const card = page.locator('a[href="/collection/h1"]');
		await expect(card.locator('.card-genres .kind')).toHaveText('Hand-picked');
		await expect(card.locator('.card-genres .years')).toHaveText('1996–2015');
		await expect(card.locator('.coll-pill')).toHaveAttribute(
			'title',
			'Hand-picked, 5 games: Thornwick Mysteries, Thornwick Mysteries 2, Saltwater Detectives, Quiet Harbour, Night Ferry'
		);
	});

	test('draws one band per member, the series with its number', async ({ page }) => {
		const card = page.locator('a[href="/collection/h1"]');
		await expect(card.locator('.own-strip')).toHaveCount(3);
		await expect(card.locator('.own-strip-badge')).toHaveText('3');
		// Oldest first: the series by its oldest game, then Quiet Harbour and Night Ferry. The library has no wide images: the posters stand in.
		expect(await card.locator('.own-strip img').evaluateAll((all) => all.map((node) => node.getAttribute('src')))).toEqual(
			['4101', '4116', '4117'].map((id) => `/img/${pictureOf(id)}`)
		);
		// The bands share the poster's height, with 2 px of night between them.
		const [, top, , height] = await place(page, 'a[href="/collection/h1"] .poster');
		const band = (height - 2 * 2) / 3;
		const bands = await card.locator('.own-strip').evaluateAll((all) => all.map((node) => [node.getBoundingClientRect().top, node.getBoundingClientRect().height]));
		bands.forEach(([bandTop, bandHeight], i) => {
			expect(bandTop).toBeCloseTo(top + i * (band + 2), 0);
			expect(bandHeight).toBeCloseTo(band, 0);
		});
	});

	test('counts Night Ferry once', async ({ page }) => {
		// Both own cards hold Night Ferry: 5 and 3 games, 7 of them distinct.
		await page.goto('/?view=collections&q=ferry');
		await expect(page.locator('.count-text')).toContainText('7 of 17 games · 2 collections');
	});

	test('an own card is as large as a game card and moves nothing when pointed at', async ({ page }) => {
		const own = 'a[href="/collection/h1"]';
		// Lanterns of Orrin, the one game of its series, is a game's card.
		const game = 'a[href="/game/4115"]';
		expect((await place(page, own)).slice(2)).toEqual((await place(page, game)).slice(2));
		const watched = [own, `${own} .poster`, `${own} .own-strip`, `${own} .card-title`, game, '.grid > .card:last-child'];
		const measure = () => Promise.all(watched.map((s) => place(page, s)));
		const before = await measure();
		await page.locator(own).hover();
		expect(await measure()).toEqual(before);
	});
});

test.describe("an own collection's sheet", () => {
	test.use({ baseURL: process.env.CANVAS_OWN_URL });

	test('opens an own sheet from its card, with its line and members', async ({ page }) => {
		await page.goto('/?view=collections');
		await page.locator('a[href="/collection/h1"]').click();
		const sheet = page.locator('dialog.detail');
		await expect(page).toHaveURL(/\/collection\/h1$/);
		await expect(sheet.locator('h1')).toHaveText('Rainy Sundays');
		await expect(sheet.locator('.detail-makers')).toHaveText('Hand-picked, 5 games in your library, 1996–2015');
		await expect(sheet.locator('.detail-makers b')).toHaveText(['Hand-picked', '1996–2015']);
		await expect(sheet.locator('.facts span')).toHaveText(['Windows', 'macOS', 'Linux']);
		await expect(sheet.locator('.coll-body .section-title')).toHaveText('In this collection 2 games and 1 series, oldest first');
		// Oldest first: the series by its oldest game, then the games, each as its card of the list.
		await expect(sheet.locator('.coll-grid > .card .card-title')).toHaveText(['Thornwick Mysteries', 'Quiet Harbour', 'Night Ferry']);
		await expect(sheet.locator('.coll-grid > .card.is-collection')).toHaveAttribute('href', '/collection/s500');
		// The strips in the poster's place; behind the head the oldest member's game, blurred.
		await expect(sheet.locator('.detail-poster .own-strip')).toHaveCount(3);
		await expect(sheet.locator('.ambience img')).toHaveAttribute('src', `/img/${pictureOf('4101')}`);
		await expect(page).toHaveTitle('Rainy Sundays | Canvas for vangogh');

		// The series opens in the sheet's place, and closing it shows the list.
		await sheet.locator('.coll-grid a[href="/collection/s500"]').click();
		await expect(page).toHaveURL(/\/collection\/s500$/);
		await expect(sheet.locator('h1')).toHaveText('Thornwick Mysteries');
		await sheet.locator('.detail-close').click();
		await expect(sheet).toBeHidden();
		await expect(page).toHaveURL(/\/\?view=collections$/);
	});

	test('opens by its address, and Back from the series inside returns to it', async ({ page }) => {
		await page.goto('/collection/h1');
		const sheet = page.locator('dialog.detail');
		await expect(sheet.locator('h1')).toHaveText('Rainy Sundays');
		await expect(page).toHaveTitle('Rainy Sundays | Canvas for vangogh');
		await sheet.locator('.coll-grid a[href="/collection/s500"]').click();
		await expect(page).toHaveURL(/\/collection\/s500$/);
		await expect(sheet.locator('h1')).toHaveText('Thornwick Mysteries');
		await page.goBack();
		await expect(page).toHaveURL(/\/collection\/h1$/);
		await expect(sheet.locator('h1')).toHaveText('Rainy Sundays');

		// Closing the series shows the list, and Back the own sheet again.
		await page.goForward();
		await expect(sheet.locator('h1')).toHaveText('Thornwick Mysteries');
		await sheet.locator('.detail-close').click();
		await expect(sheet).toBeHidden();
		await expect(page).toHaveURL(/\/$/);
		await page.goBack();
		await expect(page).toHaveURL(/\/collection\/h1$/);
		await expect(sheet.locator('h1')).toHaveText('Rainy Sundays');
	});

	test('lists what Hide 18+ lets through, and leaves the hidden band out', async ({ page }) => {
		await page.goto('/?view=collections&hide=18');
		await page.locator('a[href="/collection/h1"]').click();
		const sheet = page.locator('dialog.detail');
		// Saltwater Detectives, rated PEGI 18, the one game for macOS, is left out.
		await expect(sheet.locator('.detail-makers')).toHaveText('Hand-picked, 4 games in your library, 1996–2015');
		await expect(sheet.locator('.facts span')).toHaveText(['Windows', 'Linux']);
		await expect(sheet.locator('.coll-grid > .card .card-title')).toHaveText(['Thornwick Mysteries', 'Quiet Harbour', 'Night Ferry']);
		await expect(sheet.locator('.coll-grid a[href="/collection/s500"] .coll-pill')).toHaveAttribute(
			'title',
			'Series of 2 games: Thornwick Mysteries, Thornwick Mysteries 2'
		);
		await expect(sheet.locator('.detail-poster .own-strip')).toHaveCount(3);
		await expect(sheet.locator('.detail-poster .own-strip-badge')).toHaveText('2');
	});

	test('an own collection whose games are all hidden has no card, and its sheet says Nothing in it yet.', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: 'Collections', exact: true }).click();
		await page.locator('.filter-button').click();
		await page.locator('dialog.filters').getByRole('button', { name: /^Hide 18\+/ }).click();
		await page.locator('dialog.filters').getByRole('button', { name: /^Show / }).click();
		await expect.poll(() => page.evaluate(() => document.cookie)).toBe('canvas-view=|title|collections|hide18');
		await expect(page.locator('a[href="/collection/h1"]')).toBeVisible();
		await expect(page.locator('a[href="/collection/h3"]')).toHaveCount(0);

		await page.goto('/collection/h3');
		const sheet = page.locator('dialog.detail');
		await expect(sheet.locator('h1')).toHaveText('Late night');
		await expect(sheet.locator('.detail-makers')).toHaveText('Hand-picked, 0 games in your library');
		await expect(sheet.locator('.coll-body .section-title')).toHaveText('In this collection');
		await expect(sheet.locator('.coll-body p')).toHaveText('Nothing in it yet.');
		await expect(sheet.locator('.coll-grid')).toHaveCount(0);
		await expect(sheet.locator('.own-strip')).toHaveCount(0);
		await expect(sheet.locator('.ambience')).toHaveCount(0);
	});

	test('an unknown h id gives the note', async ({ page }) => {
		await page.goto('/collection/h99');
		await expect(page.locator('.toast')).toHaveText('This collection is not in the library.');
		await expect(page.locator('dialog.detail')).toBeHidden();
	});
});

test.describe("own collections in a game's detail", () => {
	test.use({ baseURL: process.env.CANVAS_OWN_URL });

	test('shows a line for the series and one for each own collection, GOG first', async ({ page }) => {
		await page.goto('/game/4101');
		await expect(page.locator('.coll-shelf .shelf-line b')).toHaveText(['Thornwick Mysteries', 'Rainy Sundays']);
		await expect(page.locator('.coll-shelf').nth(1).locator('.shelf-line > span').first()).toHaveText('Hand-picked, 5 games in your library');
	});

	test('each line opens its own row, and a game opened from it has that row open', async ({ page }) => {
		await page.goto('/game/4101');
		const sheet = page.locator('dialog.detail');
		const lines = sheet.locator('.coll-shelf');
		await lines.nth(1).locator('button.shelf-line').click();
		await expect(lines.nth(1)).toHaveClass(/is-open/);
		await expect(lines.nth(0).locator('button.shelf-line')).toHaveAttribute('aria-expanded', 'false');
		// The series' games and the two games of their own, oldest first.
		await expect(lines.nth(1).locator('.shelf-card .t')).toHaveText(['Thornwick Mysteries', 'Thornwick Mysteries 2', 'Saltwater Detectives', 'Quiet Harbour', 'Night Ferry']);
		await expect(lines.nth(1).locator('.shelf-card.is-here .t')).toHaveText('Thornwick Mysteries');

		// Opened from the own row: that row is open, the series' line folded.
		await lines.nth(1).locator('a.shelf-card', { hasText: 'Thornwick Mysteries 2' }).click();
		await expect(page).toHaveURL(/\/game\/4102$/);
		await expect(sheet.locator('h1')).toHaveText('Thornwick Mysteries 2');
		await expect(lines.nth(0).locator('button.shelf-line')).toHaveAttribute('aria-expanded', 'false');
		await expect(lines.nth(1)).toHaveClass(/is-open/);
		await expect(lines.nth(1).locator('.shelf-card.is-here .t')).toHaveText('Thornwick Mysteries 2');

		// Opened from the series' row: that row is open, and each own line folded, A to Z.
		await lines.nth(0).locator('button.shelf-line').click();
		await expect(lines.nth(0).locator('.shelf-card .t')).toHaveText(['Thornwick Mysteries', 'Thornwick Mysteries 2', 'Saltwater Detectives']);
		await lines.nth(0).locator('a.shelf-card', { hasText: 'Saltwater Detectives' }).click();
		await expect(page).toHaveURL(/\/game\/4103$/);
		await expect(sheet.locator('h1')).toHaveText('Saltwater Detectives');
		await expect(lines.locator('.shelf-line b')).toHaveText(['Thornwick Mysteries', 'Late night', 'Rainy Sundays']);
		await expect(lines.nth(0)).toHaveClass(/is-open/);
		await expect(lines.nth(1).locator('button.shelf-line')).toHaveAttribute('aria-expanded', 'false');
		await expect(lines.nth(2).locator('button.shelf-line')).toHaveAttribute('aria-expanded', 'false');
	});

	test('opening a row moves only what is under it', async ({ page }) => {
		await page.goto('/game/4101');
		await arrived(page);
		const head = 'dialog.detail .detail-head';
		const first = 'dialog.detail .coll-shelf .shelf-line';
		const second = 'dialog.detail .coll-shelf + .coll-shelf .shelf-line';
		const under = 'dialog.detail .coll-shelf + .coll-shelf + *';
		const [headBefore, firstBefore, secondBefore, underBefore] = await Promise.all([head, first, second, under].map((s) => place(page, s)));
		// A folded line is one line.
		expect(firstBefore[3]).toBe(secondBefore[3]);
		await page.locator('dialog.detail .coll-shelf + .coll-shelf button.shelf-line').evaluate((node: HTMLElement) => node.click());
		await expect(page.locator('dialog.detail .coll-shelf + .coll-shelf')).toHaveClass(/is-open/);
		const [headAfter, firstAfter, secondAfter, underAfter] = await Promise.all([head, first, second, under].map((s) => place(page, s)));
		expect(headAfter).toEqual(headBefore);
		expect(firstAfter).toEqual(firstBefore);
		expect([secondAfter[0], secondAfter[1], secondAfter[3]]).toEqual([secondBefore[0], secondBefore[1], secondBefore[3]]);
		expect(underAfter[1]).toBeGreaterThan(underBefore[1]);
	});
});

test.describe('own collections without a PIN', () => {
	test.use({ baseURL: process.env.CANVAS_COLLECTIONS_URL });

	test('a Canvas without a PIN shows no own card', async ({ page }) => {
		await page.goto('/?view=collections');
		await expect(page.locator('.card.is-collection').first()).toBeVisible();
		await expect(page.locator('.is-own')).toHaveCount(0);
	});
});

/** Unlocks this browser with the PIN, as the prompt does: the cookie lands in the page's context. */
async function unlock(page: Page): Promise<void> {
	expect((await page.request.post('/api/settings/unlock', { data: { pin: '2468' } })).status()).toBe(204);
}

/** Where every card and its poster are, to the tenth of a pixel. */
function cardPlaces(page: Page): Promise<number[][]> {
	return page.locator('.grid > .card, .grid > .card .poster').evaluateAll((all) =>
		all.map((node) => {
			const box = node.getBoundingClientRect();
			return [box.left, box.top, box.width, box.height].map((n) => Math.round(n * 10) / 10);
		})
	);
}

// With Collections on, this Canvas lists five cards: the GOG collection Lantern Coast Saga, the game Lanterns of Orrin
// (4115), and the three own collections.
test.describe('picking with Select', () => {
	test.use({ baseURL: process.env.CANVAS_OWN_URL });

	const gog = '.grid > a.card.is-collection:not(.is-own)';
	const game = 'a[href="/game/4115"]';
	const BAR = ['.bar .brand', '.bar .search', '.bar .os-toggle', '.bar .view-toggle:not(.select-toggle)', '.bar .select-toggle', '.bar .filter-button'];

	test('a visitor has no Select', async ({ page }) => {
		await page.goto('/?view=collections');
		await expect(page.locator('.bar .view-toggle')).toBeVisible();
		await expect(page.locator('.select-toggle')).toHaveCount(0);
	});

	test('Select picks and unpicks, and nothing moves', async ({ page }) => {
		await unlock(page);
		await page.goto('/?view=collections');
		const select = page.locator('.bar .select-toggle');
		await expect(select).toHaveText('Select');
		await expect(select).toHaveAttribute('title', 'Pick games for your collections');
		await expect(select).toHaveAttribute('aria-pressed', 'false');
		const measure = () => Promise.all([cardPlaces(page), ...BAR.map((s) => place(page, s))]);
		const before = await measure();
		const off = await place(page, '.bar .select-toggle');

		await select.click();
		await expect(select).toHaveAttribute('aria-pressed', 'true');
		// A circle on the game and on GOG's collection; the own cards have none.
		await expect(page.locator('.grid > .card .pick-dot')).toHaveCount(2);
		await expect(page.locator(`${gog} .pick-dot, ${game} .pick-dot`)).toHaveCount(2);
		const bar = page.locator('.pickbar');
		await expect(bar.locator('.pickbar-count strong')).toHaveText('0 selected');
		await expect(bar.locator('.pickbar-what')).toHaveText('Click cards to pick them');
		await expect(bar.getByRole('button', { name: 'Add to…' })).toBeDisabled();
		await expect(bar.getByRole('button', { name: 'New collection' })).toBeDisabled();
		await expect(bar.getByRole('button', { name: 'Cancel' })).toBeEnabled();
		expect(await measure()).toEqual(before);
		// On, it is yellow, and as large as off.
		const on = await place(page, '.bar .select-toggle');
		expect(on).toEqual(off);
		await expect(select).toHaveCSS('color', 'rgb(245, 189, 31)');

		await page.locator(game).click();
		await page.locator(gog).click();
		await expect(page.locator('.grid > .card.is-picked')).toHaveCount(2);
		await expect(page.locator(game)).toHaveAttribute('aria-pressed', 'true');
		await expect(bar.locator('.pickbar-count strong')).toHaveText('2 selected');
		await expect(bar.locator('.pickbar-what')).toHaveText('1 game and 1 GOG collection');
		await expect(bar.getByRole('button', { name: 'Add to…' })).toBeEnabled();
		await expect(bar.getByRole('button', { name: 'New collection' })).toBeEnabled();
		// Picking opens nothing.
		await expect(page).toHaveURL(/\/\?view=collections$/);
		await expect(page.locator('dialog.detail')).toBeHidden();
		expect(await measure()).toEqual(before);

		await page.locator(game).click();
		await expect(page.locator(game)).toHaveAttribute('aria-pressed', 'false');
		await expect(bar.locator('.pickbar-count strong')).toHaveText('1 selected');
		await expect(bar.locator('.pickbar-what')).toHaveText('1 GOG collection');
		expect(await measure()).toEqual(before);
	});

	test('an own card cannot be picked', async ({ page }) => {
		await unlock(page);
		await page.goto('/?view=collections');
		await page.locator('.bar .select-toggle').click();
		const own = page.locator('a[href="/collection/h1"]');
		await expect(own).toHaveCSS('opacity', '0.35');
		await expect(own).toHaveCSS('cursor', 'not-allowed');
		await expect(own.locator('.pick-dot')).toHaveCount(0);
		// A screen reader hears that it cannot be used, and Playwright would not click it: the click is forced.
		await expect(own).toBeDisabled();
		await own.click({ force: true });
		// A pick after it shows that the click was taken, and picked nothing.
		await page.locator(game).click();
		await expect(page.locator('.pickbar-count strong')).toHaveText('1 selected');
		await expect(page.locator('.grid > .card.is-picked')).toHaveCount(1);
		await expect(own).not.toHaveClass(/is-picked/);
		await expect(page).toHaveURL(/\/\?view=collections$/);
		await expect(page.locator('dialog.detail')).toBeHidden();
	});

	test('Space and Enter pick', async ({ page }) => {
		await unlock(page);
		await page.goto('/');
		await page.locator('.bar .select-toggle').click();
		const card = page.locator('a[href="/game/4117"]');
		await card.focus();
		await page.keyboard.press('Space');
		// A screen reader hears a pressed button.
		await expect(page.getByRole('button', { name: /^Night Ferry/, pressed: true })).toHaveCount(1);
		await expect(card).toHaveClass(/is-picked/);
		await expect(page.locator('.pickbar-count strong')).toHaveText('1 selected');
		// Space did not scroll the page.
		expect(await page.evaluate(() => scrollY)).toBe(0);
		await page.keyboard.press('Enter');
		await expect(page.getByRole('button', { name: /^Night Ferry/, pressed: false })).toHaveCount(1);
		await expect(page.locator('.pickbar-count strong')).toHaveText('0 selected');
		await page.keyboard.press('Enter');
		await expect(page.locator('.pickbar-count strong')).toHaveText('1 selected');
		await expect(page).toHaveURL(/\/$/);
		await expect(page.locator('dialog.detail')).toBeHidden();
	});

	test('picks stay through a filter and the count still counts them', async ({ page }) => {
		await unlock(page);
		await page.goto('/');
		await page.locator('.bar .select-toggle').click();
		// Night Ferry is for Windows only.
		const card = page.locator('a[href="/game/4117"]');
		await card.click();
		await expect(page.locator('.pickbar-count strong')).toHaveText('1 selected');
		const linux = page.locator('.os-toggle button[title="Only games for Linux"]');
		await linux.click();
		await expect(linux).toHaveAttribute('aria-pressed', 'true');
		await expect(card).toHaveCount(0);
		await expect(page.locator('.pickbar-count strong')).toHaveText('1 selected');
		await expect(page.locator('.pickbar-what')).toHaveText('1 game');

		// The filter panel opens over the bar, which keeps its place, and Esc closes the panel and keeps picking.
		const cancel = '.pickbar .link-button';
		const before = await place(page, cancel);
		await page.locator('.filter-button').click();
		await expect(page.locator('dialog.filters')).toBeVisible();
		expect(await place(page, cancel)).toEqual(before);
		await page.keyboard.press('Escape');
		await expect(page.locator('dialog.filters')).toBeHidden();
		await expect(page.locator('.pickbar-count strong')).toHaveText('1 selected');

		await linux.click();
		await expect(card).toHaveClass(/is-picked/);
	});

	test('Cancel and Esc end picking', async ({ page }) => {
		await unlock(page);
		await page.goto('/?view=collections');
		const select = page.locator('.bar .select-toggle');
		for (const end of ['Cancel', 'Escape']) {
			await select.click();
			await page.locator(game).click();
			await expect(page.locator('.pickbar-count strong')).toHaveText('1 selected');
			if (end === 'Cancel') await page.locator('.pickbar').getByRole('button', { name: 'Cancel' }).click();
			else await page.keyboard.press('Escape');
			await expect(page.locator('.pickbar')).toHaveCount(0);
			await expect(page.locator('.pick-dot')).toHaveCount(0);
			await expect(page.locator('.grid > .card.is-picked')).toHaveCount(0);
			await expect(select).toHaveAttribute('aria-pressed', 'false');
			// Select again starts afresh, and Select pressed once more ends it too.
			await select.click();
			await expect(page.locator('.pickbar-count strong')).toHaveText('0 selected');
			await select.click();
			await expect(page.locator('.pickbar')).toHaveCount(0);
		}
	});

	test('locking ends picking', async ({ page }) => {
		await unlock(page);
		await page.goto('/?view=collections');
		await page.locator('.bar .select-toggle').click();
		await page.locator(game).click();
		await expect(page.locator('.pickbar-count strong')).toHaveText('1 selected');
		// The bar lies over the foot of the page while picking: "Settings" is clicked from the script.
		await page.locator('.foot .settings-link').dispatchEvent('click');
		await expect(page.locator('dialog.detail h1')).toHaveText('Settings');
		await page.getByRole('button', { name: 'Lock', exact: true }).click();
		await expect(page.locator('dialog.detail')).toBeHidden();
		await expect(page.locator('.select-toggle')).toHaveCount(0);
		await expect(page.locator('.pickbar')).toHaveCount(0);
		await expect(page.locator('.pick-dot')).toHaveCount(0);
		await expect(page.locator('a[href="/collection/h1"]')).not.toHaveClass(/is-faded/);
	});
});

test.describe('the bar with Select in a window of middle width', () => {
	test.use({ baseURL: process.env.CANVAS_OWN_URL });

	const PARTS = ['.bar .brand', '.bar .search', '.bar .os-toggle', '.bar .view-toggle:not(.select-toggle)', '.bar .filter-button'];

	test('stays in the window and out of its gutter, with Select as its mark alone and without "for vangogh" where room is short', async ({ page }) => {
		await unlock(page);
		// 761 px is the narrowest window with the wide bar.
		for (const width of [761, 770, 780, 800, 850, 900, 1000, 1100]) {
			await page.setViewportSize({ width, height: 800 });
			await page.goto('/');
			await expect(page.locator('.bar .select-toggle')).toBeVisible();
			const seen = await page.evaluate((parts) => {
				const root = document.documentElement;
				const bar = document.querySelector('.bar')!;
				// The bar's content ends where its padding, the gutter, begins.
				const end = bar.getBoundingClientRect().right - parseFloat(getComputedStyle(bar).paddingRight);
				return {
					scrolls: root.scrollWidth > root.clientWidth,
					out: parts.filter((s) => {
						const box = document.querySelector(s)!.getBoundingClientRect();
						return box.left < 0 || box.right > root.clientWidth || box.right > end + 0.5;
					})
				};
			}, [...PARTS, '.bar .select-toggle']);
			expect(seen, `${width} px`).toEqual({ scrolls: false, out: [] });
			await expect(page.locator('.bar .select-toggle .label'), `${width} px`).toBeHidden();
			await expect(page.locator('.bar .brand .by'), `${width} px`)[width <= 900 ? 'toBeHidden' : 'toBeVisible']();
		}
	});

	test("a visitor's bar is as without Select", async ({ page }) => {
		await page.setViewportSize({ width: 850, height: 800 });
		await page.goto('/');
		await expect(page.locator('.bar .brand .by')).toBeVisible();
		await expect(page.locator('.bar .view-toggle .label')).toBeVisible();
		const visitor = await Promise.all(PARTS.map((s) => place(page, s)));
		// The main Canvas has no PIN, and so never a Select.
		await page.goto(`${process.env.CANVAS_URL}/`);
		expect(await Promise.all(PARTS.map((s) => place(page, s)))).toEqual(visitor);
	});
});

test.describe('picking on a phone', () => {
	test.use({ baseURL: process.env.CANVAS_OWN_URL, userAgent: UA.phone, viewport: { width: 390, height: 844 } });

	test('on a phone the search, Collections and Select share one row, and the bar keeps its height', async ({ page }) => {
		await page.goto('/');
		const visitor = await place(page, '.bar');
		await expect(page.locator('.select-toggle')).toHaveCount(0);

		await unlock(page);
		await page.goto('/');
		const [bar, search, collections, select] = await Promise.all(
			['.bar', '.bar .search', '.bar .view-toggle:not(.select-toggle)', '.bar .select-toggle'].map((s) => place(page, s))
		);
		expect(bar).toEqual(visitor);
		expect(collections[1]).toBe(search[1]);
		expect(select[1]).toBe(search[1]);
		// The mark alone, 44 by 44, after Collections, inside the bar.
		expect(select.slice(2)).toEqual([44, 44]);
		await expect(page.locator('.bar .select-toggle .label')).toBeHidden();
		expect(select[0]).toBeGreaterThan(collections[0]);
		expect(select[0] + select[2]).toBeLessThanOrEqual(bar[0] + bar[2]);
		expect(select[1] + select[3]).toBeLessThanOrEqual(bar[1] + bar[3]);

		// The picking bar: the count on its own line, its buttons sharing the next one.
		await page.locator('.bar .select-toggle').click();
		await page.locator('a[href="/game/4117"]').click();
		await expect(page.locator('.pickbar-count strong')).toHaveText('1 selected');
		const [count, add, make, cancel] = await Promise.all(
			['.pickbar-count', '.pickbar .addto-wrap', '.pickbar .btn-primary', '.pickbar .link-button'].map((s) => place(page, s))
		);
		expect(add[1]).toBeGreaterThanOrEqual(count[1] + count[3]);
		expect(make[1]).toBe(add[1]);
		expect(cancel[1] + cancel[3] / 2).toBeCloseTo(add[1] + add[3] / 2, 0);
		expect(make[0] + make[2]).toBeLessThanOrEqual(390);
	});
});
