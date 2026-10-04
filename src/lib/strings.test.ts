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

	it('write the head of the library at a glance, the numbers in bold', () => {
		const text = (parts: { plain: string; bold: string }[]) => parts.map((p) => p.plain + p.bold).join('');
		expect(text(t.glance.head(135, 22, '4 October, 04:30'))).toBe('135 games, 22 collections · as of 4 October, 04:30');
		expect(text(t.glance.head(1, 1, null))).toBe('1 game, 1 collection');
		expect(text(t.glance.head(4, 0, '4 October, 04:30'))).toBe('4 games · as of 4 October, 04:30');
		expect(t.glance.head(135, 22, null).map((p) => p.bold).filter(Boolean)).toEqual(['135 games', '22']);
		expect(t.glanceTitle).toBe('Library at a glance | Canvas for vangogh');
	});

	it('write the panels of the library at a glance', () => {
		expect(t.glance.decadesNote(0)).toBe('of their first release');
		expect(t.glance.decadesNote(5)).toBe('of their first release, 5 without a year');
		expect(t.glance.decade(1990)).toBe('1990s');
		expect(t.glance.genresNote(6)).toBe('the 6 most common');
		expect(t.glance.genresNote(1)).toBe('the most common');
		expect(t.glance.sizeRow('Linux', '71.8 GB')).toBe('Linux: installers and DLC, 71.8 GB');
		expect(t.glance.extrasRow('40.8 GB')).toBe('Extras: manuals, soundtracks, artwork and the rest, 40.8 GB');
		expect(t.glance.systemRow(30, 135, 'Linux')).toBe('30 of 135 games for Linux');
		expect(t.glance.decadeRow(1, 1980)).toBe('1 game from the 1980s');
		expect(t.glance.genreRow(48, 135, 'Action')).toBe('48 of 135 games: Action');
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
