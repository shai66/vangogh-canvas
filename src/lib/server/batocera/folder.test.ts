import { describe, expect, it } from 'vitest';
import { autorunCmd, chooseTask, dosboxBat, folderName, markerJson, parseMarker, type Marker, type PlayTask } from './folder';

const task = (over: Record<string, unknown>) => ({ type: 'FileTask', category: 'game', path: 'bin\\Game.exe', ...over });
const info = (...playTasks: Record<string, unknown>[]) => ({ gameId: '1', playTasks });

describe('folderName', () => {
	it('makes a folder name of any title', () => {
		expect(folderName('Night Harbour: The Return?', '3001')).toBe('Night Harbour The Return');
		expect(folderName('  Cellar   Quest...  ', '3003')).toBe('Cellar Quest');
		expect(folderName('A<b>c|d*e"f/g\\h', '1')).toBe('Abcdefgh');
		expect(folderName('???', '3005')).toBe('3005');
	});
});

describe('chooseTask', () => {
	it("chooses the hidden game task over GOG's launcher", () => {
		const launcher = task({ category: 'launcher', isPrimary: true, path: 'Launcher.exe' });
		const game = task({ isHidden: true });
		expect(chooseTask(info(launcher, game))).toMatchObject({ path: 'bin\\Game.exe' });
	});

	it('chooses the primary task when no game task is hidden', () => {
		const first = task({ path: 'a.exe' });
		const primary = task({ path: 'b.exe', isPrimary: true });
		expect(chooseTask(info(first, primary))?.path).toBe('b.exe');
	});

	it('chooses the first game task when none is primary', () => {
		expect(chooseTask(info(task({ category: 'document', path: 'x.exe' }), task({ path: 'a.exe' }), task({ path: 'b.exe' })))?.path).toBe('a.exe');
	});

	it('skips tasks that are not files or not .exe', () => {
		const link = task({ type: 'URLTask', isHidden: true, path: 'x.exe' });
		const bat = task({ isHidden: true, path: 'start.bat' });
		expect(chooseTask(info(link, bat))).toBeNull();
		expect(chooseTask(info(link, bat, task({ path: 'Real.EXE' })))?.path).toBe('Real.EXE');
	});

	it('chooses nothing from an info without tasks', () => {
		expect(chooseTask({ gameId: '1' })).toBeNull();
		expect(chooseTask(null)).toBeNull();
		expect(chooseTask('x')).toBeNull();
		expect(chooseTask({ playTasks: 'x' })).toBeNull();
	});
});

describe('autorunCmd', () => {
	const files = ['Launcher.exe', 'bin/Harbour.exe', 'bin/data.pak'];

	it('writes autorun.cmd', () => {
		expect(autorunCmd({ path: 'bin\\HARBOUR.EXE', workingDir: 'bin' }, files)).toBe('DIR=bin\nCMD="Harbour.exe"\n');
		expect(autorunCmd({ path: 'bin\\Harbour.exe', workingDir: '', arguments: '-skipintro' }, files)).toBe('DIR=bin\nCMD="Harbour.exe" -skipintro\n');
		expect(autorunCmd({ path: 'Launcher.exe' }, files)).toBe('CMD="Launcher.exe"\n');
		expect(autorunCmd({ path: 'bin\\Harbour.exe', workingDir: 'data' }, [...files, 'data/x.cfg'])).toBe('DIR=data\nCMD="../bin/Harbour.exe"\n');
		expect(autorunCmd({ path: 'missing.exe' }, files)).toBeNull();
	});

	it('counts a working folder that is the root as given', () => {
		expect(autorunCmd({ path: 'bin\\Harbour.exe', workingDir: '.' }, files)).toBe('CMD="bin/Harbour.exe"\n');
		expect(autorunCmd({ path: 'bin\\Harbour.exe', workingDir: '.\\' }, files)).toBe('CMD="bin/Harbour.exe"\n');
	});
});

describe('dosboxBat', () => {
	const cellar: PlayTask = {
		arguments: '-conf "..\\dosboxcellar.conf" -conf "..\\dosboxcellar_single.conf" -noconsole -c "exit"',
		path: 'DOSBOX\\dosbox.exe',
		workingDir: 'DOSBOX'
	};
	const files = ['DOSBOX/DOSBox.exe', 'dosboxcellar.conf', 'dosboxcellar_single.conf', 'cellar.cue', 'CELLAR/cellar.exe'];
	const contents: Record<string, string> = {
		'dosboxcellar.conf': '[sdl]\r\nfullscreen=true\r\n',
		'dosboxcellar_single.conf': ['[autoexec]', '# a comment', '@echo off', 'mount C ".."', 'imgmount d "..\\cellar.cue" -t iso', 'c:', 'cd CELLAR', 'cellar.exe', 'exit', ''].join('\r\n')
	};
	const read = (file: string) => contents[file] ?? null;

	it("writes dosbox.bat from GOG's autoexec", () => {
		expect(dosboxBat(cellar, files, read)).toBe('imgmount d "C:\\cellar.cue" -t iso\r\nc:\r\ncd CELLAR\r\ncellar.exe\r\n');
	});

	it('skips a configuration that is missing', () => {
		expect(dosboxBat(cellar, files, (f) => (f === 'dosboxcellar.conf' ? null : read(f)))).toBe(
			'imgmount d "C:\\cellar.cue" -t iso\r\nc:\r\ncd CELLAR\r\ncellar.exe\r\n'
		);
	});

	it("goes to a game's sub-folder where GOG mounts it as C, and keeps a menu of several games as it is", () => {
		const lantern: PlayTask = { arguments: '-conf "..\\dosboxlantern.conf" -conf "..\\dosboxlantern_single.conf" -noconsole -c "exit"', path: 'DOSBOX\\dosbox.exe', workingDir: 'DOSBOX' };
		const onDisk = ['DOSBOX/DOSBox.exe', 'dosboxlantern.conf', 'dosboxlantern_single.conf', 'game.ins', 'Lantern/LANTERN.EXE', 'LantKit/KIT.EXE', 'LantFan/FAN.EXE'];
		const menu = [
			'[autoexec]',
			'@echo off',
			'imgmount d "..\\game.ins" -t iso -fs iso',
			'cls',
			'@ECHO 1) Lantern',
			'@ECHO 2) Lantern Kit',
			'@ECHO 3) Lantern Fans',
			'@ECHO 4) Back',
			'@choice /c1234 /s Which game? [1-4]: /n',
			'if errorlevel 4 goto exit',
			'if errorlevel 3 goto fans',
			'if errorlevel 2 goto kit',
			'if errorlevel 1 goto lantern',
			':lantern',
			'MOUNT C "..\\LANTERN"',
			'mount C "..\\cloud_saves" -t overlay',
			'C:',
			'CONFIG -set "cpu cycles=max"',
			'LANTERN.EXE',
			'exit',
			':kit',
			'mount C "..\\LantKit"',
			'mount C "..\\cloud_saves" -t overlay',
			'C:',
			'KIT.EXE',
			'exit',
			':fans',
			'mount c ..\\LantFan',
			'mount c "..\\cloud_saves" -t overlay',
			'c:',
			'FAN.EXE',
			'exit',
			':exit',
			'exit',
			''
		].join('\r\n');
		const texts: Record<string, string> = { 'dosboxlantern.conf': '[sdl]\r\nfullscreen=true\r\n', 'dosboxlantern_single.conf': menu };
		expect(dosboxBat(lantern, onDisk, (file) => texts[file] ?? null)?.split('\r\n')).toEqual([
			'imgmount d "C:\\game.ins" -t iso -fs iso',
			'cls',
			'@ECHO 1) Lantern',
			'@ECHO 2) Lantern Kit',
			'@ECHO 3) Lantern Fans',
			'@ECHO 4) Back',
			'@choice /c1234 /s Which game? [1-4]: /n',
			'if errorlevel 4 goto exit',
			'if errorlevel 3 goto fans',
			'if errorlevel 2 goto kit',
			'if errorlevel 1 goto lantern',
			':lantern',
			'C:',
			'cd \\Lantern',
			'C:',
			'CONFIG -set "cpu cycles=max"',
			'LANTERN.EXE',
			'exit',
			':kit',
			'C:',
			'cd \\LantKit',
			'C:',
			'KIT.EXE',
			'exit',
			':fans',
			'C:',
			'cd \\LantFan',
			'c:',
			'FAN.EXE',
			'exit',
			':exit',
			'exit',
			''
		]);
	});

	it('drops the exit of an autoexec with a :: comment and no label', () => {
		const bat = dosboxBat(cellar, files, () => '[autoexec]\r\n:: a comment\r\ncellar.exe\r\nexit\r\n');
		// The cellar task reads two configurations, so the same text comes twice.
		expect(bat).toBe(':: a comment\r\ncellar.exe\r\n:: a comment\r\ncellar.exe\r\n');
	});

	it('writes nothing when no line is left', () => {
		expect(dosboxBat(cellar, files, () => null)).toBeNull();
		expect(dosboxBat(cellar, files, () => '[autoexec]\r\n@echo off\r\nmount c ..\r\nexit\r\n[sdl]\r\nx=1\r\n')).toBeNull();
	});

	/** Reads the cellar's second configuration as an autoexec of these lines. */
	const single = (lines: string[]) => (file: string) => (file === 'dosboxcellar_single.conf' ? ['[autoexec]', ...lines, ''].join('\r\n') : read(file));
	/** GOG's launcher of one game, as in two DOS games of the home library, with this block under `:game`. */
	const launcher = (game: string[]) => [
		'@echo off',
		'mount C ".."',
		'mount C "..\\cloud_saves" -t overlay',
		'c:',
		'goto launcher',
		':launcher',
		'cls',
		'ECHO 1) Night Harbour',
		'ECHO 2) Sound setup',
		'ECHO 3) Exit',
		'choice /c123 /s Which program do you want to run? [1-3]: /n',
		'if errorlevel 3 goto exit',
		'if errorlevel 2 goto setup',
		'if errorlevel 1 goto game',
		':game',
		...game,
		'goto exit',
		':setup',
		'cls',
		'call setup.bat',
		'goto launcher',
		':exit',
		'exit'
	];

	it("starts the game itself for GOG's launcher of one game", () => {
		expect(dosboxBat(cellar, files, single(launcher(['cls', 'call harbour.bat'])))).toBe('c:\r\ncall harbour.bat\r\n');
	});

	it("keeps the commands of the game's block, without cls", () => {
		expect(dosboxBat(cellar, files, single(launcher(['cd BIN', 'cls', 'HARBOUR.EXE'])))).toBe('c:\r\ncd BIN\r\nHARBOUR.EXE\r\n');
	});

	it("keeps GOG's menu of several games as it is", () => {
		const menu = [
			'c:',
			'goto launcher',
			':launcher',
			'cls',
			'ECHO 1) Night Harbour',
			'ECHO 2) Cellar Quest',
			'ECHO 3) Exit',
			'choice /c123 /s Which game do you want to run? [1-3]: /n',
			'if errorlevel 3 goto exit',
			'if errorlevel 2 goto second',
			'if errorlevel 1 goto first',
			':first',
			'cls',
			'HARBOUR.EXE',
			'exit',
			':second',
			'cls',
			'CELLAR.EXE',
			'exit',
			':exit',
			'exit'
		];
		expect(dosboxBat(cellar, files, single(['@echo off', ...menu]))?.split('\r\n')).toEqual([...menu, '']);
	});

	it('keeps a launcher it does not know', () => {
		const other = launcher(['cls', 'HARBOUR.EXE']).map((line) =>
			line === 'if errorlevel 1 goto game' ? 'if errorlevel 1 goto setup' : line === 'if errorlevel 2 goto setup' ? 'if errorlevel 2 goto game' : line
		);
		// As today: only `@echo off`, the mount of the folder itself and the overlay go.
		expect(dosboxBat(cellar, files, single(other))?.split('\r\n')).toEqual([...other.slice(3), '']);
	});

	it('keeps the launcher when a goto would be left without its label', () => {
		const other = launcher(['cls', 'HARBOUR.EXE']);
		other[other.indexOf('goto launcher')] = '@goto launcher';
		expect(dosboxBat(cellar, files, single(other))?.split('\r\n')).toEqual([...other.slice(3), '']);
	});

	it('reads option 1 from the menu itself', () => {
		const menu = [
			'c:',
			'goto launcher',
			':launcher',
			'cls',
			'ECHO 1) Sound setup',
			'ECHO 2) Exit',
			'choice /c12 /s Which program do you want to run? [1-2]: /n',
			'if errorlevel 2 goto exit',
			'if errorlevel 1 goto setup',
			':setup',
			'cls',
			'choice /c12 /s Play Night Harbour now? [1-2]: /n',
			'if errorlevel 2 goto exit',
			'if errorlevel 1 goto game',
			':game',
			'cls',
			'HARBOUR.EXE',
			'goto exit',
			':exit',
			'exit'
		];
		expect(dosboxBat(cellar, files, single(menu))?.split('\r\n')).toEqual([...menu, '']);
	});

	it('keeps the launcher when its game block holds no command', () => {
		const other = launcher(['cls']);
		expect(dosboxBat(cellar, files, single(other))?.split('\r\n')).toEqual([...other.slice(3), '']);
	});
});

const marker: Marker = { gameId: '3001', system: 'windows', files: ['setup_a.exe', 'setup_a-1.bin'], version: 'Release 3', sentAt: '2026-10-20T21:14:03Z', canvas: '0.12.0' };

describe('marker', () => {
	it('reads back the marker it writes', () => {
		expect(parseMarker(markerJson(marker))).toEqual(marker);
	});

	it('refuses a marker that is not JSON or has no game id', () => {
		expect(parseMarker('nope')).toBeNull();
		expect(parseMarker('[]')).toBeNull();
		expect(parseMarker('{"system":"dos"}')).toBeNull();
		expect(parseMarker('{"gameId":""}')).toBeNull();
	});

	it('refuses a marker with a missing or mistyped field', () => {
		const bad: Record<string, unknown> = { gameId: 5, system: 'mac', files: 'x', version: 1, sentAt: null, canvas: [] };
		for (const key of Object.keys(bad)) {
			expect(parseMarker(JSON.stringify({ ...marker, [key]: bad[key] }))).toBeNull();
			const { [key as keyof Marker]: _gone, ...rest } = marker;
			expect(parseMarker(JSON.stringify(rest))).toBeNull();
		}
		expect(parseMarker(JSON.stringify({ ...marker, files: ['a', 2] }))).toBeNull();
	});
});
