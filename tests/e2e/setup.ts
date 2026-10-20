import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NOTHING_REMEMBERED } from '../../src/lib/remember';
import { fixtureData, startFakeVangogh, type FakeData } from '../../src/lib/server/testing/fake-vangogh';
import { apiProduct, details, extra, file, POSTER } from '../../src/lib/server/testing/fixtures';

// The smallest picture a browser shows: one transparent pixel.
const PIXEL = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64'
);

/** A title without a place to break it. */
export const LONG_TITLE = 'Pneumonoultramicroscopicsilicovolcanoconiosis'.repeat(3);

/** What GOG writes into the record of a product whose macOS version is too old. */
export const MAC_NOTICE = 'The game is 32-bit only and will not work on macOS 10.15 and up.';

/**
 * A library of its own for the note about an old macOS installer:
 *   2101  listed for Windows and macOS, with GOG's Mac notice; two parts on Windows
 *   2102  listed for Windows only, the archive holds a macOS installer, GOG says nothing
 */
function macLibrary(): FakeData {
	const old = '/downloads/old_mac_game';
	const unlisted = '/downloads/unlisted_mac_game';
	const filenames: Record<string, Record<string, string>> = {
		'2101': {
			[`${old}/en1installer0`]: 'setup_old_mac_game_1.0.exe',
			[`${old}/en1installer1`]: 'setup_old_mac_game_1.0-1.bin',
			[`${old}/en2installer0`]: 'old_mac_game_1.0.pkg'
		},
		'2102': {
			[`${unlisted}/en1installer0`]: 'setup_unlisted_mac_game_1.0.exe',
			[`${unlisted}/en2installer0`]: 'unlisted_mac_game_1.0.dmg'
		}
	};
	const files: FakeData['files'] = {};
	for (const [id, names] of Object.entries(filenames)) {
		for (const [manualUrl, name] of Object.entries(names)) {
			files[`${id}/installer/${manualUrl.slice(1)}`] = { name, body: Buffer.from(`content of ${name}`) };
		}
	}
	return {
		username: 'api',
		password: 'secret',
		library: [
			{ id: '2101', tt: 'Old Mac Game', os: [1, 2] },
			{ id: '2102', tt: 'Unlisted Mac Game', os: [1] }
		],
		metadata: {
			'gog-api-products/2101': apiProduct({
				title: 'Old Mac Game',
				os: ['windows', 'osx'],
				additional: `<p>\r\nMac notice: ${MAC_NOTICE}\r\n</p>`
			}),
			'gog-details/2101': details({
				english: {
					windows: [
						file(`${old}/en1installer0`, 'Old Mac Game (Part 1 of 2)', '1 MB'),
						file(`${old}/en1installer1`, 'Old Mac Game (Part 2 of 2)', '700 MB')
					],
					mac: [file(`${old}/en2installer0`, 'Old Mac Game', '2 GB')]
				}
			}),
			'gog-api-products/2102': apiProduct({ title: 'Unlisted Mac Game', os: ['windows'] }),
			'gog-details/2102': details({
				english: {
					windows: [file(`${unlisted}/en1installer0`, 'Unlisted Mac Game', '40 MB')],
					mac: [file(`${unlisted}/en2installer0`, 'Unlisted Mac Game', '250 MB')]
				}
			})
		},
		filenames,
		images: {},
		files
	};
}

/**
 * A library of its own for the extras and the system requirements:
 *   3101  three systems, co-op and multiplayer, 12 DLC, 24 extras of eight kinds in the archive,
 *         system requirements for Windows and macOS but not for Linux, first released 2015
 *   3102  Windows only, two extras, minimum requirements for Windows, first released 1998
 *   3103  Windows and Linux, no extras, no requirements, no year, no makers, a store address
 */
function richLibrary(): FakeData {
	const keeper = '/downloads/lantern_keeper';
	const small = '/downloads/small_hours';
	const quiet = '/downloads/quiet_archive';
	const filenames: Record<string, Record<string, string>> = {
		'3101': {
			[`${keeper}/en1installer0`]: 'setup_lantern_keeper_1.0.exe',
			[`${keeper}/en2installer0`]: 'lantern_keeper_1.0.pkg',
			[`${keeper}/en3installer0`]: 'lantern_keeper_1_0.sh'
		},
		'3102': { [`${small}/en1installer0`]: 'setup_small_hours_1.0.exe' },
		'3103': {
			[`${quiet}/en1installer0`]: 'setup_quiet_archive_1.0.exe',
			[`${quiet}/en3installer0`]: 'quiet_archive_1_0.sh'
		}
	};
	const files: FakeData['files'] = {};
	for (const [id, names] of Object.entries(filenames)) {
		for (const [manualUrl, name] of Object.entries(names)) {
			files[`${id}/installer/${manualUrl.slice(1)}`] = { name, body: Buffer.from(`content of ${name}`) };
		}
	}
	const onDisk = (id: string, manualUrl: string, name: string) => {
		files[`${id}/extra/${manualUrl.slice(1)}`] = { name, body: Buffer.from(`content of ${name}`) };
	};

	// 24 extras of 3101 in the archive: four or two of each kind, the last a kind GOG may add later.
	const kinds: [string, string, number][] = [
		['manuals', 'manual', 4],
		['audio', 'soundtrack', 4],
		['artworks', 'artwork', 4],
		['wallpapers', 'wallpaper', 4],
		['avatars', 'avatars', 2],
		['video', 'video', 2],
		['game add-ons', 'add-on', 2],
		['comic book', 'comic', 2]
	];
	const keeperExtras: unknown[] = [];
	let n = 0;
	for (const [kind, word, count] of kinds) {
		for (let i = 1; i <= count; i++) {
			const manualUrl = `${keeper}/en0extra${n++}`;
			const name = `${word} ${i}`;
			keeperExtras.push(extra(manualUrl, name, kind, '12 MB'));
			onDisk('3101', manualUrl, `lantern_keeper_${name.replace(/\W+/g, '_')}.zip`);
		}
	}
	// Two more that GOG lists and the panel leaves out: one vangogh never downloads, one not in the archive.
	keeperExtras.push(extra(`${keeper}/en0extra90`, 'empty', 'manuals', '0 MB'));
	keeperExtras.push(extra(`${keeper}/en0extra91`, 'lost artbook', 'artworks', '40 MB'));

	const smallExtras = [extra(`${small}/en0extra0`, 'manual', 'manuals', '8 MB'), extra(`${small}/en0extra1`, 'soundtrack', 'audio', '90 MB')];
	onDisk('3102', `${small}/en0extra0`, 'small_hours_manual.pdf');
	onDisk('3102', `${small}/en0extra1`, 'small_hours_soundtrack.zip');

	return {
		username: 'api',
		password: 'secret',
		library: [
			{
				id: '3101',
				tt: 'Lantern Keeper',
				os: [1, 2, 3],
				dlc: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(3201 + i), `Keeper Pack ${i + 1}`]))
			},
			{ id: '3102', tt: 'Small Hours', os: [1] },
			{ id: '3103', tt: 'Quiet Archive', os: [1, 3] }
		],
		metadata: {
			'gog-api-products/3101': apiProduct({
				title: 'Lantern Keeper',
				os: ['windows', 'osx', 'linux'],
				genres: ['Adventure'],
				features: ['Single-player', 'Co-op', 'Multi-player'],
				released: '2015-03-01T00:00:00+01:00',
				requirements: {
					windows: {
						minimum: [
							['system', 'System:', 'Windows 10'],
							['processor', 'Processor:', 'Processor: Dual core 2 GHz'],
							['memory', 'Memory:', '4 GB RAM'],
							['network', 'Network:', '']
						],
						recommended: [
							['system', 'System:', 'Windows 11'],
							['memory', 'Memory:', '8 GB RAM']
						]
					},
					osx: { minimum: [['system', 'System:', 'macOS 12'], ['memory', 'Memory:', '8 GB RAM']] }
				}
			}),
			'gog-details/3101': details({
				english: {
					windows: [file(`${keeper}/en1installer0`, 'Lantern Keeper', '1 GB')],
					mac: [file(`${keeper}/en2installer0`, 'Lantern Keeper', '1 GB')],
					linux: [file(`${keeper}/en3installer0`, 'Lantern Keeper', '1 GB')]
				},
				extras: keeperExtras
			}),
			'gog-api-products/3102': apiProduct({
				title: 'Small Hours',
				os: ['windows'],
				genres: ['Puzzle'],
				released: '1998-05-01T00:00:00+02:00',
				requirements: { windows: { minimum: [['system', 'System:', 'Windows 98'], ['memory', 'Memory:', '64 MB RAM']] } }
			}),
			'gog-details/3102': details({
				english: { windows: [file(`${small}/en1installer0`, 'Small Hours', '200 MB')] },
				extras: smallExtras
			}),
			'gog-api-products/3103': apiProduct({
				title: 'Quiet Archive',
				os: ['windows', 'linux'],
				genres: ['Strategy'],
				store: 'https://www.gog.com/en/game/quiet_archive'
			}),
			'gog-details/3103': details({
				english: {
					windows: [file(`${quiet}/en1installer0`, 'Quiet Archive', '300 MB')],
					linux: [file(`${quiet}/en3installer0`, 'Quiet Archive', '300 MB')]
				}
			})
		},
		filenames,
		images: {},
		files
	};
}

/** The image id of an invented product's picture: its id, sixteen times. */
export const pictureOf = (id: string): string => id.repeat(16);

/**
 * A library of its own for the collections, with invented series and packs. In the order of
 * purchase, newest first:
 *   4117          Night Ferry, 2015, of no collection
 *   4103          Saltwater Detectives, 2001, Windows and macOS, of GOG's series "Thornwick Mysteries" (500)
 *   4115          Lanterns of Orrin, 1999, of the series "Orrin Tales" (501) of one game, and of a
 *                 pack, 4898, that vangogh does not have
 *   4116          Quiet Harbour, 2012, Linux only, of the shop bundle 4805 of ten games
 *   4104, 4105    Helix Drift, 2004, and Copper Rally 88, 1988: the pack 4802 "Parallax Racing
 *                 Trilogy", of three games on GOG, which GOG sells them as. Its poster is not in
 *                 the archive.
 *   4101, 4102    Thornwick Mysteries, 1996, Windows and Linux, and Thornwick Mysteries 2, 1998:
 *                 the series 500, and the pack 4801 "Thornwick Double Feature", which GOG sells
 *                 them as. The series leads.
 *   4106 to 4114  Lantern Coast: Chapter 1 to 9, 2010 to 2018: the pack 4803 "Lantern Coast
 *                 Saga" holds the first seven and the pack 4804 "Lantern Coast: Season Two",
 *                 which holds the last two.
 * The collections: Lantern Coast Saga (9 games), Parallax Racing Trilogy (2), Thornwick Mysteries (3).
 */
function collectionLibrary(): FakeData {
	const at = 'https://www.gog.com/en/game';
	const thornwick = { id: 500, name: 'Thornwick Mysteries' };
	type System = 'windows' | 'osx' | 'linux';
	interface Game {
		id: string;
		title: string;
		year: number;
		os?: System[];
		series?: { id: number; name: string };
		store?: string;
		includedIn?: string[];
		ratings?: { pegi: number };
	}
	const chapters: Game[] = Array.from({ length: 9 }, (_, i) => ({
		id: String(4106 + i),
		title: `Lantern Coast: Chapter ${i + 1}`,
		year: 2010 + i,
		includedIn: [i < 7 ? '4803' : '4804']
	}));
	const games: Game[] = [
		{ id: '4117', title: 'Night Ferry', year: 2015 },
		{ id: '4103', title: 'Saltwater Detectives', year: 2001, os: ['windows', 'osx'], series: thornwick, ratings: { pegi: 18 } },
		{ id: '4115', title: 'Lanterns of Orrin', year: 1999, series: { id: 501, name: 'Orrin Tales' }, includedIn: ['4898'] },
		{ id: '4116', title: 'Quiet Harbour', year: 2012, os: ['linux'], includedIn: ['4805'] },
		{ id: '4104', title: 'Helix Drift', year: 2004, store: `${at}/parallax_racing_trilogy`, includedIn: ['4802'] },
		{ id: '4105', title: 'Copper Rally 88', year: 1988, store: `${at}/parallax_racing_trilogy`, includedIn: ['4802'] },
		{ id: '4101', title: 'Thornwick Mysteries', year: 1996, os: ['windows', 'linux'], series: thornwick, store: `${at}/thornwick_double_feature`, includedIn: ['4801'] },
		{ id: '4102', title: 'Thornwick Mysteries 2', year: 1998, series: thornwick, store: `${at}/thornwick_double_feature`, includedIn: ['4801'] },
		...chapters
	];
	const number: Record<System, number> = { windows: 1, osx: 2, linux: 3 };
	const metadata: Record<string, unknown> = {};
	const filenames: Record<string, Record<string, string>> = {};
	const files: FakeData['files'] = {};
	const images: FakeData['images'] = {};
	for (const g of games) {
		const os = g.os ?? ['windows'];
		const path = `/downloads/game_${g.id}`;
		metadata[`gog-api-products/${g.id}`] = apiProduct({
			title: g.title,
			os,
			genres: ['Adventure'],
			poster: pictureOf(g.id),
			released: `${g.year}-06-01T00:00:00+02:00`,
			series: g.series,
			store: g.store,
			includedIn: g.includedIn,
			ratings: g.ratings
		});
		metadata[`gog-details/${g.id}`] = details({
			english: Object.fromEntries(os.map((o) => [o === 'osx' ? 'mac' : o, [file(`${path}/en${number[o]}installer0`, g.title, '100 MB')]]))
		});
		filenames[g.id] = Object.fromEntries(os.map((o) => [`${path}/en${number[o]}installer0`, `setup_${g.id}_${o}.bin`]));
		for (const o of os) {
			files[`${g.id}/installer${path}/en${number[o]}installer0`] = { name: `setup_${g.id}_${o}.bin`, body: Buffer.from(`content of ${g.title}`) };
		}
		images[pictureOf(g.id)] = { type: 'image/png', body: PIXEL };
	}
	metadata['gog-api-products/4801'] = apiProduct({ title: 'Thornwick Double Feature', type: 'PACK', poster: pictureOf('4801'), store: `${at}/thornwick_double_feature`, includes: ['4101', '4102'] });
	// The archive lacks this poster: the card shows the oldest game's.
	metadata['gog-api-products/4802'] = apiProduct({ title: 'Parallax Racing Trilogy', type: 'PACK', poster: pictureOf('4802'), store: `${at}/parallax_racing_trilogy`, includes: ['4104', '4105', '4199'] });
	metadata['gog-api-products/4803'] = apiProduct({
		title: 'Lantern Coast Saga',
		type: 'PACK',
		poster: pictureOf('4803'),
		store: `${at}/lantern_coast_saga`,
		includes: [...chapters.slice(0, 7).map((g) => g.id), '4804']
	});
	metadata['gog-api-products/4804'] = apiProduct({ title: 'Lantern Coast: Season Two', type: 'PACK', includes: ['4113', '4114'] });
	metadata['gog-api-products/4805'] = apiProduct({
		title: 'Everything Bundle',
		type: 'PACK',
		includes: ['4116', '4104', ...Array.from({ length: 8 }, (_, i) => String(4190 + i))]
	});
	images[pictureOf('4801')] = { type: 'image/png', body: PIXEL };
	images[pictureOf('4803')] = { type: 'image/png', body: PIXEL };
	return {
		username: 'api',
		password: 'secret',
		library: games.map((g) => ({ id: g.id, tt: g.title, os: (g.os ?? ['windows']).map((o) => number[o]) })),
		metadata,
		filenames,
		images,
		files
	};
}

/**
 * The library of the settings tests: the fixtures with pictures a browser shows, and two more entries:
 *   1005  Missing Files Game, as the main library has it: GOG offers an installer, the archive holds no file
 *   1008  Foreign Only Game, Windows, whose only files are German
 */
function settingsLibrary(): FakeData {
	const data = fixtureData();
	// The fixtures' pictures are words. A browser needs real ones.
	for (const id of Object.keys(data.images)) data.images[id] = { type: 'image/png', body: PIXEL };
	data.library = [
		...(data.library as unknown[]),
		{ id: '1005', tt: 'Missing Files Game', os: [1] },
		{ id: '1008', tt: 'Foreign Only Game', os: [1] }
	];
	data.metadata['gog-api-products/1005'] = apiProduct({ title: 'Missing Files Game', genres: ['Puzzle'] });
	data.metadata['gog-details/1005'] = details({
		english: { windows: [file('/downloads/missing_files_game/en1installer0', 'Missing Files Game')] }
	});
	data.metadata['gog-api-products/1008'] = apiProduct({ title: 'Foreign Only Game', genres: ['Puzzle'] });
	data.metadata['gog-details/1008'] = details({
		other: [['Deutsch', { windows: [file('/downloads/foreign_only_game/de1installer0', 'Foreign Only Game', '10 MB')] }]]
	});
	data.files['1008/installer/downloads/foreign_only_game/de1installer0'] = { name: 'setup_foreign_only_game.exe', body: Buffer.from('foreign') };
	data.filenames = {
		...data.filenames,
		'1005': {},
		'1008': { '/downloads/foreign_only_game/de1installer0': 'setup_foreign_only_game.exe' }
	};
	return data;
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as { port: number };
			server.close(() => resolve(port));
		});
	});
}

async function waitFor(url: string, wanted: number, output: () => string): Promise<void> {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		const status = await fetch(url).then((r) => r.status, () => 0);
		if (status === wanted) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`timed out waiting for ${url} to answer ${wanted}. Output of the app:\n${output()}`);
}

/**
 * Starts six fake vangoghs and seven copies of the built app:
 *   CANVAS_URL        a Canvas with the library of the fixtures
 *   CANVAS_EMPTY_URL  a Canvas whose vangogh is not there, so it has no library yet
 *   CANVAS_MAC_URL    a Canvas with the two games of macLibrary()
 *   CANVAS_RICH_URL   a Canvas with the three games of richLibrary()
 *   CANVAS_COLLECTIONS_URL  a Canvas with the seventeen games of collectionLibrary()
 *   CANVAS_SETTINGS_URL     a Canvas with a PIN, 2468, and the library of settingsLibrary()
 *   CANVAS_THEO_URL         the same, with a vangogh of its own and theo switched on before it starts
 */
export default async function setup(): Promise<() => Promise<void>> {
	if (!existsSync('build/index.js')) throw new Error('run "npm run build" first');

	const data = fixtureData();
	// No extras in this library: the browser tests of the extras have a library of their own,
	// and the tests of this one count what the detail of 1001 shows.
	for (const key of Object.keys(data.files)) if (key.includes('/extra/')) delete data.files[key];
	// The fixtures' pictures are words. A browser needs real ones.
	for (const id of Object.keys(data.images)) data.images[id] = { type: 'image/png', body: PIXEL };
	// 1002 loses its portrait poster in the archive: its wide image has to stand in.
	delete data.images[POSTER['1002']];
	// The file of the DLC is listed by vangogh and is not there: "missing in the archive".
	delete data.files['1001/downloadable-content/downloads/road_expansion/en1installer0'];
	// A fifth entry, which the fixtures do not have: GOG offers an installer, the archive holds no file.
	data.library = [...(data.library as unknown[]), { id: '1005', tt: 'Missing Files Game', os: [1] }];
	data.metadata['gog-api-products/1005'] = apiProduct({ title: 'Missing Files Game', genres: ['Puzzle'] });
	data.metadata['gog-details/1005'] = details({
		english: { windows: [file('/downloads/missing_files_game/en1installer0', 'Missing Files Game')] }
	});
	// A sixth: a title of one very long word, which no layout may be widened by.
	data.library = [...(data.library as unknown[]), { id: '1006', tt: LONG_TITLE, os: [1] }];
	data.metadata['gog-api-products/1006'] = apiProduct({ title: LONG_TITLE, genres: ['Puzzle'] });
	data.metadata['gog-details/1006'] = details({
		english: { windows: [file('/downloads/long/en1installer0', LONG_TITLE, '10 MB')] }
	});
	data.files['1006/installer/downloads/long/en1installer0'] = { name: 'setup_long.exe', body: Buffer.from('long') };
	// A seventh: no files of its own, and two DLC of the same name, each with a Windows file.
	data.library = [...(data.library as unknown[]), { id: '1007', tt: 'Expansion Only Game', os: [1] }];
	data.metadata['gog-api-products/1007'] = apiProduct({ title: 'Expansion Only Game', genres: ['Puzzle'] });
	data.metadata['gog-details/1007'] = details({
		english: {},
		dlcs: [
			{ title: 'Only Expansion', english: { windows: [file('/downloads/only_expansion/en1installer0', 'Only Expansion', '20 MB')] } },
			{ title: 'Only Expansion', english: { windows: [file('/downloads/only_expansion_2/en1installer0', 'Only Expansion', '30 MB')] } }
		]
	});
	data.files['1007/downloadable-content/downloads/only_expansion/en1installer0'] = { name: 'setup_only_expansion.exe', body: Buffer.from('only') };
	data.files['1007/downloadable-content/downloads/only_expansion_2/en1installer0'] = { name: 'setup_only_expansion_2.exe', body: Buffer.from('only 2') };
	data.filenames = {
		...data.filenames,
		'1005': {},
		'1006': { '/downloads/long/en1installer0': 'setup_long.exe' },
		'1007': {
			'/downloads/only_expansion/en1installer0': 'setup_only_expansion.exe',
			'/downloads/only_expansion_2/en1installer0': 'setup_only_expansion_2.exe'
		}
	};
	// The version check: the main Canvas sees a newer release, the rich one its own version.
	data.release = 'v99.0.0';
	const own = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
	const rich = richLibrary();
	rich.release = `v${own}`;
	const fake = await startFakeVangogh(data);
	const macFake = await startFakeVangogh(macLibrary());
	const richFake = await startFakeVangogh(rich);
	const collectionsFake = await startFakeVangogh(collectionLibrary());
	const settingsFake = await startFakeVangogh(settingsLibrary());
	// 1001 keeps its extras in this library too: the extras' panel stands under the theo panel.
	const theoFake = await startFakeVangogh(settingsLibrary());

	const cache = await mkdtemp(join(tmpdir(), 'canvas-e2e-'));
	const children: ChildProcess[] = [];
	let output = '';
	const launch = (env: Record<string, string>): void => {
		const child = spawn(process.execPath, ['build'], {
			env: { PATH: process.env.PATH ?? '', HOST: '127.0.0.1', VANGOGH_USERNAME: 'api', VANGOGH_PASSWORD: 'secret', ...env },
			stdio: ['ignore', 'pipe', 'pipe']
		});
		child.stdout?.on('data', (chunk) => (output += chunk));
		child.stderr?.on('data', (chunk) => (output += chunk));
		children.push(child);
	};

	const port = await freePort();
	const emptyPort = await freePort();
	const closedPort = await freePort();
	const macPort = await freePort();
	const richPort = await freePort();
	const collectionsPort = await freePort();
	const settingsPort = await freePort();
	const theoPort = await freePort();
	launch({
		PORT: String(port),
		VANGOGH_URL: fake.url,
		CACHE_DIR: join(cache, 'full'),
		TZ: 'UTC',
		VERSION_CHECK_URL: `${fake.url}/releases/latest`
	});
	launch({ PORT: String(emptyPort), VANGOGH_URL: `http://127.0.0.1:${closedPort}`, CACHE_DIR: join(cache, 'empty'), VERSION_CHECK: 'off' });
	launch({ PORT: String(macPort), VANGOGH_URL: macFake.url, CACHE_DIR: join(cache, 'mac'), TZ: 'UTC', VERSION_CHECK: 'off' });
	launch({ PORT: String(richPort), VANGOGH_URL: richFake.url, CACHE_DIR: join(cache, 'rich'), TZ: 'UTC', VERSION_CHECK_URL: `${richFake.url}/releases/latest` });
	launch({ PORT: String(collectionsPort), VANGOGH_URL: collectionsFake.url, CACHE_DIR: join(cache, 'collections'), TZ: 'UTC', VERSION_CHECK: 'off' });
	launch({
		PORT: String(settingsPort),
		VANGOGH_URL: settingsFake.url,
		CACHE_DIR: join(cache, 'settings-cache'),
		SETTINGS_PIN: '2468',
		SETTINGS_DIR: join(cache, 'settings'),
		TZ: 'UTC',
		VERSION_CHECK: 'off'
	});
	// The theo tests need theo on without depending on the tests of the settings: it is in the file before Canvas reads it.
	await mkdir(join(cache, 'theo'), { recursive: true });
	await writeFile(join(cache, 'theo', 'settings.json'), JSON.stringify({ version: 1, defaults: NOTHING_REMEMBERED, theo: true }));
	launch({
		PORT: String(theoPort),
		VANGOGH_URL: theoFake.url,
		CACHE_DIR: join(cache, 'theo-cache'),
		SETTINGS_PIN: '2468',
		SETTINGS_DIR: join(cache, 'theo'),
		TZ: 'UTC',
		VERSION_CHECK: 'off'
	});

	process.env.CANVAS_URL = `http://127.0.0.1:${port}`;
	process.env.CANVAS_EMPTY_URL = `http://127.0.0.1:${emptyPort}`;
	process.env.CANVAS_MAC_URL = `http://127.0.0.1:${macPort}`;
	process.env.CANVAS_RICH_URL = `http://127.0.0.1:${richPort}`;
	process.env.CANVAS_COLLECTIONS_URL = `http://127.0.0.1:${collectionsPort}`;
	process.env.CANVAS_SETTINGS_URL = `http://127.0.0.1:${settingsPort}`;
	process.env.CANVAS_THEO_URL = `http://127.0.0.1:${theoPort}`;
	try {
		await waitFor(`${process.env.CANVAS_URL}/healthz`, 200, () => output);
		await waitFor(`${process.env.CANVAS_EMPTY_URL}/healthz`, 503, () => output);
		await waitFor(`${process.env.CANVAS_MAC_URL}/healthz`, 200, () => output);
		await waitFor(`${process.env.CANVAS_RICH_URL}/healthz`, 200, () => output);
		await waitFor(`${process.env.CANVAS_COLLECTIONS_URL}/healthz`, 200, () => output);
		await waitFor(`${process.env.CANVAS_SETTINGS_URL}/healthz`, 200, () => output);
		await waitFor(`${process.env.CANVAS_THEO_URL}/healthz`, 200, () => output);
	} catch (error) {
		for (const child of children) child.kill('SIGKILL');
		await fake.close();
		await macFake.close();
		await richFake.close();
		await collectionsFake.close();
		await settingsFake.close();
		await theoFake.close();
		throw error;
	}

	return async () => {
		for (const child of children) child.kill('SIGKILL');
		await fake.close();
		await macFake.close();
		await richFake.close();
		await collectionsFake.close();
		await settingsFake.close();
		await theoFake.close();
		await rm(cache, { recursive: true, force: true });
	};
}
