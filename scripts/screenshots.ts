// Takes the README's pictures from a running Canvas. Run with:
//   npm run screenshots -- library='https://canvas.example/?sort=recent&view=collections' game='https://canvas.example/game/<id>'
// Each argument is name=address, quoted so that the shell keeps an address whole, and gives
// screenshots/<name>.jpg. The addresses come at run time, so this file names no Canvas and no game.
// It stops, and writes nothing, when that Canvas does not run the version of package.json.
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, type Page } from '@playwright/test';
import { listCookie, opensSheet, parsePictures, healthProblem, type Picture } from './screenshots-plan.ts';

// Playwright hides the scrollbars by default (--hide-scrollbars), as a Mac does, so the page is 1658 wide and the picture is the whole window; the framing depends on it.
const WIDTH = 1658;
const HEIGHT = 1050;
const QUALITY = 85;
/** How long a page may take to load and settle. */
const LIMIT = 30_000;
/** Chrome on a Mac, so that the download button says what a Mac visitor sees, wherever this runs. */
const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const OUT = new URL('../screenshots/', import.meta.url);

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

function withLimit<T>(work: Promise<T>, what: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const limit = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(what)), LIMIT);
	});
	return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

async function checkVersion(origin: string): Promise<void> {
	const address = new URL('/healthz', origin).href;
	let health: unknown;
	try {
		const response = await fetch(address, { signal: AbortSignal.timeout(10_000) });
		health = await response.json();
	} catch (error) {
		fail(`Could not read ${address}: ${(error as Error).message}`);
	}
	const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
	const problem = healthProblem(health, pkg.version);
	if (problem) fail(problem);
}

/**
 * Waits until the frame shows what stays: the fonts ready, every image in the frame decoded,
 * and no animation running but those that repeat forever (a long title that runs). Images
 * below the frame load lazily and are not waited for. Playwright never moves the mouse, so
 * nothing looks pointed at.
 */
async function settle(page: Page): Promise<void> {
	await page.evaluate(
		async ({ width, height }) => {
			await document.fonts.ready;
			const inFrame = (img: HTMLImageElement) => {
				const box = img.getBoundingClientRect();
				return box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 && box.top < height && box.left < width;
			};
			await Promise.all([...document.images].filter(inFrame).map((img) => img.decode().catch(() => undefined)));
			for (;;) {
				const running = document
					.getAnimations()
					.filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity);
				if (running.length === 0) break;
				await Promise.all(running.map((a) => a.finished.catch(() => undefined)));
			}
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		},
		{ width: WIDTH, height: HEIGHT }
	);
}

async function shoot(page: Page, picture: Picture): Promise<Buffer> {
	const response = await page.goto(picture.url.href, { waitUntil: 'networkidle', timeout: LIMIT });
	if (!response || !response.ok()) throw new Error(`answered ${response ? response.status() : 'nothing'}.`);
	if (opensSheet(picture.url)) {
		// Canvas answers 200 for a game or collection that is not in the library, and shows a note instead.
		const sheet = await page
			.locator('dialog[open]')
			.first()
			.waitFor({ timeout: 5_000 })
			.then(() => true)
			.catch(() => false);
		if (!sheet) throw new Error('opened no sheet. Is it still in the library?');
	}
	await withLimit(settle(page), `did not settle within ${LIMIT / 1000} seconds.`);
	return page.screenshot({ type: 'jpeg', quality: QUALITY });
}

let pictures: Picture[];
try {
	pictures = parsePictures(process.argv.slice(2));
} catch (error) {
	fail((error as Error).message);
}
const origin = pictures[0].url.origin;
await checkVersion(origin);

const shots = new Map<string, Buffer>();
let failure: string | null = null;
const browser = await chromium.launch();
try {
	const context = await browser.newContext({
		viewport: { width: WIDTH, height: HEIGHT },
		deviceScaleFactor: 1,
		userAgent: USER_AGENT
	});
	const cookie = listCookie(pictures);
	if (cookie) await context.addCookies([{ ...cookie, url: origin }]);
	for (const picture of pictures) {
		const page = await context.newPage();
		try {
			shots.set(picture.name, await shoot(page, picture));
		} catch (error) {
			failure = `${picture.name}: ${picture.url.href} ${(error as Error).message}`;
			break;
		} finally {
			await page.close();
		}
	}
} finally {
	await browser.close();
}
if (failure) fail(`${failure} Nothing was written.`);

for (const [name, shot] of shots) {
	await writeFile(new URL(`${name}.jpg`, OUT), shot);
	console.log(`screenshots/${name}.jpg`);
}
