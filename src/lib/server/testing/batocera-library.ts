import { createHash } from 'node:crypto';
import { apiProduct, details, file } from './fixtures';
import type { FakeData } from './fake-vangogh';

/** The fake installer of the tests: JSON that a fake innoextract writes out as files. Paths use `/`. */
export function fakeInstaller(files: Record<string, string>): Buffer {
	return Buffer.from(JSON.stringify({ files }));
}

const md5 = (body: Buffer): string => createHash('md5').update(body).digest('hex');

const POSTER = '6'.repeat(64);
const BACKDROP = '7'.repeat(64);

const harbour = '/downloads/night_harbour';
const cellar = '/downloads/cellar_quest';
const tale = '/downloads/mac_only_tale';

function info(gameId: string, playTasks?: unknown[]): string {
	return JSON.stringify({
		buildId: '1',
		clientId: gameId,
		gameId,
		language: 'English',
		name: 'Fake',
		rootGameId: gameId,
		...(playTasks ? { playTasks } : {})
	});
}

const CELLAR_AUTOEXEC = ['[autoexec]', '@echo off', 'mount C ".."', 'imgmount d "..\\cellar.cue" -t iso', 'c:', 'cd CELLAR', 'cellar.exe', 'exit', ''].join('\r\n');

/**
 * A library for the tests of Send to Batocera:
 *   3001  Night Harbour, a Windows game from 1999 with one DLC (3002, Lighthouse)
 *   3003  Cellar Quest, a DOS game
 *   3004  Mac Only Tale, with macOS files only
 * Every installer is a fake one (see `fakeInstaller`), with the checksum of its content.
 */
export function batoceraLibrary(): FakeData {
	const installers: Record<string, { manualUrl: string; type: 'installer' | 'downloadable-content'; name: string; body: Buffer }[]> = {
		'3001': [
			{
				manualUrl: `${harbour}/en1installer0`,
				type: 'installer',
				name: 'setup_night_harbour_1.2.exe',
				body: fakeInstaller({
					'goggame-3001.info': info('3001', [
						{ category: 'launcher', isPrimary: true, languages: ['en-US'], name: 'Night Harbour', path: 'Launcher.exe', type: 'FileTask' },
						{ category: 'game', isHidden: true, name: 'Night Harbour', path: 'bin\\Harbour.exe', workingDir: 'bin', type: 'FileTask' }
					]),
					'Launcher.exe': 'launcher',
					'bin/Harbour.exe': 'harbour',
					'bin/data.pak': 'data'
				})
			},
			{
				manualUrl: '/downloads/night_harbour_lighthouse/en1installer0',
				type: 'downloadable-content',
				name: 'setup_night_harbour_lighthouse_1.2.exe',
				body: fakeInstaller({ 'goggame-3002.info': info('3002'), 'dlc/lighthouse.pak': 'lighthouse' })
			}
		],
		'3003': [
			{
				manualUrl: `${cellar}/en1installer0`,
				type: 'installer',
				name: 'setup_cellar_quest_1.0.exe',
				body: fakeInstaller({
					'goggame-3003.info': info('3003', [
						{
							arguments: '-conf "..\\dosboxcellar.conf" -conf "..\\dosboxcellar_single.conf" -noconsole -c "exit"',
							category: 'game',
							isPrimary: true,
							name: 'Cellar Quest',
							path: 'DOSBOX\\dosbox.exe',
							workingDir: 'DOSBOX',
							type: 'FileTask'
						}
					]),
					'DOSBOX/DOSBox.exe': 'dosbox',
					'dosboxcellar.conf': '[sdl]\r\nfullscreen=true\r\n',
					'dosboxcellar_single.conf': CELLAR_AUTOEXEC,
					'cellar.cue': 'FILE "cellar.iso" BINARY\r\n',
					'CELLAR/cellar.exe': 'cellar'
				})
			}
		]
	};

	const filenames: Record<string, Record<string, string>> = {
		'3001': {},
		'3003': {},
		'3004': { [`${tale}/en2installer0`]: 'mac_only_tale_1.0.pkg' }
	};
	const files: FakeData['files'] = {};
	const checksums: Record<string, Record<string, string>> = { '3004': { [`${tale}/en2installer0`]: md5(Buffer.from('mac only tale')) } };
	for (const [id, list] of Object.entries(installers)) {
		checksums[id] = {};
		for (const { manualUrl, type, name, body } of list) {
			filenames[id][manualUrl] = name;
			files[`${id}/${type}/${manualUrl.slice(1)}`] = { name, body };
			checksums[id][manualUrl] = md5(body);
		}
	}
	// A Mac game has a file on disk too; 3003 has a macOS file as well, as GOG often lists.
	filenames['3003'][`${cellar}/en2installer0`] = 'cellar_quest_1.0.pkg';
	files[`3003/installer/${cellar.slice(1)}/en2installer0`] = { name: 'cellar_quest_1.0.pkg', body: Buffer.from('cellar mac') };
	checksums['3003'][`${cellar}/en2installer0`] = md5(Buffer.from('cellar mac'));
	files[`3004/installer/${tale.slice(1)}/en2installer0`] = { name: 'mac_only_tale_1.0.pkg', body: Buffer.from('mac only tale') };

	const png = { type: 'image/png', body: Buffer.from('image') };
	return {
		username: 'api',
		password: 'secret',
		library: [
			{ id: '3001', tt: 'Night Harbour', os: [1], dlc: { '3002': 'Night Harbour: Lighthouse' } },
			{ id: '3003', tt: 'Cellar Quest', os: [1, 2] },
			{ id: '3004', tt: 'Mac Only Tale', os: [2] }
		],
		metadata: {
			'gog-api-products/3001': apiProduct({
				title: 'Night Harbour',
				genres: ['Adventure', 'Puzzle'],
				os: ['windows'],
				developers: ['Tidewater Works'],
				publisher: 'Lantern Press',
				released: '1999-05-04T00:00:00+02:00',
				poster: POSTER,
				backdrop: BACKDROP
			}),
			'gog-details/3001': details({
				english: { windows: [file(`${harbour}/en1installer0`, 'Night Harbour', '1 MB', '1.2')] },
				dlcs: [
					{
						title: 'Night Harbour: Lighthouse',
						english: { windows: [file('/downloads/night_harbour_lighthouse/en1installer0', 'Night Harbour: Lighthouse', '1 MB', '1.2')] }
					}
				]
			}),
			'gog-api-products/3003': apiProduct({ title: 'Cellar Quest', genres: ['Adventure'], os: ['windows', 'osx'], dos: true, released: '1994-01-01T00:00:00+01:00' }),
			'gog-details/3003': details({
				english: {
					windows: [file(`${cellar}/en1installer0`, 'Cellar Quest', '1 MB', '1.0')],
					mac: [file(`${cellar}/en2installer0`, 'Cellar Quest', '1 MB', '1.0')]
				}
			}),
			'gog-api-products/3004': apiProduct({ title: 'Mac Only Tale', genres: ['Adventure'], os: ['osx'] }),
			'gog-details/3004': details({ english: { mac: [file(`${tale}/en2installer0`, 'Mac Only Tale', '1 MB', '1.0')] } })
		},
		filenames,
		images: { [POSTER]: png, [BACKDROP]: png },
		files,
		checksums
	};
}
