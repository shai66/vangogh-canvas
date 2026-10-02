import { describe, expect, it } from 'vitest';
import { t } from './strings';

describe('the strings', () => {
	it('name the kinds of extras, and count them', () => {
		expect(t.extras.kind('manuals')).toBe('Manual');
		expect(t.extras.kind('Game Add-ons')).toBe('Add-on');
		expect(t.extras.kind('comic book')).toBe('Comic book');
		expect(t.extras.kind('constructor')).toBe('Constructor');
		expect(t.extras.kind('')).toBe('Extra');
		expect(t.extras.kinds([['manuals', 5], ['audio', 1]])).toBe('Manual (5), Audio');
		expect(t.extras.count(1)).toBe('1 extra');
		expect(t.extras.count(24)).toBe('24 extras');
		expect(t.extras.pill('Manual, Audio')).toBe('Extras: Manual, Audio');
	});

	it('count games and files in the singular and the plural', () => {
		expect(t.count.games(1)).toBe('game');
		expect(t.count.games(118)).toBe('games');
		expect(t.count.ofTotal(118)).toBe('of 118 games');
		expect(t.download.summary(1, '1.8 GB')).toBe('1 file, 1.8 GB');
		expect(t.download.summary(5, '38 GB')).toBe('5 files, 38 GB');
		expect(t.filters.show(1)).toBe('Show 1 game');
		expect(t.filters.show(0)).toBe('Show 0 games');
	});

	it('name the systems a game exists for', () => {
		expect(t.download.notForText(['windows'])).toBe('This game exists for Windows. The files are listed below.');
		expect(t.download.notForText(['windows', 'linux'])).toBe(
			'This game exists for Windows and Linux. The files are listed below.'
		);
		expect(t.download.notForText(['windows', 'macos', 'linux'])).toBe(
			'This game exists for Windows, macOS and Linux. The files are listed below.'
		);
	});

	it('name the rows of system requirements, and keep GOG\'s label for a row they do not know', () => {
		expect(t.requirements.row('memory', 'RAM')).toBe('Memory');
		expect(t.requirements.row('vr', 'VR headset')).toBe('VR headset');
		expect(t.requirements.row('constructor', 'Constructor')).toBe('Constructor');
		expect(t.requirements.none('linux')).toBe('GOG lists none for Linux.');
	});

	it('say what is not available, or ask an unknown system to choose', () => {
		expect(t.download.notForTitle('macos')).toBe('Not available for macOS.');
		expect(t.download.notForTitle('other')).toBe('Choose the files for your system.');
	});

	it('name the base game of a DLC when it is known', () => {
		expect(t.detail.orphan('Starhaven')).toBe('This is DLC. It needs Starhaven, which is not in the library.');
		expect(t.detail.orphan(null)).toBe('This is DLC. Its base game is not in the library.');
	});

	it('word the start of one download and of several', () => {
		expect(t.download.started(1)).toBe('The download has started.');
		expect(t.download.started(9)).toBe('9 downloads have started.');
	});

	it('word the note about an old macOS installer', () => {
		expect(t.download.macNoticeBy).toBe('GOG says:');
		expect(t.download.macUnlisted).toBe('GOG does not list this game for macOS. The installer may not work on a current Mac.');
		expect(t.download.hasNotice).toBe('There is a notice about this installer');
	});
});
