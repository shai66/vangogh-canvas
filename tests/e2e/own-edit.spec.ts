import type { Page, Request } from '@playwright/test';
import { byTitle, type OwnMember } from '../../src/lib/own';
import { arrived, expect, place, test } from './helpers';

// This Canvas has the seventeen games of collectionLibrary() and an empty settings folder of its own. The tests run one
// after another, as the collections they make stay; each makes its own, with names of its own, and picks its games
// with Collections off, where every game has a card whatever collection holds it.
test.describe.configure({ mode: 'serial' });
test.use({ baseURL: process.env.CANVAS_OWN_EDIT_URL });

/** Unlocks this browser with the PIN, as the prompt does: the cookie lands in the page's context. */
async function unlock(page: Page): Promise<void> {
	expect((await page.request.post('/api/settings/unlock', { data: { pin: '2468' } })).status()).toBe(204);
}

/** Makes an own collection as another browser would, and gives its id. */
async function make(page: Page, name: string, members: OwnMember[]): Promise<string> {
	const res = await page.request.post('/api/collections', { data: { name, members } });
	expect(res.status()).toBe(201);
	return ((await res.json()) as { collection: { id: string } }).collection.id;
}

/** Opens the list, starts picking and picks the games of `ids`. */
async function pick(page: Page, ids: string[]): Promise<void> {
	await page.goto('/');
	await page.locator('.bar .select-toggle').click();
	for (const id of ids) await page.locator(`a[href="/game/${id}"]`).click();
	await expect(page.locator('.pickbar-count strong')).toHaveText(`${ids.length} selected`);
}

/** The requests that make an own collection. */
function creates(page: Page): Request[] {
	const sent: Request[] = [];
	page.on('request', (request) => {
		if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/collections') sent.push(request);
	});
	return sent;
}

const answer = (status: number, error: string) => ({ status, contentType: 'application/json', body: JSON.stringify({ error }) });

test('New collection makes one from the picks and opens its sheet', async ({ page }) => {
	await unlock(page);
	// Night Ferry (4117) with Collections off, then GOG's series Thornwick Mysteries (4101, 4102, 4103) with it on.
	await pick(page, ['4117']);
	await page.locator('.bar .view-toggle:not(.select-toggle)').click();
	await page.locator('a[href="/collection/s500"]').click();
	const bar = page.locator('.pickbar');
	await expect(bar.locator('.pickbar-count strong')).toHaveText('2 selected');

	await bar.getByRole('button', { name: 'New collection', exact: true }).click();
	const dialog = page.locator('dialog.new-coll');
	await expect(dialog).toBeVisible();
	await expect(dialog.locator('h1')).toHaveText('New collection');
	await expect(dialog.locator('.pin-text')).toHaveText('1 game and 1 GOG collection. You can add more, or take some out, later.');
	// The picture of what is picked, oldest first: the series, then Night Ferry.
	await expect(dialog.locator('.new-preview .own-strip')).toHaveCount(2);
	await expect(dialog.locator('.new-preview .own-strip-badge')).toHaveText('3');
	const field = dialog.locator('input');
	await expect(field).toBeFocused();
	await expect(field).toHaveAttribute('placeholder', 'Name');
	const create = dialog.getByRole('button', { name: 'Create' });
	await expect(create).toBeDisabled();
	await field.fill('Ferry and friends');
	await expect(dialog.locator('.new-name')).toHaveText('Ferry and friends');
	await create.click();

	const sheet = page.locator('dialog.detail');
	await expect(sheet.locator('h1')).toHaveText('Ferry and friends');
	await expect(sheet.locator('.detail-makers')).toContainText('4 games in your library');
	await expect(sheet.locator('.coll-grid > .card')).toHaveCount(2);
	await expect(page).toHaveURL(/\/collection\/h\d+$/);
	const href = new URL(page.url()).pathname;
	// Picking has ended.
	await expect(page.locator('.pickbar')).toHaveCount(0);
	await expect(dialog).toHaveCount(0);

	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
	await expect(page.locator(`a.card.is-own[href="${href}"] .card-title`)).toHaveText('Ferry and friends');
	await expect(page.locator('a[href="/collection/s500"], a[href="/game/4117"]')).toHaveCount(0);
});

test('Create stays off for a name of spaces, and a taken name says so', async ({ page }) => {
	await unlock(page);
	await make(page, 'Party Night', []);
	await pick(page, ['4115']);
	await page.locator('.pickbar').getByRole('button', { name: 'New collection', exact: true }).click();
	const dialog = page.locator('dialog.new-coll');
	const field = dialog.locator('input');
	const create = dialog.getByRole('button', { name: 'Create' });
	const error = dialog.locator('.pin-error');
	const sent = creates(page);
	// The dialog rises into place: measure once it has arrived.
	await dialog.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)));
	const measure = () => Promise.all(['.pin-unlock', 'input', '.new-preview'].map((s) => place(page, `dialog.new-coll ${s}`)));
	const before = await measure();

	await field.fill('   ');
	await expect(create).toBeDisabled();
	await expect(error).toHaveText('');

	await field.fill('party night');
	await expect(error).toHaveText('There is already a collection of that name.');
	await expect(field).toHaveAttribute('aria-invalid', 'true');
	await expect(create).toBeDisabled();
	await field.press('Enter');
	expect(await measure()).toEqual(before);

	// A long name stays on one line under the picture: nothing in the dialog moves while it is typed.
	await field.fill('A name long enough to wrap under the picture more than once');
	await expect(error).toHaveText('');
	await expect(create).toBeEnabled();
	expect(await measure()).toEqual(before);

	// Esc goes back to picking, with the picks.
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(page.locator('.pickbar-count strong')).toHaveText('1 selected');
	await expect(page.locator('a[href="/game/4115"]')).toHaveClass(/is-picked/);
	expect(sent).toEqual([]);
});

test('Add to adds to an existing one and opens it', async ({ page }) => {
	await unlock(page);
	const id = await make(page, 'Shelf A', [{ game: '4117' }]);
	await pick(page, ['4116']);
	const bar = page.locator('.pickbar');
	const addTo = bar.getByRole('button', { name: 'Add to…' });
	const list = page.locator('.addto-pop');
	const BAR = ['.pickbar', '.pickbar-count', ...['Add to…', 'New collection', 'Cancel'].map((name) => `.pickbar button:text-is("${name}")`)];
	const measure = () => Promise.all(BAR.map((s) => place(page, s)));
	const before = await measure();

	// Esc, and a click beside it, close the list and keep the picks.
	await addTo.click();
	await expect(list).toBeVisible();
	await expect(addTo).toHaveAttribute('aria-expanded', 'true');
	expect(await measure()).toEqual(before);
	await page.keyboard.press('Escape');
	await expect(list).toHaveCount(0);
	await expect(bar.locator('.pickbar-count strong')).toHaveText('1 selected');
	// A click beside it only closes it: on the picked card, on Cancel or on Select, it neither unpicks nor ends picking.
	for (const beside of [page.locator('a[href="/game/4116"]'), bar.getByRole('button', { name: 'Cancel' }), page.locator('.bar .select-toggle')]) {
		await addTo.click();
		await expect(list).toBeVisible();
		await beside.click();
		await expect(list).toHaveCount(0);
		await expect(bar.locator('.pickbar-count strong')).toHaveText('1 selected');
		await expect(page.locator('a[href="/game/4116"]')).toHaveClass(/is-picked/);
		await expect(page.locator('.bar .select-toggle')).toHaveAttribute('aria-pressed', 'true');
	}
	await expect(page).toHaveURL(/\/$/);

	await addTo.click();
	await expect(list.locator('.addto-head')).toHaveText('Add 1 to');
	// Every own collection A to Z, then "New collection…".
	const names = await list.locator('.addto-row:not(.addto-new) .addto-name').allTextContents();
	expect(names).toContain('Shelf A');
	expect(names).toEqual([...names].sort(byTitle));
	await expect(list.locator('.addto-row').last()).toHaveText('New collection…');
	const row = list.locator('.addto-row', { hasText: 'Shelf A' });
	await expect(row.locator('.addto-count')).toHaveText('1');
	await expect(row.locator('.addto-thumb .own-strip')).toHaveCount(1);
	await expect(row.locator('.own-strip-badge')).toHaveCount(0);
	await row.click();

	const sheet = page.locator('dialog.detail');
	await expect(sheet.locator('h1')).toHaveText('Shelf A');
	await expect(page).toHaveURL(new RegExp(`/collection/${id}$`));
	await expect(sheet.locator('.coll-grid > .card')).toHaveCount(2);
	await expect(sheet.locator('a[href="/game/4116"]')).toHaveCount(1);
	await expect(page.locator('.pickbar')).toHaveCount(0);
});

test('a collection deleted in another browser is gone', async ({ page }) => {
	await unlock(page);
	const id = await make(page, 'Shelf B', [{ game: '4115' }]);
	await pick(page, ['4116']);
	const addTo = page.locator('.pickbar').getByRole('button', { name: 'Add to…' });
	await addTo.click();
	const row = page.locator('.addto-pop .addto-row', { hasText: 'Shelf B' });
	await expect(row).toBeVisible();
	expect((await page.request.delete(`/api/collections/${id}`)).status()).toBe(204);

	await row.click();
	await expect(page.locator('.pickbar-error')).toHaveText('That collection is gone. It was deleted in another browser.');
	await expect(page.locator('.pickbar-count strong')).toHaveText('1 selected');
	await expect(page.locator('dialog.detail')).toBeHidden();
	await addTo.click();
	await expect(page.locator('.addto-pop .addto-row').last()).toHaveText('New collection…');
	await expect(row).toHaveCount(0);
});

test('an unwritable folder says so and keeps the picks', async ({ page }) => {
	await unlock(page);
	await make(page, 'Shelf C', [{ game: '4115' }]);
	// What Canvas answers when its settings folder cannot be written. The requests of the test itself are not routed.
	await page.route(/\/api\/collections(\/[^/]+)?$/, (route) => route.fulfill(answer(500, 'settings-unwritable')));
	await pick(page, ['4117', '4116']);
	const bar = page.locator('.pickbar');
	const addTo = bar.getByRole('button', { name: 'Add to…' });
	const unwritable = 'Canvas cannot save settings: the folder /settings cannot be written. Give the container a volume there, as the README shows.';

	await addTo.click();
	await page.locator('.addto-pop .addto-row', { hasText: 'Shelf C' }).click();
	await expect(bar.locator('.pickbar-error')).toHaveText(unwritable);
	await expect(bar.locator('.pickbar-count strong')).toHaveText('2 selected');
	await expect(page.locator('dialog.detail')).toBeHidden();
	// Nothing changed in the page's copy.
	await addTo.click();
	await expect(page.locator('.addto-pop .addto-row', { hasText: 'Shelf C' }).locator('.addto-count')).toHaveText('1');
	await page.keyboard.press('Escape');
	// A pick changed: the line says what is picked again.
	await page.locator('a[href="/game/4116"]').click();
	await expect(bar.locator('.pickbar-what')).toHaveText('1 game');

	// In the dialog the line is under the field, and the dialog stays.
	await page.locator('a[href="/game/4116"]').click();
	await bar.getByRole('button', { name: 'New collection', exact: true }).click();
	const dialog = page.locator('dialog.new-coll');
	await dialog.locator('input').fill('Shelf D');
	await dialog.getByRole('button', { name: 'Create' }).click();
	await expect(dialog.locator('.pin-error')).toHaveText(unwritable);
	await expect(dialog).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(bar.locator('.pickbar-count strong')).toHaveText('2 selected');
});

test('a 401 brings the PIN prompt, and the picks are there after it', async ({ page }) => {
	await unlock(page);
	// The browser was locked meanwhile, once: in another tab, or the 30 days ran out.
	await page.route('**/api/collections', (route) => route.fulfill(answer(401, 'locked')), { times: 1 });
	await pick(page, ['4117', '4116']);
	const sent = creates(page);
	await page.locator('.pickbar').getByRole('button', { name: 'New collection', exact: true }).click();
	const dialog = page.locator('dialog.new-coll');
	await dialog.locator('input').fill('Kept picks');
	await dialog.getByRole('button', { name: 'Create' }).click();

	const prompt = page.locator('dialog.pin:not(.new-coll)');
	await expect(prompt).toBeVisible();
	await expect(prompt.locator('.pin-text')).toHaveText('Settings were locked again. Enter the PIN.');
	await expect(prompt.locator('input')).toBeFocused();
	await prompt.locator('input').fill('2468');
	await prompt.locator('input').press('Enter');
	await expect(prompt).toBeHidden();

	// Back where the person was: picking, with the picks and the name, and nothing sent again by itself.
	await expect(page.locator('.pickbar-count strong')).toHaveText('2 selected');
	await expect(page.locator('.bar .select-toggle')).toHaveAttribute('aria-pressed', 'true');
	await expect(dialog).toBeVisible();
	await expect(dialog.locator('input')).toHaveValue('Kept picks');
	await expect(dialog.locator('.pin-error')).toHaveText('');
	expect(sent).toHaveLength(1);

	// Nothing was made: the same name is free.
	await dialog.getByRole('button', { name: 'Create' }).click();
	await expect(page.locator('dialog.detail h1')).toHaveText('Kept picks');
	await expect(page.locator('dialog.detail .coll-grid > .card')).toHaveCount(2);
	expect(sent).toHaveLength(2);
});

// Editing in an own collection's sheet (spec of own collections, section 9.2).

/** Opens the sheet of `id` by a click on its card in the list with Collections on, and waits for it to arrive. */
async function openSheet(page: Page, id: string): Promise<void> {
	await page.goto('/?view=collections');
	await page.locator(`.grid > a[href="/collection/${id}"]`).click();
	await expect(page).toHaveURL(new RegExp(`/collection/${id}$`));
	await arrived(page);
}

const HINT = 'Pick cards to take them out or add them to another collection';

test('Edit renames on Enter, and the head keeps its height', async ({ page }) => {
	await unlock(page);
	await make(page, 'Name Taken', []);
	const id = await make(page, 'Name A', [{ game: '4115' }]);
	await openSheet(page, id);
	const sheet = page.locator('dialog.detail');
	const head = '.coll-head .detail-info';
	const card = '.coll-grid > .card';
	const before = await place(page, head);
	const title = await place(page, `${head} h1.detail-title`);
	const first = await place(page, card);

	await sheet.locator('.own-edit-row').getByRole('button', { name: 'Edit' }).click();
	const field = sheet.locator('.own-title-field');
	await expect(field).toHaveValue('Name A');
	await expect(field).toHaveAttribute('aria-label', 'Name');
	await expect(sheet.locator('.own-edit-row .on button')).toHaveText(['Done', 'Delete collection']);
	// The name's field starts where the title did, as high as it; the head is as high; no card moves.
	const [left, top, , height] = await place(page, '.own-title-field');
	expect([left, top, height]).toEqual([title[0], title[1], title[3]]);
	expect(await place(page, head)).toEqual(before);
	expect(await place(page, card)).toEqual(first);

	// A name already used is refused under the field, and the old name stays.
	await field.fill('name taken');
	await field.press('Enter');
	await expect(sheet.locator('.own-name-error')).toHaveText('There is already a collection of that name.');
	await expect(field).toHaveValue('Name A');
	await expect(field).toHaveAttribute('aria-invalid', 'true');
	expect(await place(page, head)).toEqual(before);
	// An empty name goes back to the old one, and nothing is sent.
	await field.fill('   ');
	await expect(sheet.locator('.own-name-error')).toHaveCount(0);
	await field.press('Enter');
	await expect(field).toHaveValue('Name A');

	await field.fill('Name B');
	await field.press('Enter');
	await expect(page).toHaveTitle('Name B | Canvas for vangogh');
	await expect(field).toHaveValue('Name B');
	await sheet.getByRole('button', { name: 'Done' }).click();
	await expect(sheet.locator('h1')).toHaveText('Name B');
	expect(await place(page, head)).toEqual(before);

	await sheet.locator('.detail-close').click();
	await expect(sheet).toBeHidden();
	await expect(page.locator(`a[href="/collection/${id}"] .card-title`)).toHaveText('Name B');
});

test('Take out takes picked cards out, and they come back to the list', async ({ page }) => {
	await unlock(page);
	// GOG's pack Parallax Racing Trilogy (4104, 4105), in no other own collection here, and Night Ferry.
	const id = await make(page, 'Out A', [{ collection: 'p4802' }, { game: '4117' }]);
	await openSheet(page, id);
	const sheet = page.locator('dialog.detail');
	await sheet.getByRole('button', { name: 'Edit' }).click();
	const bar = sheet.locator('.take-bar');
	const takeOut = bar.getByRole('button', { name: 'Take out' });
	await expect(bar.locator('.take-n')).toHaveText(HINT);
	await expect(bar.getByRole('button', { name: 'Add to…' })).toBeDisabled();
	await expect(takeOut).toBeDisabled();
	await expect(sheet.locator('.coll-grid > .card .pick-dot')).toHaveCount(2);

	// A click picks, and does not open.
	await sheet.locator('.coll-grid a[href="/collection/p4802"]').click();
	await expect(page).toHaveURL(new RegExp(`/collection/${id}$`));
	await expect(sheet.locator('.coll-grid a[href="/collection/p4802"]')).toHaveAttribute('aria-pressed', 'true');
	await expect(bar.locator('.take-n')).toHaveText('1 selected');
	await takeOut.click();
	await expect(sheet.locator('.coll-grid > .card .card-title')).toHaveText(['Night Ferry']);
	await expect(bar.locator('.take-n')).toHaveText(HINT);

	await sheet.locator('.detail-close').click();
	await expect(sheet).toBeHidden();
	await expect(page.locator('main .grid > a[href="/collection/p4802"]')).toHaveCount(1);
});

test('Add to puts the series into a second collection, and both sheets list it', async ({ page }) => {
	await unlock(page);
	const a = await make(page, 'Two A', [{ collection: 's500' }]);
	const b = await make(page, 'Two B', []);
	await openSheet(page, a);
	const sheet = page.locator('dialog.detail');
	await sheet.getByRole('button', { name: 'Edit' }).click();
	await sheet.locator('.coll-grid a[href="/collection/s500"]').click();
	await sheet.locator('.take-bar').getByRole('button', { name: 'Add to…' }).click();
	const list = sheet.locator('.addto-pop');
	await expect(list.locator('.addto-head')).toHaveText('Add 1 to');
	// The other own collections: not this one.
	const names = await list.locator('.addto-row:not(.addto-new) .addto-name').allTextContents();
	expect(names).toContain('Two B');
	expect(names).not.toContain('Two A');
	await list.locator('.addto-row', { hasText: 'Two B' }).click();

	await expect(page).toHaveURL(new RegExp(`/collection/${b}$`));
	await expect(sheet.locator('h1')).toHaveText('Two B');
	await expect(sheet.locator('.coll-grid > .card')).toHaveCount(1);
	await expect(sheet.locator('.coll-grid a[href="/collection/s500"]')).toHaveCount(1);

	// Back returns to the first sheet, not editing, which still lists the series.
	await page.goBack();
	await expect(page).toHaveURL(new RegExp(`/collection/${a}$`));
	await expect(sheet.locator('h1')).toHaveText('Two A');
	await expect(sheet.locator('.coll-grid a[href="/collection/s500"]')).toHaveCount(1);
	await expect(sheet.locator('.pick-dot')).toHaveCount(0);
});

test('New collection from a sheet makes one with the picked cards', async ({ page }) => {
	await unlock(page);
	const a = await make(page, 'From A', [{ collection: 's500' }, { game: '4117' }]);
	await openSheet(page, a);
	const sheet = page.locator('dialog.detail');
	await sheet.getByRole('button', { name: 'Edit' }).click();
	await sheet.locator('.coll-grid a[href="/game/4117"]').click();
	await sheet.locator('.take-bar').getByRole('button', { name: 'Add to…' }).click();
	await sheet.locator('.addto-pop .addto-new').click();

	const dialog = page.locator('dialog.new-coll');
	await expect(dialog).toBeVisible();
	await expect(dialog.locator('.pin-text')).toHaveText('1 game. You can add more, or take some out, later.');
	await expect(dialog.locator('.new-preview .own-strip')).toHaveCount(1);
	await dialog.locator('input').fill('From B');
	await dialog.getByRole('button', { name: 'Create' }).click();

	await expect(dialog).toBeHidden();
	await expect(sheet.locator('h1')).toHaveText('From B');
	await expect(page).not.toHaveURL(new RegExp(`/collection/${a}$`));
	await expect(sheet.locator('.coll-grid > .card .card-title')).toHaveText(['Night Ferry']);

	await page.goBack();
	await expect(sheet.locator('h1')).toHaveText('From A');
	await expect(sheet.locator('.coll-grid a[href="/game/4117"]')).toHaveCount(1);
	await expect(sheet.locator('.coll-grid > .card')).toHaveCount(2);
});

test('Delete asks first, Keep keeps, Delete deletes', async ({ page }) => {
	await unlock(page);
	// GOG's pack Lantern Coast Saga, in no other own collection here.
	const id = await make(page, 'Del A', [{ collection: 'p4803' }]);
	await openSheet(page, id);
	await expect(page.locator('main .grid > a[href="/collection/p4803"]')).toHaveCount(0);
	const sheet = page.locator('dialog.detail');
	const row = sheet.locator('.own-edit-row');
	const head = '.coll-head .detail-info';
	const before = await place(page, head);

	await row.getByRole('button', { name: 'Edit' }).click();
	await row.getByRole('button', { name: 'Delete collection' }).click();
	await expect(row.locator('.own-confirm-text')).toHaveText('Delete “Del A”? Its games stay in the library.');
	await expect(row.locator('.on button')).toHaveText(['Delete', 'Keep']);
	expect(await place(page, head)).toEqual(before);

	await row.getByRole('button', { name: 'Keep' }).click();
	await expect(row.locator('.on button')).toHaveText(['Done', 'Delete collection']);
	await expect(sheet.locator('.own-title-field')).toBeVisible();

	await row.getByRole('button', { name: 'Delete collection' }).click();
	await row.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(sheet).toBeHidden();
	await expect(page).toHaveURL(/\/\?view=collections$/);
	await expect(page.locator(`a[href="/collection/${id}"]`)).toHaveCount(0);
	await expect(page.locator('main .grid > a[href="/collection/p4803"]')).toHaveCount(1);
	expect((await page.request.delete(`/api/collections/${id}`)).status()).toBe(404);
});

test('Esc ends editing, then closes', async ({ page }) => {
	await unlock(page);
	const id = await make(page, 'Esc A', [{ game: '4117' }, { game: '4116' }]);
	await openSheet(page, id);
	const sheet = page.locator('dialog.detail');
	await sheet.getByRole('button', { name: 'Edit' }).click();
	await sheet.locator('.coll-grid a[href="/game/4117"]').click();
	await sheet.locator('.take-bar').getByRole('button', { name: 'Add to…' }).click();
	await expect(sheet.locator('.addto-pop')).toBeVisible();

	// The list first, then editing, then the sheet.
	await page.keyboard.press('Escape');
	await expect(sheet.locator('.addto-pop')).toHaveCount(0);
	await expect(sheet.locator('.take-n')).toHaveText('1 selected');
	await page.keyboard.press('Escape');
	await expect(sheet.locator('.own-edit-row').getByRole('button', { name: 'Edit' })).toBeVisible();
	await expect(sheet.locator('.pick-dot')).toHaveCount(0);
	await expect(sheet.locator('.take-bar')).toBeHidden();
	await expect(sheet).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
});

test('a 401 during Take out brings the PIN prompt, then the sheet, not editing, with the cards still in it', async ({ page }) => {
	await unlock(page);
	const id = await make(page, 'Lock A', [{ game: '4117' }, { game: '4116' }]);
	// The browser was locked meanwhile, once: in another tab, or the 30 days ran out.
	await page.route(/\/api\/collections\/h\d+$/, (route) => (route.request().method() === 'PATCH' ? route.fulfill(answer(401, 'locked')) : route.fallback()), {
		times: 1
	});
	await openSheet(page, id);
	const sheet = page.locator('dialog.detail');
	await sheet.getByRole('button', { name: 'Edit' }).click();
	await sheet.locator('.coll-grid a[href="/game/4116"]').click();
	await sheet.locator('.take-bar').getByRole('button', { name: 'Take out' }).click();

	const prompt = page.locator('dialog.pin:not(.new-coll)');
	await expect(prompt).toBeVisible();
	await expect(prompt.locator('.pin-text')).toHaveText('Settings were locked again. Enter the PIN.');
	await prompt.locator('input').fill('2468');
	await prompt.locator('input').press('Enter');
	await expect(prompt).toBeHidden();

	await expect(sheet.locator('h1')).toHaveText('Lock A');
	await expect(sheet.locator('.own-edit-row').getByRole('button', { name: 'Edit' })).toBeVisible();
	await expect(sheet.locator('.pick-dot')).toHaveCount(0);
	await expect(sheet.locator('.coll-grid > .card')).toHaveCount(2);
	await expect(sheet.locator('.notice')).toHaveCount(0);
});

test('the head keeps its height at rest, while editing and while asking, for a name on two lines, wide and narrow', async ({ page }) => {
	await unlock(page);
	const name = 'Long afternoons with the lighthouse and the harbour games';
	const id = await make(page, name, [{ game: '4115' }]);
	const sheet = page.locator('dialog.detail');
	const row = sheet.locator('.own-edit-row');
	const title = '.coll-head h1.detail-title';
	// The head's box, its column of text, the title, and where the cards start under it. The bar at the sheet's foot comes
	// while editing, after the cards: it is measured by nothing here, as it moves nothing.
	const measure = () => Promise.all(['.coll-head', '.coll-head .detail-info', title, '.coll-body'].map((s) => place(page, s)));
	const top = (box: [number, number, number, number][]) => [box[0][1], box[1][1], box[1][3], box[2][1], box[2][3], box[3][1]];
	for (const width of [1440, 390]) {
		await page.setViewportSize({ width, height: 844 });
		await openSheet(page, id);
		const [, , , lines] = await place(page, title);
		const lineHeight = await page.locator(title).evaluate((node) => parseFloat(getComputedStyle(node).lineHeight));
		expect(lines).toBeGreaterThanOrEqual(2 * lineHeight - 1);
		const rest = top(await measure());

		await row.getByRole('button', { name: 'Edit' }).click();
		const field = sheet.locator('.own-title-field');
		await expect(field).toHaveValue(name);
		expect(top(await measure())).toEqual(rest);
		// The field lies on the title's box.
		expect(await place(page, '.own-title-field')).toEqual(await place(page, title));
		// The field draws no scrollbar, and the name fits its box (to a pixel of rounding).
		expect(await field.evaluate((node: HTMLTextAreaElement) => [node.offsetWidth - node.clientWidth, node.scrollHeight - node.clientHeight <= 1])).toEqual([0, true]);

		await row.getByRole('button', { name: 'Delete collection' }).click();
		await expect(row.locator('.on .own-confirm-text')).toBeVisible();
		expect(top(await measure())).toEqual(rest);

		await row.getByRole('button', { name: 'Keep' }).click();
		await row.getByRole('button', { name: 'Done' }).click();
		await expect(row.getByRole('button', { name: 'Edit' })).toBeVisible();
		expect(top(await measure())).toEqual(rest);
	}
});

test('a Take out or a rename that finds the collection gone closes the sheet onto the list', async ({ page }) => {
	await unlock(page);
	const sheet = page.locator('dialog.detail');
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	// Another browser deleted the collection meanwhile: Canvas answers its change so, once.
	const gone = () =>
		page.route(/\/api\/collections\/h\d+$/, (route) => (route.request().method() === 'PATCH' ? route.fulfill(answer(404, 'no-collection')) : route.fallback()), {
			times: 1
		});

	const out = await make(page, 'Gone A', [{ game: '4117' }, { game: '4116' }]);
	await gone();
	await openSheet(page, out);
	await sheet.getByRole('button', { name: 'Edit' }).click();
	await sheet.locator('.coll-grid a[href="/game/4116"]').click();
	await sheet.locator('.take-bar').getByRole('button', { name: 'Take out' }).click();
	await expect(sheet).toBeHidden();
	await expect(page).toHaveURL(/\/\?view=collections$/);
	await expect(page.locator(`a[href="/collection/${out}"]`)).toHaveCount(0);

	const renamed = await make(page, 'Gone B', [{ game: '4117' }]);
	await gone();
	await openSheet(page, renamed);
	await sheet.getByRole('button', { name: 'Edit' }).click();
	await sheet.locator('.own-title-field').fill('Gone C');
	await sheet.locator('.own-title-field').press('Enter');
	await expect(sheet).toBeHidden();
	await expect(page).toHaveURL(/\/\?view=collections$/);
	expect(errors).toEqual([]);
});

test('a game from a series in a sheet opened by Add to closes onto the list, and Back steps back through the sheets', async ({ page }) => {
	await unlock(page);
	// Games enough that the sheet scrolls and its bar is held at the window's foot, where "Add to…" has its room above.
	const games = ['4106', '4107', '4108', '4109', '4110', '4111', '4112', '4113', '4114', '4115', '4116', '4117'];
	const a = await make(page, 'Deep A', [{ collection: 's500' }, ...games.map((game) => ({ game }))]);
	const b = await make(page, 'Deep B', []);
	await openSheet(page, a);
	const sheet = page.locator('dialog.detail');
	await sheet.getByRole('button', { name: 'Edit' }).click();
	await sheet.locator('.coll-grid a[href="/collection/s500"]').click();
	await sheet.locator('.take-bar').getByRole('button', { name: 'Add to…' }).click();
	await sheet.locator('.addto-pop .addto-row', { hasText: 'Deep B' }).click();
	await expect(sheet.locator('h1')).toHaveText('Deep B');
	await sheet.locator('.coll-grid a[href="/collection/s500"]').click();
	await expect(sheet.locator('h1')).toHaveText('Thornwick Mysteries');
	await sheet.locator('a[href="/game/4102"]').click();
	await expect(sheet.locator('h1')).toHaveText('Thornwick Mysteries 2');

	// Back: the series, then B, then A, each in its turn.
	await page.goBack();
	await expect(page).toHaveURL(/\/collection\/s500$/);
	await expect(sheet.locator('h1')).toHaveText('Thornwick Mysteries');
	await page.goBack();
	await expect(page).toHaveURL(new RegExp(`/collection/${b}$`));
	await expect(sheet.locator('h1')).toHaveText('Deep B');
	await page.goBack();
	await expect(page).toHaveURL(new RegExp(`/collection/${a}$`));
	await expect(sheet.locator('h1')).toHaveText('Deep A');

	// Forward to the game again: closing it shows the list.
	for (let i = 0; i < 3; i++) await page.goForward();
	await expect(page).toHaveURL(/\/game\/4102$/);
	await expect(sheet.locator('h1')).toHaveText('Thornwick Mysteries 2');
	await sheet.locator('.detail-close').click();
	await expect(sheet).toBeHidden();
	await expect(page).toHaveURL(/\/\?view=collections$/);
	await expect(page.locator(`main .grid > a[href="/collection/${a}"]`)).toHaveCount(1);

	// They go: the lists of the tests after this one hold their games as before.
	for (const id of [a, b]) expect((await page.request.delete(`/api/collections/${id}`)).status()).toBe(204);
});

test('Add to in a sheet that fits the window opens inside it, from its heading on', async ({ page }) => {
	await unlock(page);
	await page.setViewportSize({ width: 1440, height: 900 });
	// One card: the sheet does not scroll, and its bar stands under the card, high in the window.
	const id = await make(page, 'Short A', [{ game: '4117' }]);
	// More collections than the room above the bar holds. They come first, A to Z.
	const others: string[] = [];
	for (let i = 1; i <= 12; i++) others.push(await make(page, `Aisle ${i}`, []));
	await openSheet(page, id);
	const sheet = page.locator('dialog.detail');
	expect(await sheet.evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true);
	await sheet.getByRole('button', { name: 'Edit' }).click();
	await sheet.locator('.coll-grid a[href="/game/4117"]').click();
	await expect(sheet.locator('.take-n')).toHaveText('1 selected');
	await sheet.locator('.take-bar').getByRole('button', { name: 'Add to…' }).click();
	const list = sheet.locator('.addto-pop');
	await expect(list).toBeVisible();

	// The list starts inside the window and the sheet, and scrolls inside itself.
	const [, top] = await place(page, 'dialog.detail .addto-pop');
	const [, sheetTop] = await place(page, 'dialog.detail');
	expect(top).toBeGreaterThanOrEqual(Math.max(0, sheetTop));
	expect(await list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
	await expect(list.locator('.addto-head')).toHaveText('Add 1 to');
	await expect(list.locator('.addto-head')).toBeInViewport({ ratio: 1 });
	const first = list.locator('.addto-row').first();
	await expect(first.locator('.addto-name')).toHaveText('Aisle 1');
	await expect(first).toBeInViewport({ ratio: 1 });
	await first.click();

	await expect(page).toHaveURL(new RegExp(`/collection/${others[0]}$`));
	await expect(sheet.locator('h1')).toHaveText('Aisle 1');
	await expect(sheet.locator('.coll-grid a[href="/game/4117"]')).toHaveCount(1);

	// They go: the lists of the tests after this one hold their games as before.
	for (const one of [id, ...others]) expect((await page.request.delete(`/api/collections/${one}`)).status()).toBe(204);
});

// Nothing moves when picking or editing ends at the bottom: the room of their bars is there while this browser is
// unlocked (spec of own collections, section 14).

const LAST = 'main .grid > .card >> nth=-1';

test('picking that ends at the end of the list moves no card', async ({ page }) => {
	await unlock(page);
	await page.setViewportSize({ width: 1440, height: 600 });
	await page.goto('/');
	await expect(page.locator('main .grid > .card')).toHaveCount(17);
	/** The last card, with the list scrolled to its end. */
	const atEnd = async () => {
		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
		return place(page, LAST);
	};
	const before = await atEnd();

	await page.locator('.bar .select-toggle').click();
	expect(await atEnd()).toEqual(before);
	await page.locator(LAST).click();
	await expect(page.locator('.pickbar-count strong')).toHaveText('1 selected');
	expect(await place(page, LAST)).toEqual(before);
	await page.locator('.pickbar').getByRole('button', { name: 'Cancel' }).click();
	await expect(page.locator('.pickbar')).toHaveCount(0);
	expect(await place(page, LAST)).toEqual(before);
});

test('editing that ends at the end of a sheet moves no card', async ({ page }) => {
	await unlock(page);
	await page.setViewportSize({ width: 1440, height: 600 });
	const games = ['4101', '4102', '4103', '4104', '4105', '4106', '4107', '4108', '4109', '4110', '4115', '4116', '4117'];
	const id = await make(page, 'End A', games.map((game) => ({ game })));
	await openSheet(page, id);
	const sheet = page.locator('dialog.detail');
	const last = '.coll-grid > .card >> nth=-1';
	await expect(sheet.locator('.coll-grid > .card')).toHaveCount(games.length);
	/** How long the sheet is, and where its last card is with the sheet scrolled to its end. */
	const atEnd = async () => {
		const length = await sheet.evaluate((node) => {
			node.scrollTo(0, node.scrollHeight);
			return node.scrollHeight;
		});
		return [length, ...(await place(page, last))];
	};
	const before = await atEnd();
	expect(before[0]).toBeGreaterThan(600 + 200);

	await sheet.getByRole('button', { name: 'Edit' }).click();
	await expect(sheet.locator('.take-bar')).toBeVisible();
	expect(await atEnd()).toEqual(before);
	await sheet.locator(last).click();
	await expect(sheet.locator('.take-n')).toHaveText('1 selected');
	expect(await atEnd()).toEqual(before);
	// Done gives the focus to Edit, in the head, which scrolls the sheet there: it is measured at its end again.
	await sheet.getByRole('button', { name: 'Done' }).click();
	await expect(sheet.locator('.take-bar')).toBeHidden();
	expect(await atEnd()).toEqual(before);

	// It goes: the lists of the tests after this one hold its games as before.
	expect((await page.request.delete(`/api/collections/${id}`)).status()).toBe(204);
});

test('Forward onto the entry of a deleted collection shows the note, and the list responds', async ({ page }) => {
	await unlock(page);
	const id = await make(page, 'Gone D', [{ game: '4117' }]);
	await openSheet(page, id);
	const sheet = page.locator('dialog.detail');
	const row = sheet.locator('.own-edit-row');
	await row.getByRole('button', { name: 'Edit' }).click();
	await row.getByRole('button', { name: 'Delete collection' }).click();
	await row.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(sheet).toBeHidden();
	await expect(page).toHaveURL(/\/\?view=collections$/);
	await expect(page.locator('.toast')).toHaveCount(0);

	await page.goForward();
	await expect(page).toHaveURL(new RegExp(`/collection/${id}$`));
	await expect(page.locator('.toast')).toHaveText('This collection is not in the library.');
	await expect(sheet).toBeHidden();
	// A card opens its sheet.
	await page.locator('main .grid > a[href="/collection/p4803"]').click();
	await expect(sheet.locator('h1')).toHaveText('Lantern Coast Saga');
	await expect(page).toHaveURL(/\/collection\/p4803$/);
});

test('a visitor sees no Edit', async ({ page }) => {
	await page.goto(`${process.env.CANVAS_OWN_URL}/collection/h1`);
	const sheet = page.locator('dialog.detail');
	await expect(sheet.locator('h1')).toHaveText('Rainy Sundays');
	await expect(sheet.locator('.own-edit-row button')).toHaveCount(0);
});

// The panel "Your collections" in the settings' Library tab (spec of own collections, section 10). The last test deletes
// every collection of this Canvas: nothing after it needs one.

const MAKE_HINT = 'To make one, close the settings and press Select in the library. To take games out of one, open it and press Edit.';

/** Opens the settings sheet at its address, with this browser unlocked, and waits for it to arrive. */
async function openSettings(page: Page): Promise<void> {
	await page.goto('/settings');
	await expect(page.locator('dialog.detail h1')).toHaveText('Settings');
	await arrived(page);
}

/** The panel "Your collections". */
const ownPanel = (page: Page) => page.locator('dialog.detail #settings-section-library .settings-panel').nth(1);

/** The row of the own collection `id` in the panel. */
const rowOf = (id: string) => `dialog.detail .own-row[data-id="${id}"]`;

test('the Library tab holds the panel under the defaults, and the tabs are as before', async ({ page }) => {
	await unlock(page);
	const id = await make(page, 'Panel A', [{ game: '4115' }, { game: '4116' }]);
	await openSettings(page);
	const sheet = page.locator('dialog.detail');
	await expect(sheet.getByRole('tab')).toHaveText(['Library', 'Downloads', 'Batocera', 'Server']);
	await expect(sheet.getByRole('tab', { selected: true })).toHaveText('Library');
	const panels = sheet.getByRole('tabpanel').locator('.settings-panel');
	const panel = ownPanel(page);
	const n = await panel.locator('.own-row').count();
	expect(n).toBeGreaterThan(1);
	await expect(panels.locator('h2')).toHaveText(['How the library opens in a browser that has not chosen its own view', `Your collections ${n}, A to Z`]);
	// A to Z.
	const names = await panel.locator('.own-row-state.on .own-row-name').allTextContents();
	expect(names).toHaveLength(n);
	expect(names).toEqual([...names].sort(byTitle));

	const row = page.locator(rowOf(id));
	await expect(row.locator('.on .own-row-name')).toHaveText('Panel A');
	await expect(row.locator('.on .own-row-n')).toHaveText('2 games');
	await expect(row.locator('.on button')).toHaveText(['Rename', 'Delete']);
	await expect(row.locator('.addto-thumb .own-strip')).toHaveCount(2);
	const [, , thumb] = await place(page, `${rowOf(id)} .addto-thumb`);
	expect(thumb).toBe(38);
	const [, , , height] = await place(page, rowOf(id));
	expect(height).toBeGreaterThanOrEqual(66);
	await expect(panel.locator('.set-note')).toHaveText(MAKE_HINT);
});

test('Rename with Save and with Enter, Cancel with Esc', async ({ page }) => {
	await unlock(page);
	const id = await make(page, 'Ren A', [{ game: '4117' }]);
	await openSettings(page);
	const sheet = page.locator('dialog.detail');
	const saved = sheet.locator('.settings-foot .saved');
	const row = page.locator(rowOf(id));
	const name = row.locator('.on .own-row-name');
	const rename = row.getByRole('button', { name: 'Rename' });
	const field = row.locator('.own-row-field');

	await rename.click();
	await expect(field).toBeFocused();
	await expect(field).toHaveValue('Ren A');
	await expect(field).toHaveAttribute('aria-label', 'Name');
	await expect(row.locator('.on button')).toHaveText(['Save', 'Cancel']);
	await field.fill('Ren B');
	await row.getByRole('button', { name: 'Save' }).click();
	await expect(name).toHaveText('Ren B');
	await expect(rename).toBeFocused();
	await expect(saved).toBeVisible();
	await expect(saved).toBeHidden();

	await rename.click();
	await field.fill('Ren C');
	await field.press('Enter');
	await expect(name).toHaveText('Ren C');
	await expect(rename).toBeFocused();
	await expect(saved).toBeVisible();

	// Esc gives the name back and leaves the sheet open.
	await rename.click();
	await field.fill('Ren D');
	await field.press('Escape');
	await expect(name).toHaveText('Ren C');
	await expect(rename).toBeFocused();
	await expect(sheet).toBeVisible();
	await expect(sheet.locator('.notice')).toHaveCount(0);

	await sheet.locator('.detail-close').click();
	await expect(sheet).toBeHidden();
	await page.locator('.bar .view-toggle:not(.select-toggle)').click();
	await expect(page.locator(`a[href="/collection/${id}"] .card-title`)).toHaveText('Ren C');
});

test('a taken name keeps Save off and the row its height', async ({ page }) => {
	await unlock(page);
	await make(page, 'Row Taken', []);
	const id = await make(page, 'Row Mine', [{ game: '4115' }]);
	const sent: string[] = [];
	page.on('request', (request) => {
		if (new URL(request.url()).pathname === `/api/collections/${id}`) sent.push(request.method());
	});
	for (const width of [1440, 390]) {
		await page.setViewportSize({ width, height: 844 });
		await openSettings(page);
		const row = page.locator(rowOf(id));
		const field = row.locator('.own-row-field');
		const save = row.getByRole('button', { name: 'Save' });
		await row.scrollIntoViewIfNeeded();
		const before = await place(page, rowOf(id));

		await row.getByRole('button', { name: 'Rename' }).click();
		expect(await place(page, rowOf(id))).toEqual(before);
		// The line under the field that says why a name is refused: the field's description, empty while the name is fine.
		const why = page.locator(`#${await field.getAttribute('aria-describedby')}`);
		await expect(why).toHaveText('');
		const [, fieldTop, , fieldHeight] = await place(page, `${rowOf(id)} .own-row-field`);
		// Another collection's name in another letter case: Save stays off, and the line says why.
		await field.fill('row taken');
		await expect(save).toBeDisabled();
		await expect(field).toHaveAttribute('aria-invalid', 'true');
		await expect(why).toBeVisible();
		await expect(why).toHaveText('There is already a collection of that name.');
		await expect(why).toHaveAttribute('aria-live', 'polite');
		await expect(field).toHaveAccessibleDescription('There is already a collection of that name.');
		const [, whyTop] = await place(page, `#${await field.getAttribute('aria-describedby')}`);
		expect(whyTop).toBeGreaterThanOrEqual(fieldTop + fieldHeight);
		expect(await place(page, rowOf(id))).toEqual(before);
		await field.press('Enter');
		await expect(field).toBeFocused();
		// A name of spaces.
		await field.fill('   ');
		await expect(save).toBeDisabled();
		await expect(field).toHaveAttribute('aria-invalid', 'true');
		await expect(why).toHaveText('The name is empty.');
		await expect(field).toHaveAccessibleDescription('The name is empty.');
		expect(await place(page, rowOf(id))).toEqual(before);
		// Its own name in another letter case is free.
		await field.fill('ROW MINE');
		await expect(save).toBeEnabled();
		await expect(field).toHaveAttribute('aria-invalid', 'false');
		await expect(why).toHaveText('');

		await row.getByRole('button', { name: 'Cancel' }).click();
		await expect(row.locator('.on .own-row-name')).toHaveText('Row Mine');
		expect(await place(page, rowOf(id))).toEqual(before);
		// Asking keeps the height too.
		await row.getByRole('button', { name: 'Delete', exact: true }).click();
		await expect(row.locator('.on button')).toHaveText(['Delete', 'Keep']);
		expect(await place(page, rowOf(id))).toEqual(before);
		await row.getByRole('button', { name: 'Keep' }).click();
	}
	expect(sent).toEqual([]);
});

test('Delete asks in the row, Keep keeps, Delete deletes', async ({ page }) => {
	await unlock(page);
	const id = await make(page, 'Del Row', [{ game: '4117' }]);
	await openSettings(page);
	const sheet = page.locator('dialog.detail');
	const row = page.locator(rowOf(id));
	const panel = ownPanel(page);
	const n = await panel.locator('.own-row').count();
	await row.scrollIntoViewIfNeeded();
	const before = await place(page, rowOf(id));

	await row.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(row.locator('.on .own-row-name')).toHaveText('Delete “Del Row”? Its games stay in the library.');
	await expect(row.locator('.on button')).toHaveText(['Delete', 'Keep']);
	await expect(row.getByRole('button', { name: 'Keep' })).toBeFocused();
	expect(await place(page, rowOf(id))).toEqual(before);

	await row.getByRole('button', { name: 'Keep' }).click();
	await expect(row.locator('.on button')).toHaveText(['Rename', 'Delete']);
	await expect(row.getByRole('button', { name: 'Delete', exact: true })).toBeFocused();
	expect(await place(page, rowOf(id))).toEqual(before);

	await row.getByRole('button', { name: 'Delete', exact: true }).click();
	await row.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(row).toHaveCount(0);
	await expect(sheet.locator('.settings-foot .saved')).toBeVisible();
	await expect(panel.locator('h2')).toHaveText(`Your collections ${n - 1}, A to Z`);
	// The focus stays in the list, on the row now in its place.
	await expect(panel.locator('.own-row-state.on button:focus')).toHaveText('Delete');
	expect((await page.request.delete(`/api/collections/${id}`)).status()).toBe(404);
});

test('says No collections yet. when there are none', async ({ page }) => {
	await unlock(page);
	// Every collection of this Canvas goes: the number of the newest says how many ids were given out.
	const last = Number((await make(page, 'Last one', [])).slice(1));
	for (let n = 1; n <= last; n++) expect([204, 404]).toContain((await page.request.delete(`/api/collections/h${n}`)).status());
	await openSettings(page);
	const panel = ownPanel(page);
	await expect(panel.locator('h2')).toHaveText('Your collections 0, A to Z');
	await expect(panel.locator('.own-row')).toHaveCount(0);
	await expect(panel.locator('.own-empty')).toHaveText('No collections yet.');
	await expect(panel.locator('.set-note')).toHaveText(MAKE_HINT);
});
