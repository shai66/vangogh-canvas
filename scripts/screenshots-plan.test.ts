import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseState } from '$lib/search/state';
import { REMEMBER_COOKIE, rememberedCookie } from '$lib/remember';
import {
	listCookie,
	opensSheet,
	parsePictures,
	healthProblem,
	isSettings,
	settingsTab,
	pinProblem,
	withStandIn,
	VANGOGH_STAND_IN
} from './screenshots-plan.ts';

const CANVAS = 'http://canvas.test';

describe('reading the pictures to take', () => {
	it('reads each name=address pair, in order', () => {
		const pictures = parsePictures([`library=${CANVAS}/?sort=recent`, `game=${CANVAS}/game/42`]);
		expect(pictures.map((p) => [p.name, p.url.href])).toEqual([
			['library', `${CANVAS}/?sort=recent`],
			['game', `${CANVAS}/game/42`]
		]);
	});

	it('keeps an address whole when it holds = and &', () => {
		const [picture] = parsePictures([`library=${CANVAS}/?sort=recent&view=collections&os=linux`]);
		expect(picture.url.search).toBe('?sort=recent&view=collections&os=linux');
	});

	it('takes digits and hyphens in a name', () => {
		expect(parsePictures([`game-2=${CANVAS}/`])[0].name).toBe('game-2');
	});

	it('refuses an empty list', () => {
		expect(() => parsePictures([])).toThrow('Give at least one picture as name=address');
	});

	it.each(['library', `=${CANVAS}/`, 'library:http//canvas.test/'])('refuses "%s", which is not name=address', (arg) => {
		expect(() => parsePictures([arg])).toThrow(`"${arg}" is not name=address.`);
	});

	it.each(['Library', '../readme', 'my picture', 'game.jpg'])('refuses the name "%s"', (name) => {
		expect(() => parsePictures([`${name}=${CANVAS}/`])).toThrow(
			`The name "${name}" may hold only lower case letters, digits and hyphens.`
		);
	});

	it('refuses a name given twice', () => {
		expect(() => parsePictures([`game=${CANVAS}/game/1`, `game=${CANVAS}/game/2`])).toThrow(
			'The name "game" is given twice.'
		);
	});

	it.each(['', 'canvas.test/game/1', '/game/1', 'ftp://canvas.test/', 'file:///etc/hosts'])(
		'refuses the address "%s"',
		(address) => {
			expect(() => parsePictures([`game=${address}`])).toThrow(
				`The address of "game" is not a full http or https address: ${address}`
			);
		}
	);

	it('refuses a tab of the settings that the sheet does not have', () => {
		expect(() => parsePictures([`settings=${CANVAS}/settings#network`])).toThrow(
			'The tab "network" of "settings" is not one of library, downloads, batocera, server.'
		);
	});

	it("refuses the Batocera tab, which shows the box's address", () => {
		expect(() => parsePictures([`settings=${CANVAS}/settings#batocera`])).toThrow(
			'The tab "batocera" of "settings" shows the address of a Batocera box, so it is not pictured.'
		);
	});

	it('refuses a tab whose name cannot be read', () => {
		expect(() => parsePictures([`settings=${CANVAS}/settings#%`])).toThrow(
			'The tab "%" of "settings" is not one of library, downloads, batocera, server.'
		);
	});

	it('refuses addresses on two origins', () => {
		expect(() => parsePictures([`library=${CANVAS}/`, 'game=http://other.test/game/1'])).toThrow(
			`All addresses must be on one Canvas: ${CANVAS} and http://other.test.`
		);
	});
});

describe('the health check', () => {
	it('passes when /healthz says the version of package.json', () => {
		expect(healthProblem({ status: 'ok', version: '0.9.1' }, '0.9.1')).toBeNull();
	});

	it('names both versions when they differ', () => {
		expect(healthProblem({ status: 'ok', version: '0.9.0' }, '0.9.1')).toBe(
			'The Canvas there runs 0.9.0, and package.json says 0.9.1. Redeploy it first.'
		);
	});

	it.each([null, 'ok', 42, {}, { version: 9 }])('says so when /healthz gives no version: %j', (health) => {
		expect(healthProblem(health, '0.9.1')).toBe('/healthz did not say which version runs.');
	});

	it('refuses a Canvas that has no index yet', () => {
		expect(healthProblem({ status: 'no-index', version: '0.9.1' }, '0.9.1')).toBe(
			'The Canvas there has no index yet (/healthz says no-index). Wait until it has built one.'
		);
	});

	it('names an undefined status when /healthz gives none', () => {
		expect(healthProblem({ version: '0.9.1' }, '0.9.1')).toBe(
			'The Canvas there has no index yet (/healthz says undefined). Wait until it has built one.'
		);
	});

	it('reports a wrong version before the status', () => {
		expect(healthProblem({ status: 'no-index', version: '0.9.0' }, '0.9.1')).toBe(
			'The Canvas there runs 0.9.0, and package.json says 0.9.1. Redeploy it first.'
		);
	});
});

describe('the list under the sheets', () => {
	const canvasCookie = (path: string) =>
		rememberedCookie(parseState(new URL(path, CANVAS).searchParams)).split(';')[0];
	const scriptCookie = (path: string) => {
		const cookie = listCookie(parsePictures([`library=${CANVAS}${path}`]));
		return cookie && `${cookie.name}=${cookie.value}`;
	};

	it.each([
		'/?sort=recent&view=collections',
		'/',
		'/?os=linux,windows&sort=year',
		'/?os=macos&os=macos,linux',
		'/?os=amiga,%20linux%20',
		'/?sort=newest&view=list',
		'/?q=puzzle&genre=strategy&play=coop'
	])('builds the cookie Canvas builds for %s', (path) => {
		expect(scriptCookie(path)).toBe(canvasCookie(path));
	});

	it('names the cookie as Canvas does', () => {
		expect(listCookie(parsePictures([`library=${CANVAS}/`]))?.name).toBe(REMEMBER_COOKIE);
	});

	it('takes the first address whose path is /, wherever it stands', () => {
		const cookie = listCookie(
			parsePictures([`game=${CANVAS}/game/1`, `library=${CANVAS}/?sort=year`, `other=${CANVAS}/?sort=recent`])
		);
		expect(cookie?.value).toBe('|year');
	});

	it('sets no cookie without a list address', () => {
		expect(listCookie(parsePictures([`game=${CANVAS}/game/1`, `glance=${CANVAS}/glance`]))).toBeNull();
	});
});

describe('which addresses open a sheet', () => {
	it.each([
		['/game/1', true],
		['/collection/p1', true],
		['/glance', true],
		['/settings', true],
		['/', false],
		['/?sort=recent', false]
	])('%s: %s', (path, sheet) => {
		expect(opensSheet(new URL(path, CANVAS))).toBe(sheet);
	});
});

describe('the settings sheet', () => {
	it.each([
		['/settings', true],
		['/settings#server', true],
		['/', false],
		['/game/1#server', false]
	])('%s is the settings: %s', (path, settings) => {
		expect(isSettings(new URL(path, CANVAS))).toBe(settings);
	});

	it.each([
		['/settings#server', 'server'],
		['/settings#Server', 'server'],
		['/settings', null],
		['/game/1#server', null]
	])('%s asks for the tab %s', (path, tab) => {
		expect(settingsTab(new URL(path, CANVAS))).toBe(tab);
	});

	it.each(['2468', '12345678'])('takes the PIN %s', (pin) => {
		expect(pinProblem(pin)).toBeNull();
	});

	it.each(['', '123', '123456789', '12a4', ' 2468'])('refuses the PIN "%s"', (pin) => {
		expect(pinProblem(pin)).toBe("SETTINGS_PIN must be the settings' PIN: 4 to 8 digits.");
	});

	it("puts the stand-in in place of vangogh's address and keeps the rest", () => {
		const status = { version: '0.12.0', vangogh: { url: 'http://10.0.0.5:1853', login: 'ok' }, jobs: 0 };
		expect(withStandIn(status)).toEqual({
			version: '0.12.0',
			vangogh: { url: VANGOGH_STAND_IN, login: 'ok' },
			jobs: 0
		});
	});

	it.each([null, 'text', {}, { vangogh: null }, { vangogh: { login: 'ok' } }])('leaves %j as it is', (status) => {
		expect(withStandIn(status)).toEqual(status);
	});

	it("is the address of vangogh in the example stack", () => {
		const stack = readFileSync(new URL('../examples/compose.vangogh-stack.yml', import.meta.url), 'utf8');
		expect(stack).toContain(`VANGOGH_URL: ${VANGOGH_STAND_IN}`);
	});
});
