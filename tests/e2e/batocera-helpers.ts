import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { arrived, expect } from './helpers';

/** Unlocks the settings for the browser of `api`: a page's own `page.request` unlocks that page. */
export async function unlock(api: APIRequestContext): Promise<void> {
	expect((await api.post('/api/settings/unlock', { data: { pin: '2468' } })).status()).toBe(204);
}

/** Opens a game's detail, and waits until the sheet has arrived and the server has told the game's state on the box. */
export async function open(page: Page, id: string): Promise<void> {
	const told = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/batocera/games/${id}`);
	await page.goto(`/game/${id}`);
	await told;
	await arrived(page);
}

/** Turns the main button to Batocera with the switch. */
export async function pickBatocera(page: Page): Promise<void> {
	const block = page.locator('.dl');
	await block.getByRole('button', { name: 'Other systems and Batocera' }).click();
	await block.getByRole('menuitemradio', { name: 'Batocera' }).click();
	await expect(block.getByRole('menu')).toHaveCount(0);
}

export const mainButton = (page: Page) => page.locator('.dl .split > .btn').first();
/** The room of the line beside the main button, or under it on a phone. */
export const room = (page: Page) => page.locator('.dl .bato-line');
/** The line's bold first line, and its plain second one. */
export const bold = (page: Page) => room(page).locator('.bato-bold');
export const plain = (page: Page) => room(page).locator('.bato-plain');
/** The TV at the line's left, the "i" and the flag at its end. */
export const tvButton = (page: Page) => room(page).getByRole('button', { name: "Batocera's state" });
export const infoButton = (page: Page) => room(page).getByRole('button', { name: 'More about this' });
export const flagButton = (page: Page) => room(page).getByRole('button', { name: /^(Doesn't run\? Mark it|Take the mark back)$/ });
export const note = (page: Page) => page.locator('.dl .bato-note');
/** The tooltip of an icon button: the words beside it. */
export const tipOf = (button: Locator) => button.locator('xpath=..').locator('.tip-text');
