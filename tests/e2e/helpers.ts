import { expect, test as base, type Page } from '@playwright/test';

export const UA = {
	windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
	macos: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
	phone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
};

/**
 * Every test runs against the Canvas that setup.ts started, as a visitor on
 * Windows, and fails when the page reports an error of its own.
 */
export const test = base.extend<{ problems: string[] }>({
	baseURL: async ({}, use) => use(process.env.CANVAS_URL),
	userAgent: UA.windows,
	problems: [
		async ({ page }, use) => {
			const problems: string[] = [];
			page.on('pageerror', (error) => problems.push(`error: ${error.message}`));
			page.on('console', (message) => {
				if (message.type() === 'error') problems.push(`console: ${message.text()}`);
			});
			await use(problems);
			// A picture or a file that a test made fail on purpose is reported by the browser too.
			expect(problems.filter((p) => !p.includes('Failed to load resource'))).toEqual([]);
		},
		{ auto: true }
	]
});

export { expect };

/** Where an element is and how large, to the tenth of a pixel: left, top, width, height. */
export async function place(page: Page, selector: string): Promise<[number, number, number, number]> {
	return page.locator(selector).first().evaluate((node) => {
		const box = node.getBoundingClientRect();
		const tenth = (n: number) => Math.round(n * 10) / 10;
		return [tenth(box.left), tenth(box.top), tenth(box.width), tenth(box.height)] as [number, number, number, number];
	});
}

/** The titles of the cards, in the order shown. */
export function titles(page: Page): Promise<string[]> {
	return page.locator('.card .card-title').allTextContents();
}
