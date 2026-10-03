import type { Page } from '@playwright/test';
import { arrived, expect, place, test, titles, UA } from './helpers';
import { pictureOf } from './setup';

const SIX = ['Lantern Coast Saga', 'Lanterns of Orrin', 'Night Ferry', 'Parallax Racing Trilogy', 'Quiet Harbour', 'Thornwick Mysteries'];

/** Switches the toggle the way a visitor does, without Playwright scrolling anything into view first. */
async function toggle(page: Page): Promise<void> {
	await page.locator('.view-toggle').evaluate((node: HTMLElement) => node.click());
}

test.describe('the collections in the list', () => {
	test.use({ baseURL: process.env.CANVAS_COLLECTIONS_URL });

	test('the toggle shows each collection as one card, keeps the other games, and counts games and collections', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('.view-toggle')).toHaveAttribute('aria-pressed', 'false');
		expect(await titles(page)).toHaveLength(17);
		await toggle(page);
		await expect(page.locator('.view-toggle')).toHaveAttribute('aria-pressed', 'true');
		await expect(page).toHaveURL(/\/\?view=collections$/);
		expect(await titles(page)).toEqual(SIX);
		await expect(page.locator('.count-text')).toHaveText('17 games · 3 collections', { useInnerText: true });
	});

	test('the toggle keeps its size, and nothing in the bar, the count line or the grid moves', async ({ page }) => {
		await page.goto('/');
		const watched = ['.brand', '.search', '.os-toggle', '.view-toggle', '.filter-button', '.sort button:nth-of-type(1)', '.sort button:nth-of-type(3)', '.grid > .card'];
		const before = await Promise.all(watched.map((s) => place(page, s)));
		await toggle(page);
		await expect(page.locator('.card.is-collection').first()).toBeVisible();
		expect(await Promise.all(watched.map((s) => place(page, s)))).toEqual(before);
		const look = await page.locator('.view-toggle').evaluate((node) => [getComputedStyle(node).color, getComputedStyle(node).borderTopColor]);
		expect(look).toEqual(['rgb(245, 189, 31)', 'rgb(245, 189, 31)']);
	});

	// Spec 5.2: the count line keeps the room of its collections part, so the sort words and the cards stay.
	const widths: [string, number, string, string | undefined][] = [
		['a phone 414 wide', 414, '/', UA.phone],
		['a phone 430 wide', 430, '/', UA.phone],
		['a phone 440 wide', 440, '/', UA.phone],
		['500 wide with two filter chips', 500, '/?os=windows&genre=Adventure', undefined],
		['900 wide with two filter chips', 900, '/?os=windows&genre=Adventure', undefined]
	];
	for (const [name, width, address, userAgent] of widths) {
		test.describe(name, () => {
			test.use({ viewport: { width, height: 900 }, ...(userAgent ? { userAgent } : {}) });
			test('switching the toggle moves nothing on a phone or with filter chips', async ({ page }) => {
				await page.goto(address);
				const watched = ['.sort button:nth-of-type(1)', '.grid > .card'];
				const measure = () => Promise.all(watched.map((s) => place(page, s)));
				const before = await measure();
				await toggle(page);
				await expect(page.locator('.card.is-collection').first()).toBeVisible();
				expect(await measure()).toEqual(before);
				await toggle(page);
				await expect(page.locator('.card.is-collection')).toHaveCount(0);
				expect(await measure()).toEqual(before);
			});
		});
	}

	test('a reload keeps the toggle on, and the logo brings it back from the cookie', async ({ page }) => {
		await page.goto('/');
		await toggle(page);
		await expect(page).toHaveURL(/\/\?view=collections$/);
		await page.reload();
		await expect(page.locator('.view-toggle')).toHaveAttribute('aria-pressed', 'true');
		await page.goto('/');
		await expect(page).toHaveURL(/\/\?view=collections$/);
		await expect(page.locator('.view-toggle')).toHaveAttribute('aria-pressed', 'true');
		await toggle(page);
		await expect(page).toHaveURL(/\/$/);
		await page.goto('/');
		await expect(page.locator('.view-toggle')).toHaveAttribute('aria-pressed', 'false');
	});

	test('a collection card has the size of a game card, its edges in the gap above it, the glow and the badge', async ({ page }) => {
		await page.goto('/?view=collections');
		const sizes = await page.locator('.grid > .card').evaluateAll((all) => all.map((c) => `${Math.round(c.getBoundingClientRect().width)}x${Math.round(c.getBoundingClientRect().height)}`));
		expect(new Set(sizes).size).toBe(1);
		const card = page.locator('.card', { hasText: 'Thornwick Mysteries' });
		await expect(card).toHaveClass(/is-collection/);
		const edges = await card.evaluate((node) => [getComputedStyle(node, '::before').top, getComputedStyle(node, '::after').top]);
		expect(edges).toEqual(['-4px', '-8px']);
		expect(await card.locator('.poster').evaluate((node) => getComputedStyle(node).boxShadow)).toContain('rgba(111, 160, 255, 0.6)');
		const pill = card.locator('.coll-pill');
		await expect(pill.locator('span[aria-hidden="true"]')).toHaveText('3');
		await expect(pill.locator('.sr')).toHaveText('3 games');
		await expect(pill).toHaveAttribute('title', 'Series of 3 games: Thornwick Mysteries, Thornwick Mysteries 2, Saltwater Detectives');
		await expect(card.locator('.card-genres .kind')).toHaveText('Series');
		await expect(card.locator('.card-genres .years')).toHaveText('1996–2001');
		await expect(card).toHaveAttribute('href', '/collection/s500');
		await expect(page.locator('.card', { hasText: 'Lantern Coast Saga' }).locator('.card-genres')).toHaveText(/^Pack.*2010–2018$/);
	});

	// Review focus 5
	test("a pack poster the archive lacks gives way to the oldest game's", async ({ page }) => {
		await page.goto('/?view=collections');
		const parallax = page.locator('.card', { hasText: 'Parallax Racing Trilogy' });
		await expect(parallax.locator('.poster img')).toHaveAttribute('src', `/img/${pictureOf('4105')}`);
		await expect(page.locator('.card', { hasText: 'Lantern Coast Saga' }).locator('.poster img')).toHaveAttribute('src', `/img/${pictureOf('4803')}`);
		// A series has no poster: its oldest game's.
		await expect(page.locator('.card', { hasText: 'Thornwick Mysteries' }).locator('.poster img')).toHaveAttribute('src', `/img/${pictureOf('4101')}`);
	});

	test('the filters work on games: a collection stands for those that pass', async ({ page }) => {
		await page.goto('/?view=collections&os=linux');
		expect(await titles(page)).toEqual(['Quiet Harbour', 'Thornwick Mysteries']);
		await expect(page.locator('.card', { hasText: 'Thornwick Mysteries' }).locator('.coll-pill span[aria-hidden="true"]')).toHaveText('1');
		await expect(page.locator('.count-text')).toHaveText('2 of 17 games · 1 collection', { useInnerText: true });
	});

	test('the search finds a collection by its name, or by a game, and says which game', async ({ page }) => {
		await page.goto('/?view=collections&q=saltwater');
		expect(await titles(page)).toEqual(['Thornwick Mysteries']);
		const card = page.locator('.card.is-collection');
		await expect(card.locator('.card-reason')).toHaveText('contains: Saltwater Detectives');
		await expect(card.locator('.card-genres')).toHaveCount(0);
		await expect(card.locator('.coll-pill span[aria-hidden="true"]')).toHaveText('3');
		await expect(page.locator('.count-text')).toHaveText('3 of 17 games · 1 collection', { useInnerText: true });
		await page.goto('/?view=collections&q=parallax');
		expect(await titles(page)).toEqual(['Parallax Racing Trilogy']);
		await expect(page.locator('.card-reason')).toHaveCount(0);
	});

	test('sorts a collection by its name, its latest purchase and its newest game', async ({ page }) => {
		await page.goto('/?view=collections&sort=recent');
		expect(await titles(page)).toEqual(['Night Ferry', 'Thornwick Mysteries', 'Lanterns of Orrin', 'Quiet Harbour', 'Parallax Racing Trilogy', 'Lantern Coast Saga']);
		await page.goto('/?view=collections&sort=year');
		expect(await titles(page)).toEqual(['Lantern Coast Saga', 'Night Ferry', 'Quiet Harbour', 'Parallax Racing Trilogy', 'Thornwick Mysteries', 'Lanterns of Orrin']);
	});

	test('without the toggle the search finds a game by its series or its pack, and not by a shop bundle', async ({ page }) => {
		await page.goto('/?q=tales');
		expect(await titles(page)).toEqual(['Lanterns of Orrin']);
		await expect(page.locator('.card-reason')).toHaveText('series: Orrin Tales');
		await page.goto('/?q=double%20feature');
		expect(await titles(page)).toEqual(['Thornwick Mysteries', 'Thornwick Mysteries 2']);
		await expect(page.locator('.card-reason').first()).toHaveText('pack: Thornwick Double Feature');
		await page.goto('/?q=everything');
		await expect(page.locator('.card')).toHaveCount(0);
	});
});

test.describe('the toggle on a phone', () => {
	test.use({ baseURL: process.env.CANVAS_COLLECTIONS_URL, userAgent: UA.phone, viewport: { width: 390, height: 844 } });

	test('is the mark alone, 44 px, beside the search box', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('.view-toggle .label')).toBeHidden();
		const [toggleLeft, toggleTop, width, height] = await place(page, '.view-toggle');
		const [searchLeft, searchTop, searchWidth] = await place(page, '.search');
		expect([width, height]).toEqual([44, 44]);
		expect(toggleTop).toBe(searchTop);
		expect(toggleLeft).toBeGreaterThan(searchLeft + searchWidth);
		// The first row keeps its three parts.
		expect((await place(page, '.filter-button'))[1]).toBe((await place(page, '.os-toggle'))[1]);
	});
});

test.describe("a collection's sheet", () => {
	test.use({ baseURL: process.env.CANVAS_COLLECTIONS_URL });

	test('opens over the list on a click, with an address of its own, and Esc brings the list back', async ({ page }) => {
		await page.goto('/?view=collections');
		const card = page.locator('.card', { hasText: 'Parallax Racing Trilogy' });
		await card.click();
		const sheet = page.locator('dialog.detail');
		await expect(sheet).toBeVisible();
		await expect(page).toHaveURL(/\/collection\/p4802$/);
		await expect(page).toHaveTitle('Parallax Racing Trilogy | Canvas for vangogh');
		await expect(sheet.locator('h1')).toHaveText('Parallax Racing Trilogy');
		await expect(sheet.locator('.detail-makers')).toHaveText('Pack of 3 games on GOG, 2 in your library, 1988–2004 · GOG.com');
		await expect(sheet.locator('.detail-makers a.store')).toHaveAttribute('href', 'https://www.gog.com/en/game/parallax_racing_trilogy');
		await expect(sheet.locator('.coll-joined')).toHaveCount(0);
		await expect(sheet.locator('.coll-body .section-title')).toHaveText('Games in your library 2, oldest first');
		expect(await sheet.locator('.coll-grid .card-title').allTextContents()).toEqual(['Copper Rally 88', 'Helix Drift']);
		await expect(sheet.locator('.coll-grid .card').first().locator('.card-genres .year')).toHaveText('1988');

		await page.keyboard.press('Escape');
		await expect(sheet).toBeHidden();
		await expect(page).toHaveURL(/\/\?view=collections$/);
		await expect(card).toBeFocused();
	});

	test("the backdrop of a pack whose poster the archive lacks is the oldest game's", async ({ page }) => {
		await page.goto('/collection/p4802');
		await expect(page.locator('dialog.detail .ambience img')).toHaveAttribute('src', `/img/${pictureOf('4105')}`);
	});

	test('says what a series is and what was joined, and links a pack to GOG.com only where its games link to it', async ({ page }) => {
		await page.goto('/collection/s500');
		const sheet = page.locator('dialog.detail');
		await expect(sheet.locator('.detail-makers')).toHaveText('Series, 3 games in your library, 1996–2001');
		await expect(sheet.locator('.coll-joined')).toHaveText("With the games of GOG's pack Thornwick Double Feature.");
		await expect(sheet.locator('.coll-joined b')).toHaveText('Thornwick Double Feature');
		await expect(sheet.locator('.facts span')).toHaveText(['Windows', 'macOS', 'Linux']);
		await page.goto('/collection/p4803');
		await expect(sheet.locator('.detail-makers')).toHaveText('Pack of 9 games on GOG, all in your library, 2010–2018');
		await expect(sheet.locator('.detail-makers a.store')).toHaveCount(0);
		await expect(sheet.locator('.coll-joined')).toHaveText("With the games of GOG's pack Lantern Coast: Season Two.");
	});

	test('a game opened from the sheet takes its place, and closing it shows the list', async ({ page }) => {
		await page.goto('/?view=collections');
		await page.locator('.card', { hasText: 'Thornwick Mysteries' }).click();
		const sheet = page.locator('dialog.detail');
		await expect(page).toHaveURL(/\/collection\/s500$/);
		await sheet.locator('.coll-grid .card', { hasText: 'Thornwick Mysteries 2' }).click();
		await expect(page).toHaveURL(/\/game\/4102$/);
		await expect(sheet.locator('h1')).toHaveText('Thornwick Mysteries 2');
		await expect(sheet.locator('.coll-grid')).toHaveCount(0);
		await sheet.locator('.detail-close').click();
		await expect(sheet).toBeHidden();
		await expect(page).toHaveURL(/\/\?view=collections$/);
	});

	// Review focus 3
	test('Back and Forward through a sheet and its game', async ({ page }) => {
		await page.goto('/?view=collections');
		await page.locator('.card', { hasText: 'Thornwick Mysteries' }).click();
		const sheet = page.locator('dialog.detail');
		await sheet.locator('.coll-grid .card', { hasText: 'Saltwater Detectives' }).click();
		await expect(page).toHaveURL(/\/game\/4103$/);

		await page.goBack();
		await expect(page).toHaveURL(/\/collection\/s500$/);
		await expect(sheet.locator('h1')).toHaveText('Thornwick Mysteries');
		await page.goBack();
		await expect(sheet).toBeHidden();
		await expect(page).toHaveURL(/\/\?view=collections$/);

		await page.goForward();
		await expect(sheet.locator('h1')).toHaveText('Thornwick Mysteries');
		await page.goForward();
		await expect(page).toHaveURL(/\/game\/4103$/);
		await expect(sheet.locator('h1')).toHaveText('Saltwater Detectives');

		await page.keyboard.press('Escape');
		await expect(sheet).toBeHidden();
		await expect(page).toHaveURL(/\/\?view=collections$/);
		await page.goForward();
		await expect(page).toHaveURL(/\/collection\/s500$/);
		await expect(sheet.locator('h1')).toHaveText('Thornwick Mysteries');
	});

	test('a sheet opened by its address draws the list behind it; a game opened from it closes to the list, and Back shows the sheet', async ({ page }) => {
		await page.goto('/collection/s500');
		const sheet = page.locator('dialog.detail');
		await expect(sheet.locator('h1')).toHaveText('Thornwick Mysteries');
		await expect(page.locator('main .grid > .card')).toHaveCount(17);
		await sheet.locator('.coll-grid .card', { hasText: 'Thornwick Mysteries 2' }).click();
		await expect(page).toHaveURL(/\/game\/4102$/);
		await sheet.locator('.detail-close').click();
		await expect(sheet).toBeHidden();
		await expect(page).toHaveURL(/\/$/);
		await page.goBack();
		await expect(page).toHaveURL(/\/collection\/s500$/);
		await expect(sheet.locator('h1')).toHaveText('Thornwick Mysteries');
		// No dead entry: one more Back leaves the sheet's address.
		await page.goBack();
		await expect(page).not.toHaveURL(/\/collection\/s500$/);
	});

	test('closing a game opened from a sheet that came by its address shows no frame of the sheet', async ({ page }) => {
		await page.goto('/collection/s500');
		const sheet = page.locator('dialog.detail');
		await sheet.locator('.coll-grid .card', { hasText: 'Thornwick Mysteries 2' }).click();
		await expect(sheet.locator('h1')).toHaveText('Thornwick Mysteries 2');
		await page.evaluate(() => {
			const frames: (string | null)[] = [];
			(window as unknown as { frames: typeof frames }).frames = frames;
			const start = performance.now();
			const tick = () => {
				frames.push(document.querySelector('dialog.detail[open] h1')?.textContent ?? null);
				if (performance.now() - start < 2000) requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
		await sheet.locator('.detail-close').click();
		await expect(sheet).toBeHidden();
		await expect(page).toHaveURL(/\/$/);
		await page.waitForTimeout(300);
		const frames = await page.evaluate(() => (window as unknown as { frames: (string | null)[] }).frames);
		expect(frames.length).toBeGreaterThan(5);
		expect(frames).not.toContain('Thornwick Mysteries');
	});

	test('an unknown collection shows the list with a note', async ({ page }) => {
		for (const path of ['/collection/p1', '/collection/nonsense']) {
			await page.goto(path);
			await expect(page.locator('.toast')).toHaveText('This collection is not in the library.');
			await expect(page.locator('dialog.detail')).toBeHidden();
		}
	});

	test('the sheet always has its scrollbar, and starts at its top, and so does a game opened from it', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 600 });
		await page.goto('/?view=collections');
		await page.locator('.card', { hasText: 'Lantern Coast Saga' }).click();
		const sheet = page.locator('dialog.detail');
		await expect(sheet.locator('h1')).toHaveText('Lantern Coast Saga');
		expect(await sheet.evaluate((node) => getComputedStyle(node).overflowY)).toBe('scroll');
		await sheet.evaluate((node) => node.scrollTo(0, 400));
		await sheet.locator('.coll-grid .card', { hasText: 'Chapter 9' }).evaluate((node: HTMLElement) => node.click());
		await expect(sheet.locator('h1')).toHaveText('Lantern Coast: Chapter 9');
		expect(await sheet.evaluate((node) => node.scrollTop)).toBe(0);
		await expect(sheet.locator('.detail-inner')).toBeFocused();
	});
});

test.describe("a collection's sheet on a phone", () => {
	test.use({ baseURL: process.env.CANVAS_COLLECTIONS_URL, userAgent: UA.phone, viewport: { width: 390, height: 844 } });

	test('keeps the picture beside the name, and gives the games the whole width', async ({ page }) => {
		await page.goto('/collection/s500');
		expect((await place(page, 'dialog.detail .detail-poster'))[2]).toBe(112);
		const [headLeft, , headWidth] = await place(page, 'dialog.detail .detail-head');
		const [bodyLeft, , bodyWidth] = await place(page, 'dialog.detail .coll-body');
		expect([bodyLeft, bodyWidth]).toEqual([headLeft + 16, headWidth - 32]);
	});
});

test.describe("the collection in a game's detail", () => {
	test.use({ baseURL: process.env.CANVAS_COLLECTIONS_URL });

	test('is one folded line under the head, and only for a game in a collection', async ({ page }) => {
		await page.goto('/game/4102');
		const shelf = page.locator('dialog.detail .coll-shelf');
		const line = shelf.locator('button.shelf-line');
		await expect(line).toHaveAttribute('aria-expanded', 'false');
		await expect(line.locator('b')).toHaveText('Thornwick Mysteries');
		await expect(line).toContainText('Series, 3 games in your library');
		await expect(shelf.locator('.shelf')).toHaveCount(0);
		const [, headTop, , headHeight] = await place(page, 'dialog.detail .detail-head');
		expect((await place(page, 'dialog.detail .coll-shelf'))[1]).toBeGreaterThanOrEqual(headTop + headHeight);
		// A game of no collection, and a game whose series holds no other game of the library.
		for (const id of ['4117', '4115']) {
			await page.goto(`/game/${id}`);
			await expect(page.locator('dialog.detail h1')).toBeVisible();
			await expect(page.locator('dialog.detail .coll-shelf')).toHaveCount(0);
		}
	});

	test('a click opens the row for good: the line does not move, the focus goes to the first game, this game is marked', async ({ page }) => {
		await page.goto('/game/4102');
		await arrived(page);
		const before = await place(page, 'dialog.detail .shelf-line');
		await page.locator('dialog.detail button.shelf-line').evaluate((node: HTMLElement) => node.click());
		const shelf = page.locator('dialog.detail .coll-shelf');
		await expect(shelf).toHaveClass(/is-open/);
		await expect(shelf.locator('button.shelf-line')).toHaveCount(0);
		const after = await place(page, 'dialog.detail .shelf-line');
		expect([after[0], after[1], after[3]]).toEqual([before[0], before[1], before[3]]);
		expect(await shelf.locator('.shelf-card .t').allTextContents()).toEqual(['Thornwick Mysteries', 'Thornwick Mysteries 2', 'Saltwater Detectives']);
		const here = shelf.locator('.shelf-card.is-here');
		await expect(here).toHaveAttribute('aria-current', 'true');
		expect(await here.evaluate((node) => node.tagName)).toBe('DIV');
		await expect(here.locator('.y')).toHaveText('This game · 1998');
		await expect(shelf.locator('.shelf-card').first()).toBeFocused();
		await expect(shelf.locator('.shelf-card').first().locator('.y')).toHaveText('1996');
	});

	test('another game of the row opens in place, with its row open; closing shows the list, and so does Back', async ({ page }) => {
		await page.goto('/');
		const sheet = page.locator('dialog.detail');
		await page.locator('.card', { hasText: 'Thornwick Mysteries 2' }).click();
		await expect(page).toHaveURL(/\/game\/4102$/);
		await sheet.locator('button.shelf-line').click();
		await sheet.locator('a.shelf-card', { hasText: 'Saltwater Detectives' }).click();
		await expect(page).toHaveURL(/\/game\/4103$/);
		await expect(sheet.locator('h1')).toHaveText('Saltwater Detectives');
		await expect(sheet.locator('.coll-shelf')).toHaveClass(/is-open/);
		await expect(sheet.locator('.shelf-card.is-here .t')).toHaveText('Saltwater Detectives');
		await page.keyboard.press('Escape');
		await expect(sheet).toBeHidden();
		await expect(page).toHaveURL(/\/$/);

		await page.locator('.card', { hasText: 'Thornwick Mysteries 2' }).click();
		await sheet.locator('button.shelf-line').click();
		await sheet.locator('a.shelf-card').first().click();
		await expect(page).toHaveURL(/\/game\/4101$/);
		await page.goBack();
		await expect(sheet).toBeHidden();
		await expect(page).toHaveURL(/\/$/);
	});

	test('a game opened from the list or from a sheet starts folded', async ({ page }) => {
		await page.goto('/?view=collections');
		const sheet = page.locator('dialog.detail');
		await page.locator('.card', { hasText: 'Thornwick Mysteries' }).click();
		await sheet.locator('.coll-grid .card', { hasText: 'Saltwater Detectives' }).click();
		await expect(sheet.locator('h1')).toHaveText('Saltwater Detectives');
		await expect(sheet.locator('button.shelf-line')).toHaveAttribute('aria-expanded', 'false');
	});

	// Review focus 4
	test('on a game opened by its address, another game of the row opens in place, and closing shows the list', async ({ page }) => {
		await page.goto('/game/4101');
		const sheet = page.locator('dialog.detail');
		await sheet.locator('button.shelf-line').click();
		await sheet.locator('a.shelf-card', { hasText: 'Thornwick Mysteries 2' }).click();
		await expect(page).toHaveURL(/\/game\/4102$/);
		await expect(sheet.locator('h1')).toHaveText('Thornwick Mysteries 2');
		await sheet.locator('.detail-close').click();
		await expect(sheet).toBeHidden();
		await expect(page).toHaveURL(/\/$/);
		await expect(page.locator('main .grid > .card')).toHaveCount(17);
	});

	test('a game opened from the end of a long row shows itself in its row', async ({ page }) => {
		await page.goto('/game/4106');
		await arrived(page);
		await page.locator('dialog.detail button.shelf-line').evaluate((node: HTMLElement) => node.click());
		await page.locator('.shelf').evaluate((node) => node.scrollTo({ left: node.scrollWidth }));
		await page.locator('a.shelf-card').last().evaluate((node: HTMLElement) => node.click());
		await expect(page.locator('dialog.detail h1')).toHaveText('Lantern Coast: Chapter 9');
		await expect(page.locator('.shelf-card.is-here')).toBeVisible();
		const [shelf, here] = await Promise.all([page.locator('.shelf').boundingBox(), page.locator('.shelf-card.is-here').boundingBox()]);
		expect(here!.x).toBeGreaterThanOrEqual(shelf!.x);
		expect(here!.x + here!.width).toBeLessThanOrEqual(shelf!.x + shelf!.width);
	});

	test('a game swapped in the row of a game opened from a sheet closes to the list', async ({ page }) => {
		await page.goto('/?view=collections');
		const sheet = page.locator('dialog.detail');
		await page.locator('.card', { hasText: 'Thornwick Mysteries' }).click();
		await expect(page).toHaveURL(/\/collection\/s500$/);
		await sheet.locator('.coll-grid .card', { hasText: 'Thornwick Mysteries 2' }).click();
		await expect(page).toHaveURL(/\/game\/4102$/);
		await sheet.locator('button.shelf-line').click();
		await sheet.locator('a.shelf-card', { hasText: 'Saltwater Detectives' }).click();
		await expect(page).toHaveURL(/\/game\/4103$/);
		await page.keyboard.press('Escape');
		await expect(sheet).toBeHidden();
		await expect(page).toHaveURL(/\/\?view=collections$/);
		await page.goForward();
		await expect(sheet).toBeVisible();
		await expect(page).toHaveURL(/\/collection\/s500$/);
		await expect(sheet.locator('h1')).toHaveText('Thornwick Mysteries');
	});

	test("the row's arrows: none when it fits, each hidden at its end, and a click scrolls the row and moves nothing else", async ({ page }) => {
		await page.goto('/game/4102');
		await page.locator('dialog.detail button.shelf-line').click();
		await expect(page.locator('.shelf-wrap .shots-arrow.prev')).toBeDisabled();
		await expect(page.locator('.shelf-wrap .shots-arrow.next')).toBeDisabled();

		// Nine games: seven fit in the widest detail.
		await page.goto('/game/4106');
		await arrived(page);
		await page.locator('dialog.detail button.shelf-line').evaluate((node: HTMLElement) => node.click());
		const prev = page.locator('.shelf-wrap .shots-arrow.prev');
		const next = page.locator('.shelf-wrap .shots-arrow.next');
		await expect(prev).toBeDisabled();
		await expect(next).toBeEnabled();
		// The arrows stand at the middle of the posters.
		const [, arrowTop, , arrowHeight] = await place(page, '.shelf-wrap .shots-arrow.next');
		const [, posterTop, , posterHeight] = await place(page, '.shelf .poster');
		expect(Math.abs(arrowTop + arrowHeight / 2 - (posterTop + posterHeight / 2))).toBeLessThanOrEqual(1);
		const watched = ['dialog.detail .detail-head', 'dialog.detail .shelf-line', '.shelf-wrap'];
		const before = await Promise.all(watched.map((s) => place(page, s)));
		await next.evaluate((node: HTMLElement) => node.click());
		await expect.poll(() => page.locator('.shelf').evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
		await expect(prev).toBeEnabled();
		expect(await Promise.all(watched.map((s) => place(page, s)))).toEqual(before);
		await page.locator('.shelf').evaluate((node) => node.scrollTo({ left: node.scrollWidth }));
		await expect(next).toBeDisabled();
	});
});

test.describe("the collection's row on a phone", () => {
	test.use({ baseURL: process.env.CANVAS_COLLECTIONS_URL, userAgent: UA.phone, viewport: { width: 390, height: 844 } });

	test('has no arrows, and smaller posters', async ({ page }) => {
		await page.goto('/game/4106');
		await page.locator('dialog.detail button.shelf-line').click();
		await expect(page.locator('.shelf-wrap .shots-arrow.next')).toBeHidden();
		expect((await place(page, '.shelf-card'))[2]).toBe(104);
	});
});
