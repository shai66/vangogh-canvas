import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BACKDROP, BANNER, POSTER, SHOT, apiProduct, records } from '../testing/fixtures';
import { macNoticeOf, mapApiProduct, requirementsOf, storeUrlOf } from './product';

describe('mapApiProduct', () => {
	const game = mapApiProduct(records.apiProducts['1001']);

	it('reads the plain fields', () => {
		expect(game).toMatchObject({
			title: 'The Long Dark Road',
			productType: 'GAME',
			os: ['windows', 'macos', 'linux'],
			genres: ['Role-playing', 'Adventure'],
			tags: ['Atmospheric', 'Story Rich', 'Turn-Based'],
			developers: ['Šťastný Studio'],
			publisher: 'Road Works',
			languages: ['en', 'sk']
		});
	});

	it('reads the images as ids', () => {
		expect(game.poster).toBe(POSTER['1001']);
		expect(game.screenshots).toEqual([SHOT.one, SHOT.two]);
	});

	it('reads the two wide images as ids', () => {
		expect(game.banner).toBe(BANNER['1001']);
		expect(game.backdrop).toBe(BACKDROP['1001']);
	});

	it('gives null for a wide image the record does not have or that is not an image id', () => {
		const bare = mapApiProduct(apiProduct({ title: 'Bare' }));
		expect(bare).toMatchObject({ poster: null, banner: null, backdrop: null });
		const odd = mapApiProduct({
			_embedded: { product: { _links: { image: { href: 'https://images.gog-statics.com/../x.jpg' } } } },
			_links: { galaxyBackgroundImage: 'text' }
		});
		expect(odd).toMatchObject({ banner: null, backdrop: null });
	});

	it('reads the year of the original release, as the date says it', () => {
		expect(game.releaseYear).toBe(2002);
		// The first moment of a year, in a time zone ahead of UTC: still that year.
		const newYear = mapApiProduct(apiProduct({ title: 'New Year', released: '2003-01-01T00:00:00+02:00' }));
		expect(newYear.releaseYear).toBe(2003);
	});

	it.each([['soon'], ['02-2002'], ['0000-01-01T00:00:00+00:00'], ['20020-01-01'], [2002], [null], [{ year: 2002 }]])(
		'gives null for a release date that is not a date: %j',
		(odd) => {
			expect(mapApiProduct({ _embedded: { product: { globalReleaseDate: odd } } }).releaseYear).toBeNull();
		}
	);

	it('gives null when the record has no original release date, and does not take the date on GOG for it', () => {
		expect(mapApiProduct(apiProduct({ title: 'Bare' })).releaseYear).toBeNull();
		const onGogOnly = mapApiProduct({ _embedded: { product: { gogReleaseDate: '2019-01-23T14:45:00+01:00' } } });
		expect(onGogOnly.releaseYear).toBeNull();
	});

	it('sanitises the description', () => {
		expect(game.description).toBe('<p>A <b>long</b> road.</p>');
	});

	it('derives the multiplayer and co-op flags from the features', () => {
		expect(game).toMatchObject({ multiplayer: true, coop: true });
		const solo = mapApiProduct(apiProduct({ title: 'Solo', features: ['Single-player'] }));
		expect(solo).toMatchObject({ multiplayer: false, coop: false });
	});

	it('reads relations as ids', () => {
		expect(game.includedIn).toEqual([{ id: '3001', title: null }]);
		expect(mapApiProduct(records.apiProducts['2002']).requires).toEqual([
			{ id: '9999', title: null }
		]);
		expect(mapApiProduct(records.apiProducts['3001']).includes).toEqual([
			{ id: '1001', title: null }
		]);
	});

	it('accepts a single link, a link with a title, and ignores links without an id', () => {
		const raw = {
			_links: {
				requiresGames: { href: 'https://api.gog.com/v2/games/42/', title: 'Base Game' },
				includesGames: [{ href: 'https://api.gog.com/v2/games/' }, { href: 'x/abc' }, {}, 'text']
			}
		};
		const mapped = mapApiProduct(raw);
		expect(mapped.requires).toEqual([{ id: '42', title: 'Base Game' }]);
		expect(mapped.includes).toEqual([]);
	});

	it('ignores systems named like the properties of an object', () => {
		const raw = apiProduct({ title: 'x', os: ['constructor', 'toString', '__proto__', 'linux'] });
		expect(mapApiProduct(raw).os).toEqual(['linux']);
	});

	it('reads the product type in any case and marks others as unknown', () => {
		expect(mapApiProduct(apiProduct({ title: 'x', type: 'dlc' })).productType).toBe('DLC');
		expect(mapApiProduct(apiProduct({ title: 'x', type: 'MOVIE' })).productType).toBe('UNKNOWN');
	});

	it('falls back to overview and features when there is no description', () => {
		const raw = { description: '', overview: '<p>Over</p>', featuresDescription: '<p>Feat</p>' };
		expect(mapApiProduct(raw).description).toBe('<p>Over</p>\n<p>Feat</p>');
	});

	it.each([[null], [undefined], ['text'], [42], [[]], [{}], [{ _embedded: 'x', _links: [] }]])(
		'survives %j',
		(raw) => {
			expect(mapApiProduct(raw)).toEqual({
				title: null,
				productType: 'UNKNOWN',
				os: [],
				genres: [],
				tags: [],
				developers: [],
				publisher: '',
				features: [],
				multiplayer: false,
				coop: false,
				languages: [],
				description: '',
				screenshots: [],
				poster: null,
				banner: null,
				backdrop: null,
				releaseYear: null,
				macNotice: null,
				requirements: {},
				storeUrl: null,
				requires: [],
				includes: [],
				includedIn: []
			});
		}
	);
});

const sampleDir = 'samples/metadata/gog-api-products';

describe.skipIf(!existsSync(sampleDir))('mapApiProduct on the real samples', () => {
	const files = existsSync(sampleDir) ? readdirSync(sampleDir).filter((name) => name.endsWith('.json')) : [];

	it('gives every record a title and a known type', () => {
		const odd = files
			.map((name) => ({
				name,
				mapped: mapApiProduct(JSON.parse(readFileSync(`${sampleDir}/${name}`, 'utf8')))
			}))
			.filter(({ mapped }) => mapped.title === null || mapped.productType === 'UNKNOWN')
			.map(({ name }) => name);
		expect(odd).toEqual([]);
	});

	it('finds a poster and a system for most records', () => {
		const mapped = files.map((name) =>
			mapApiProduct(JSON.parse(readFileSync(`${sampleDir}/${name}`, 'utf8')))
		);
		const withPoster = mapped.filter((m) => m.poster !== null).length;
		const withOs = mapped.filter((m) => m.os.length > 0).length;
		// Packs and some DLC have no poster of their own.
		expect(withPoster).toBeGreaterThan(files.length * 0.8);
		expect(withOs).toBeGreaterThan(files.length * 0.8);
	});

	it('finds the year of the original release for most records, and no year that cannot be', () => {
		const years = files.map(
			(name) => mapApiProduct(JSON.parse(readFileSync(`${sampleDir}/${name}`, 'utf8'))).releaseYear
		);
		const known = years.filter((year): year is number => year !== null);
		expect(known.length).toBeGreaterThan(files.length * 0.8);
		expect(Math.min(...known)).toBeGreaterThan(1970);
		expect(Math.max(...known)).toBeLessThanOrEqual(new Date().getFullYear() + 1);
	});

	it('leaves nothing that could run in a description', () => {
		for (const name of files) {
			const { description } = mapApiProduct(
				JSON.parse(readFileSync(`${sampleDir}/${name}`, 'utf8'))
			);
			expect(description).not.toMatch(/<script|<img|<iframe|\son\w+=|javascript:/i);
		}
	});
});

describe('macNoticeOf', () => {
	const NOTICE = 'The game is 32-bit only and will not work on macOS 10.15 and up.';

	it('reads the notice as GOG writes it, without the two words in front', () => {
		expect(macNoticeOf(`Mac notice: ${NOTICE}`)).toBe(NOTICE);
		expect(macNoticeOf(`<p>\r\nMac notice: ${NOTICE}\r\n</p>`)).toBe(NOTICE);
	});

	it('takes only the line of the notice out of a field with other notes', () => {
		const field =
			'<p>ACCEPTANCE OF END USER LICENSE AGREEMENT REQUIRED TO PLAY</p>' +
			'<p>Mac notice: Needs macOS 10.14 or older.<br>Notice: Multiplayer mode is not supported.</p>';
		expect(macNoticeOf(field)).toBe('Needs macOS 10.14 or older.');
	});

	it('gives plain text: tags go, entities become their characters, spaces are single', () => {
		expect(macNoticeOf('MAC NOTICE:   <b>Needs</b>  Rosetta &amp; macOS&nbsp;10.14,\tnot &lt;newer&gt;.  ')).toBe(
			'Needs Rosetta & macOS 10.14, not <newer>.'
		);
	});

	it.each([
		[''],
		['ACCEPTANCE OF END USER LICENSE AGREEMENT REQUIRED TO PLAY'],
		['Mac notice:'],
		['<p>Mac notice:   </p>'],
		['See the Mac notice: it is below.'],
		[undefined],
		[null],
		[42],
		[{ text: 'Mac notice: x' }],
		[['Mac notice: x']]
	])('gives null where there is no notice: %j', (field) => {
		expect(macNoticeOf(field)).toBeNull();
	});

	it('keeps a notice of 300 characters and gives null for a longer one', () => {
		expect(macNoticeOf(`Mac notice: ${'x'.repeat(300)}`)).toBe('x'.repeat(300));
		expect(macNoticeOf(`Mac notice: ${'x'.repeat(301)}`)).toBeNull();
	});

	it('decodes numeric entities and the two single quotes', () => {
		expect(macNoticeOf('Mac notice: It won&#039;t, won&#39;t, won&#x27;t, won&#X27;t, won&rsquo;t and &lsquo;won&rsquo;t&rsquo; work.')).toBe(
			"It won't, won't, won't, won't, won’t and ‘won’t’ work."
		);
		expect(macNoticeOf('Mac notice: &#60;b&#62; is text, and &amp;lt; stays &lt;.')).toBe('<b> is text, and &lt; stays <.');
	});

	it('leaves a numeric entity that is no character as it was written, and does not throw', () => {
		expect(macNoticeOf('Mac notice: a&#0;b &#9; &#xD800; &#1114112; &#99999999999999999999; end')).toBe(
			'a&#0;b &#9; &#xD800; &#1114112; &#99999999999999999999; end'
		);
	});

	it('ends the line at a br tag of any form', () => {
		for (const br of ['<br>', '<br/>', '<br />', '<BR>', '<br class="x">', '<br\tdata-a="1" />']) {
			expect(macNoticeOf(`Mac notice: Needs macOS 10.14 or older.${br}Notice: Multiplayer is gone.`)).toBe('Needs macOS 10.14 or older.');
		}
	});

	it('gives null for a field of absurd length, and answers at once', () => {
		expect(macNoticeOf(`Mac notice: Needs macOS 10.14 or older.<br>${'x'.repeat(20_000)}`)).toBeNull();
		const started = Date.now();
		expect(macNoticeOf('<'.repeat(200_000))).toBeNull();
		// Inside the limit, a field of unclosed tags still takes no time to speak of.
		expect(macNoticeOf(`Mac notice: Needs macOS 10.14 or older.<br>${'<'.repeat(19_000)}`)).toBe('Needs macOS 10.14 or older.');
		expect(Date.now() - started).toBeLessThan(500);
	});
});

describe('mapApiProduct and the Mac notice', () => {
	it('carries the notice of the record, and null without one', () => {
		const old = mapApiProduct(apiProduct({ title: 'Old', additional: 'Mac notice: Needs macOS 10.14 or older.' }));
		expect(old.macNotice).toBe('Needs macOS 10.14 or older.');
		expect(mapApiProduct(apiProduct({ title: 'Plain' })).macNotice).toBeNull();
		expect(mapApiProduct({}).macNotice).toBeNull();
		expect(mapApiProduct({ additionalRequirements: { html: 'Mac notice: x' } }).macNotice).toBeNull();
	});
});

describe('requirementsOf', () => {
	const of = (requirements: NonNullable<Parameters<typeof apiProduct>[0]['requirements']>, os = Object.keys(requirements)) =>
		mapApiProduct(apiProduct({ title: 'Game', os, requirements })).requirements;

	it('reads the minimum and the recommended rows of each system, in GOG\'s order, osx as macOS', () => {
		expect(
			of({
				windows: {
					minimum: [['system', 'System:', 'Windows 10'], ['memory', 'Memory:', '4 GB RAM']],
					recommended: [['memory', 'Memory:', '8 GB RAM']]
				},
				osx: { minimum: [['system', 'System:', 'macOS 12']] }
			})
		).toEqual({
			windows: {
				minimum: [
					{ id: 'system', name: 'System', text: 'Windows 10' },
					{ id: 'memory', name: 'Memory', text: '4 GB RAM' }
				],
				recommended: [{ id: 'memory', name: 'Memory', text: '8 GB RAM' }]
			},
			macos: { minimum: [{ id: 'system', name: 'System', text: 'macOS 12' }], recommended: [] }
		});
	});

	it('leaves out a row without text, and takes away the label GOG repeats in the text', () => {
		expect(
			of({
				windows: {
					minimum: [
						['processor', 'Processor:', 'Processor: Quad Core'],
						['network', 'Network:', ''],
						['graphics', 'Graphics:', 'graphics:   GTX 970']
					]
				}
			}).windows!.minimum
		).toEqual([
			{ id: 'processor', name: 'Processor', text: 'Quad Core' },
			{ id: 'graphics', name: 'Graphics', text: 'GTX 970' }
		]);
	});

	it('names a row of an id it does not know by GOG\'s label, and keeps an unknown row without a label by its id', () => {
		expect(of({ linux: { minimum: [['vr', 'VR headset:', 'Any'], ['custom', '', 'Something']] } }).linux!.minimum).toEqual([
			{ id: 'vr', name: 'VR headset', text: 'Any' },
			{ id: 'custom', name: 'custom', text: 'Something' }
		]);
	});

	it('has no entry for a system without rows, and none at all for a game GOG lists none for', () => {
		expect(of({ windows: { minimum: [['network', 'Network:', '']] } })).toEqual({});
		expect(mapApiProduct(apiProduct({ title: 'Game' })).requirements).toEqual({});
	});

	it('reads what it can of an odd record, and never throws', () => {
		const odd = [
			null,
			'windows',
			{ operatingSystem: { name: 'steamos' }, systemRequirements: [{ type: 'minimum', requirements: [{ id: 'memory', name: 'Memory:', description: '1 GB' }] }] },
			{ operatingSystem: { name: 'windows' }, systemRequirements: 'none' },
			{
				operatingSystem: { name: 'linux' },
				systemRequirements: [
					{ type: 'best', requirements: [{ id: 'memory', name: 'Memory:', description: '9 GB' }] },
					{ type: 'minimum', requirements: [null, { description: 'no id and no name' }, { id: 'memory', name: 'Memory:', description: 42 }, { id: 'other', name: 'Other:', description: 'x'.repeat(5000) }, { id: 'storage', name: 'Storage:', description: '2 GB' }] }
				]
			},
			{ operatingSystem: { name: 'linux' }, systemRequirements: [{ type: 'minimum', requirements: [{ id: 'memory', name: 'Memory:', description: 'second linux' }] }] }
		];
		expect(requirementsOf(odd)).toEqual({ linux: { minimum: [{ id: 'storage', name: 'Storage', text: '2 GB' }], recommended: [] } });
		expect(requirementsOf(undefined)).toEqual({});
		expect(requirementsOf({ windows: [] })).toEqual({});
	});
});

describe('storeUrlOf', () => {
	it('takes the address of the game\'s page on GOG.com', () => {
		expect(mapApiProduct(records.apiProducts['1001']).storeUrl).toBe('https://www.gog.com/en/game/the_long_dark_road');
		expect(storeUrlOf({ href: 'https://www.gog.com/en/game/some_game' })).toBe('https://www.gog.com/en/game/some_game');
	});

	it.each([
		[{ href: 'http://www.gog.com/en/game/some_game' }],
		[{ href: 'https://evil.example/game/some_game' }],
		[{ href: 'https://www.gog.com.evil.example/game/some_game' }],
		[{ href: 'https://gog.com/en/game/some_game' }],
		[{ href: 'https://user:pw@www.gog.com/en/game/some_game' }],
		[{ href: 'https://www.gog.com:8443/en/game/some_game' }],
		[{ href: 'javascript:alert(1)' }],
		[{ href: 'not an address' }],
		[{ href: 42 }],
		[{}],
		[null],
		['https://www.gog.com/en/game/some_game']
	])('gives no address for %j', (x) => {
		expect(storeUrlOf(x)).toBeNull();
	});

	it('gives no address for a record without one', () => {
		expect(mapApiProduct(apiProduct({ title: 'Game' })).storeUrl).toBeNull();
	});
});
