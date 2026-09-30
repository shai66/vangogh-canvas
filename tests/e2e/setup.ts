import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureData, startFakeVangogh, type FakeData } from '../../src/lib/server/testing/fake-vangogh';
import { apiProduct, details, file, POSTER } from '../../src/lib/server/testing/fixtures';

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
 * Starts two fake vangoghs and three copies of the built app:
 *   CANVAS_URL        a Canvas with the library of the fixtures
 *   CANVAS_EMPTY_URL  a Canvas whose vangogh is not there, so it has no library yet
 *   CANVAS_MAC_URL    a Canvas with the two games of macLibrary()
 */
export default async function setup(): Promise<() => Promise<void>> {
	if (!existsSync('build/index.js')) throw new Error('run "npm run build" first');

	const data = fixtureData();
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
	const fake = await startFakeVangogh(data);
	const macFake = await startFakeVangogh(macLibrary());

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
	launch({
		PORT: String(port),
		VANGOGH_URL: fake.url,
		CACHE_DIR: join(cache, 'full'),
		TZ: 'UTC'
	});
	launch({ PORT: String(emptyPort), VANGOGH_URL: `http://127.0.0.1:${closedPort}`, CACHE_DIR: join(cache, 'empty') });
	launch({ PORT: String(macPort), VANGOGH_URL: macFake.url, CACHE_DIR: join(cache, 'mac'), TZ: 'UTC' });

	process.env.CANVAS_URL = `http://127.0.0.1:${port}`;
	process.env.CANVAS_EMPTY_URL = `http://127.0.0.1:${emptyPort}`;
	process.env.CANVAS_MAC_URL = `http://127.0.0.1:${macPort}`;
	try {
		await waitFor(`${process.env.CANVAS_URL}/healthz`, 200, () => output);
		await waitFor(`${process.env.CANVAS_EMPTY_URL}/healthz`, 503, () => output);
		await waitFor(`${process.env.CANVAS_MAC_URL}/healthz`, 200, () => output);
	} catch (error) {
		for (const child of children) child.kill('SIGKILL');
		await fake.close();
		await macFake.close();
		throw error;
	}

	return async () => {
		for (const child of children) child.kill('SIGKILL');
		await fake.close();
		await macFake.close();
		await rm(cache, { recursive: true, force: true });
	};
}
