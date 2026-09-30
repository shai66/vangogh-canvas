import type { Page } from '@playwright/test';
import { expect, place, test, titles } from './helpers';
import { LONG_TITLE } from './setup';

// setup.ts gives seven entries: a game for three systems with a DLC, a game for
// Windows only, a DLC without its base game, a record that could not be read,
// a game whose files are missing in the archive, one with a very long title,
// and a game without files of its own whose DLC is in the archive.

test.describe('the list', () => {
	test('shows every entry, A to Z, with what is known of each', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveTitle('Canvas for vangogh');
		await expect(page.locator('.count-text')).toHaveText('7 games');
		expect(await titles(page)).toEqual([
			'Broken Record',
			'Expansion Only Game',
			'Lonely Expansion',
			// Sorted without its "The".
			'The Long Dark Road',
			'Missing Files Game',
			LONG_TITLE,
			'Windows Only Game'
		]);

		const road = page.locator('.card', { hasText: 'The Long Dark Road' });
		await expect(road.locator('.os .sr')).toHaveText(['Windows', 'macOS', 'Linux']);
		await expect(road.locator('.dlc')).toHaveText('1 DLC');
		await expect(road.locator('.people .sr')).toHaveText(['Co-op', 'Multiplayer']);
		await expect(road.locator('.card-genres')).toHaveText('Role-playingAdventure');
		await expect(road.locator('.poster img')).toHaveCount(1);

		await expect(page.locator('.card', { hasText: 'Lonely Expansion' }).locator('.badge-note')).toHaveText('DLC, base game not owned');
		await expect(page.locator('.card', { hasText: 'Broken Record' }).locator('.poster-plain')).toHaveText('Broken Record');
	});

	test('marks a game whose files are missing, on the poster and in words', async ({ page }) => {
		await page.goto('/');
		const card = page.locator('.card', { hasText: 'Missing Files Game' });
		await expect(card.locator('.badge-warn')).toBeVisible();
		await expect(card.locator('.missing')).toHaveText('Files missing');
		// The platforms mean nothing for a game that cannot be downloaded.
		await expect(card.locator('.os')).toHaveCount(0);
		// A game with files carries neither.
		const road = page.locator('.card', { hasText: 'The Long Dark Road' });
		await expect(road.locator('.badge-warn, .missing')).toHaveCount(0);
	});

	test('cuts a title that does not fit, and is not widened by it', async ({ page }) => {
		await page.goto('/');
		const long = page.locator('.card', { hasText: LONG_TITLE });
		const usual = page.locator('.card', { hasText: 'Windows Only Game' });
		const width = (card: typeof long) => card.evaluate((node) => node.getBoundingClientRect().width);
		expect(await width(long)).toBe(await width(usual));
		const title = long.locator('.card-title');
		expect(await title.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
		expect(await title.evaluate((node) => getComputedStyle(node).textOverflow)).toBe('ellipsis');
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		// Pointed at, the title runs, so that all of it can be read.
		await long.hover();
		await expect(title).toHaveClass(/is-running/);
		await usual.hover();
		await expect(title).not.toHaveClass(/is-running/);
	});

	test('lets the wide image stand in when the portrait poster cannot be shown', async ({ page }) => {
		await page.goto('/');
		const card = page.locator('.card', { hasText: 'Windows Only Game' });
		await expect(card.locator('.poster-wide img')).toHaveCount(2);
		await expect(card.locator('.poster-plain')).toHaveCount(0);
	});

	test('sorts by what was added last', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: 'Recently added' }).click();
		expect(await titles(page)).toEqual(['The Long Dark Road', 'Windows Only Game', 'Lonely Expansion', 'Broken Record', 'Missing Files Game', LONG_TITLE, 'Expansion Only Game']);
		await expect(page).toHaveURL(/\?sort=recent$/);
	});

	test('sends a security policy that allows no script from elsewhere', async ({ page }) => {
		const answer = await page.goto('/');
		const policy = answer?.headers()['content-security-policy'] ?? '';
		expect(policy).toContain("default-src 'self'");
		expect(policy).toContain("object-src 'none'");
		expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
	});

	test('has a foot with the version, the last update, vangogh and the source', async ({ page }) => {
		await page.goto('/');
		const foot = page.locator('.foot');
		await expect(foot).toContainText(/Canvas \d+\.\d+\.\d+/);
		await expect(foot).toContainText(/Library updated \d+ \w+, \d\d:\d\d(?!\d)/);
		await expect(foot.getByRole('link', { name: 'vangogh' })).toHaveAttribute('href', 'https://github.com/arelate/vangogh');
		const source = foot.getByRole('link', { name: 'Source code' });
		await expect(source).toHaveAttribute('href', 'https://github.com/shai66/vangogh-canvas');
		await expect(source).toHaveAttribute('target', '_blank');
		await expect(source).toHaveAttribute('rel', 'noreferrer');
	});
});

test.describe('search', () => {
	test('filters while typing, and says why an entry matched', async ({ page }) => {
		await page.goto('/');
		await page.getByLabel('Search the library').fill('expansion');
		await expect(page.locator('.count-text')).toHaveText('3 of 7 games');
		expect(await titles(page)).toEqual(['Expansion Only Game', 'Lonely Expansion', 'The Long Dark Road']);
		await expect(page.locator('.card', { hasText: 'The Long Dark Road' }).locator('.card-reason')).toHaveText('contains: Road Expansion');
		await expect(page).toHaveURL(/\?q=expansion$/);
	});

	test('keeps the search in the address, through a reload', async ({ page }) => {
		await page.goto('/?q=stastny');
		await expect(page.getByLabel('Search the library')).toHaveValue('stastny');
		expect(await titles(page)).toEqual(['The Long Dark Road']);
		await expect(page.locator('.card-reason')).toHaveText('by Šťastný Studio');
	});

	test('offers one way back when nothing matches', async ({ page }) => {
		await page.goto('/?q=zzzz&os=linux');
		await expect(page.locator('.empty h2')).toHaveText('No game matches');
		await expect(page.locator('.empty p')).toHaveText('Nothing in the library matches “zzzz” with the filters that are on.');
		await page.getByRole('button', { name: 'Clear search and filters' }).click();
		await expect(page.locator('.count-text')).toHaveText('7 games');
		await expect(page).toHaveURL(/\/$/);
	});

	test('is reached with "/" and cleared with Esc', async ({ page }) => {
		await page.goto('/');
		await page.keyboard.press('/');
		const box = page.getByLabel('Search the library');
		await expect(box).toBeFocused();
		await page.keyboard.type('road');
		await expect(box).toHaveValue('road');
		await page.keyboard.press('Escape');
		await expect(box).toHaveValue('');
		await expect(page.locator('.count-text')).toHaveText('7 games');
	});

	test('shows one cross in the search box, its own: the browser draws none beside it', async ({ page }) => {
		await page.goto('/');
		const box = page.getByLabel('Search the library');
		const clear = page.getByRole('button', { name: 'Clear the search' });
		// The strip of the box to the left of Canvas's own cross, where a browser draws its cross.
		const strip = async (): Promise<Buffer> => {
			const field = (await box.boundingBox())!;
			return page.screenshot({
				clip: { x: field.x + field.width - 80, y: field.y + 4, width: 44, height: field.height - 8 }
			});
		};

		// With the focus and no text the strip is empty.
		await box.focus();
		const empty = await strip();

		await box.fill('road');
		await expect(clear).toBeVisible();
		// Canvas's cross is to the right of the strip.
		const field = (await box.boundingBox())!;
		const own = (await clear.boundingBox())!;
		expect(own.x).toBeGreaterThanOrEqual(field.x + field.width - 36);
		// With text the strip is still empty: no second cross.
		expect((await strip()).equals(empty)).toBe(true);
	});

	test('writes the address once the typing pauses, and keeps the focus and the place', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 400 });
		await page.goto('/');
		await page.evaluate(() => {
			const w = window as unknown as { writes: number };
			w.writes = 0;
			const replace = history.replaceState.bind(history);
			history.replaceState = (...args) => {
				w.writes++;
				replace(...args);
			};
			window.scrollTo(0, 120);
		});
		const box = page.getByLabel('Search the library');
		await box.focus();
		await page.keyboard.type('expansion', { delay: 40 });
		await expect(page).toHaveURL(/\?q=expansion$/);
		expect(await page.evaluate(() => (window as unknown as { writes: number }).writes)).toBe(1);
		await expect(box).toBeFocused();
		expect(await page.evaluate(() => window.scrollY)).toBe(120);
	});

	test('comes back with Back after the logo was clicked', async ({ page }) => {
		await page.goto('/');
		const box = page.getByLabel('Search the library');
		await box.fill('road');
		// At once: what leaves the list takes the address along, also while it is still being typed.
		await page.locator('.brand').click();
		await expect(box).toHaveValue('');
		await expect(page.locator('.card')).toHaveCount(7);

		await page.goBack();
		await expect(page).toHaveURL(/\/\?q=road$/);
		await expect(box).toHaveValue('road');
		await expect(page.locator('.card')).toHaveCount(1);
		await expect(page.locator('dialog.detail')).toBeHidden();
	});

	test('takes what is typed as text', async ({ page }) => {
		await page.goto('/');
		await page.getByLabel('Search the library').fill('<img src=x onerror=alert(1)> "');
		await expect(page.locator('.empty p')).toContainText('<img src=x onerror=alert(1)> "');
		await expect(page.locator('.empty img')).toHaveCount(0);
	});
});

test.describe('filters', () => {
	test('narrow the list from the bar and from the panel, and show what is on', async ({ page }) => {
		await page.goto('/');
		await page.locator('.os-toggle').getByRole('button', { name: 'Linux' }).click();
		expect(await titles(page)).toEqual(['The Long Dark Road']);

		await page.getByRole('button', { name: 'Filters, 1 on' }).click();
		const panel = page.locator('dialog.filters');
		await expect(panel).toBeVisible();
		await panel.getByRole('button', { name: /^Linux/ }).click();
		await panel.getByRole('button', { name: /^Strategy/ }).click();
		await expect(panel.getByRole('button', { name: 'Show 2 games' })).toBeVisible();
		// The list behind the panel has changed already.
		expect(await titles(page)).toEqual(['Lonely Expansion', 'Windows Only Game']);
		await panel.getByRole('button', { name: /^Co-op/ }).click();
		await panel.getByRole('button', { name: 'Show 0 games' }).click();
		await expect(panel).toBeHidden();

		await expect(page).toHaveURL(/\?genre=Strategy&play=coop$/);
		await expect(page.locator('.active-chip')).toHaveText(['Co-opRemove the filter Co-op', 'StrategyRemove the filter Strategy']);
		await page.getByRole('button', { name: 'Remove the filter Co-op' }).click();
		await expect(page.locator('.count-text')).toHaveText('2 of 7 games');
	});

	test('need a genre and a setting to hold both', async ({ page }) => {
		// No entry of the fixtures has a setting, so a setting and a genre together match nothing.
		await page.goto('/?genre=Strategy&genre=Fantasy');
		await expect(page.locator('.empty h2')).toBeVisible();
		await page.goto('/?genre=Strategy&genre=Adventure');
		await expect(page.locator('.count-text')).toHaveText('3 of 7 games');
	});

	test('are remembered for the platform and the order, and an address wins over them', async ({ page }) => {
		await page.goto('/');
		await page.locator('.os-toggle').getByRole('button', { name: 'macOS' }).click();
		await page.getByRole('button', { name: 'Recently added' }).click();
		await page.goto('/');
		await expect(page.locator('.os-toggle').getByRole('button', { name: 'macOS' })).toHaveAttribute('aria-pressed', 'true');
		await expect(page).toHaveURL(/\?os=macos&sort=recent$/);
		expect(await titles(page)).toEqual(['The Long Dark Road']);

		await page.goto('/?q=record');
		await expect(page.locator('.os-toggle').getByRole('button', { name: 'macOS' })).toHaveAttribute('aria-pressed', 'false');
		expect(await titles(page)).toEqual(['Broken Record']);
	});

	test.describe('what the browser remembers', () => {
		const macos = (page: Page) => page.locator('.os-toggle').getByRole('button', { name: 'macOS' });

		test('stays when the library is reached by a link', async ({ page }) => {
			await page.goto('/');
			await macos(page).click();
			await page.goto('/no/such/page');
			await page.getByRole('link', { name: 'Go to the library' }).click();
			await expect(page).toHaveURL(/\/\?os=macos$/);
			await expect(macos(page)).toHaveAttribute('aria-pressed', 'true');
			expect(await titles(page)).toEqual(['The Long Dark Road']);
		});

		test('stays when the logo is clicked, and the search goes', async ({ page }) => {
			await page.goto('/');
			await macos(page).click();
			await page.getByLabel('Search the library').fill('road');
			await page.locator('.brand').click();
			await expect(page.getByLabel('Search the library')).toHaveValue('');
			await expect(macos(page)).toHaveAttribute('aria-pressed', 'true');
			await expect(page).toHaveURL(/\/\?os=macos$/);
		});

		test('stays when a detail opened by its address is closed', async ({ page }) => {
			await page.goto('/');
			await macos(page).click();
			await page.goto('/game/1002');
			await page.keyboard.press('Escape');
			await expect(page).toHaveURL(/\/\?os=macos$/);
			await expect(macos(page)).toHaveAttribute('aria-pressed', 'true');
			expect(await titles(page)).toEqual(['The Long Dark Road']);
		});

		test('is kept by a tag search, and changed by nothing but the visitor', async ({ page }) => {
			await page.goto('/');
			await macos(page).click();
			await page.locator('.card').first().click();
			await page.locator('dialog.detail').getByRole('button', { name: 'Atmospheric' }).click();
			await expect(page).toHaveURL(/\/\?q=Atmospheric&os=macos$/);
			await expect(macos(page)).toHaveAttribute('aria-pressed', 'true');
			await page.getByLabel('Search the library').fill('');
			await expect(page).toHaveURL(/\/\?os=macos$/);
			expect(await page.evaluate(() => document.cookie)).toBe('canvas-view=macos|title');
		});

		test('is not changed by a shared address, nor by searching in it', async ({ page }) => {
			await page.goto('/');
			await macos(page).click();
			await page.goto('/?q=road');
			await expect(macos(page)).toHaveAttribute('aria-pressed', 'false');
			const box = page.getByLabel('Search the library');
			await box.fill('record');
			await expect(page).toHaveURL(/\/\?q=record$/);
			await box.fill('');
			await expect(page).toHaveURL(/\/$/);
			expect(await page.evaluate(() => document.cookie)).toBe('canvas-view=macos|title');
			await page.locator('.brand').click();
			await expect(page).toHaveURL(/\/\?os=macos$/);
			await expect(macos(page)).toHaveAttribute('aria-pressed', 'true');
		});

		test('takes only the order from a shared address when the visitor changes the order', async ({ page }) => {
			await page.goto('/?os=linux');
			await page.getByRole('button', { name: 'Recently added' }).click();
			await expect.poll(() => page.evaluate(() => document.cookie)).toBe('canvas-view=|recent');
		});

		test('takes only the platform from a shared address when the visitor changes the platform', async ({ page }) => {
			await page.goto('/?sort=recent');
			await page.locator('.os-toggle').getByRole('button', { name: 'Linux' }).click();
			await expect.poll(() => page.evaluate(() => document.cookie)).toBe('canvas-view=linux|title');
		});

		test('adds no entry to the history when the logo is clicked on the list it names', async ({ page }) => {
			await page.goto('/');
			const length = () => page.evaluate(() => history.length);
			const before = await length();
			const box = page.getByLabel('Search the library');
			await box.fill('r');
			await box.fill('');
			await page.locator('.brand').click();
			await expect(page).toHaveURL(/\/$/);
			// A pause, to let a second entry show up if there were one.
			await page.waitForTimeout(400);
			expect(await length()).toBe(before);
		});

		test('yields to an address with parameters', async ({ page }) => {
			await page.goto('/');
			await macos(page).click();
			await page.goto('/?q=road');
			await expect(macos(page)).toHaveAttribute('aria-pressed', 'false');
			await expect(page).toHaveURL(/\?q=road$/);
		});
	});

	test('in the panel move nothing when the panel becomes too low for them', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 1200 });
		await page.goto('/');
		await page.getByRole('button', { name: 'Filters' }).click();
		const panel = page.locator('dialog.filters');
		await expect(panel).toBeVisible();
		await panel.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)));
		const body = page.locator('.filters-body');
		expect(await body.evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true);
		const watched = ['.os-cards button:nth-child(1)', '.os-cards button:nth-child(3)', '.filters-body .chip-set .chip'];
		// Left and width: the panel's height changes, so the tops may not stay.
		const at = async () => (await Promise.all(watched.map((selector) => place(page, selector)))).map(([left, , width]) => [left, width]);
		const before = await at();

		await page.setViewportSize({ width: 1440, height: 400 });
		expect(await body.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
		expect(await at()).toEqual(before);
	});

	test('move nothing on the page', async ({ page }) => {
		await page.goto('/');
		const watched = ['.card', '.os-toggle', '.filter-button', '.sort', '.sort button', '.brand'];
		const places = () => Promise.all(watched.map((selector) => place(page, selector)));
		const before = await places();

		await page.locator('.card').first().hover();
		expect(await places()).toEqual(before);
		await page.locator('.os-toggle').getByRole('button', { name: 'Windows' }).click();
		expect(await places()).toEqual(before);
		await page.getByRole('button', { name: 'Recently added' }).click();
		expect(await places()).toEqual(before);
		await page.getByRole('button', { name: 'Filters, 1 on' }).click();
		await expect(page.locator('dialog.filters')).toBeVisible();
		expect(await places()).toEqual(before);
		await page.keyboard.press('Escape');
		await page.locator('.card').first().click();
		await expect(page.locator('dialog.detail')).toBeVisible();
		expect(await places()).toEqual(before);
	});
});
