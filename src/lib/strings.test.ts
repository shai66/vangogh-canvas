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
		expect(t.download.downloadPart('Part 1 of 4', '11.6 GB')).toBe('Download Part 1 of 4, 11.6 GB');
		expect(t.download.downloadPart('Patch 2.0 to 2.1', '')).toBe('Download Patch 2.0 to 2.1');
		expect(t.filters.show(1)).toBe('Show 1 game');
		expect(t.filters.show(0)).toBe('Show 0 games');
	});

	it('write the facts of the Server tab in the singular and the plural', () => {
		const facts = t.settings.facts;
		expect(facts.games(136, 24)).toBe('136 games, 24 collections');
		expect(facts.games(1, 1)).toBe('1 game, 1 collection');
		expect(facts.jobs(0)).toBe('no send running');
		expect(facts.jobs(1)).toBe('1 send waiting or running');
		expect(facts.jobs(2)).toBe('2 sends waiting or running');
		expect(facts.read('today at 11:04', '04:30')).toBe('read today at 11:04, next at 04:30');
		expect(facts.read('30 September', '04:30')).toBe('read 30 September, next at 04:30');
		expect(t.settings.zoneNow(true, 'UTC+2')).toBe('It follows summer time: now UTC+2.');
		expect(t.settings.zoneNow(false, 'UTC+5:30')).toBe('Now UTC+5:30.');
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
		expect(t.download.notForTitle('batocera')).toBe('Not available for Batocera.');
		expect(t.download.notForBatoceraText).toBe('This game has no Windows version. The files are listed below.');
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

	it('name the menu of the switch with Batocera in it', () => {
		expect(t.download.anotherOrBatocera).toBe('Other systems and Batocera');
	});

	it('say why a send to Batocera stopped', () => {
		const GB = 1024 ** 3;
		const reasons: [Parameters<typeof t.batocera.reason>[0], string][] = [
			[{ code: 'box-down' }, 'Batocera does not answer. Turn it on, then send again.'],
			[{ code: 'box-room', free: 3.1 * GB, need: 45 * GB }, 'Batocera has 3.1 GB free, and the send needs 45 GB while it unpacks.'],
			[{ code: 'fetch' }, 'The installer could not be fetched from vangogh.'],
			[{ code: 'checksum' }, 'A file from vangogh was damaged on the way.'],
			[{ code: 'unpack' }, 'This installer could not be unpacked.'],
			[{ code: 'unrar' }, "This installer needs RAR support, which Batocera's innoextract does not have."],
			[{ code: 'copy' }, 'The copy to Batocera broke off.'],
			[
				{ code: 'in-the-way', path: '/userdata/roms/windows/Night Harbour.pc.part' },
				'A folder is in the way on Batocera: /userdata/roms/windows/Night Harbour.pc.part. Remove it there, then send again.'
			],
			[{ code: 'key-changed' }, "Batocera's key has changed. If it was reinstalled, test the connection again in settings."],
			[{ code: 'login' }, 'Batocera refused the login. Test the connection again in settings.']
		];
		for (const [reason, text] of reasons) expect(t.batocera.reason(reason)).toBe(text);
	});

	it('word a failed send in two sentences, by reason, and in full for its "i"', () => {
		const GB = 1024 ** 3;
		const nothing = 'Nothing was left on the box.';
		const older = 'The older version stays.';
		// The reason, its bold sentence, and its plain one: null where it says what is left on the box.
		const notes: [Parameters<typeof t.batocera.failedNote>[0], string, string | null][] = [
			[{ code: 'box-down' }, 'Batocera does not answer.', 'Turn it on, then send again.'],
			[{ code: 'box-room', free: 3.1 * GB, need: 45 * GB }, 'Batocera has no room to unpack it.', '3.1 GB free, 45 GB needed.'],
			[{ code: 'fetch' }, 'The installer could not be fetched from vangogh.', null],
			[{ code: 'checksum' }, 'A file from vangogh was damaged on the way.', null],
			[{ code: 'unpack' }, 'This installer could not be unpacked.', null],
			[{ code: 'unrar' }, 'This installer needs RAR support.', null],
			[{ code: 'copy' }, 'The copy to Batocera broke off.', null],
			[{ code: 'in-the-way', path: '/userdata/roms/windows/Night Harbour.pc.part' }, 'A folder is in the way on Batocera.', 'Remove it there, then send again.'],
			[{ code: 'key-changed' }, "Batocera's key has changed.", 'Test the connection again in settings.'],
			[{ code: 'login' }, 'Batocera refused the login.', 'Test the connection again in settings.'],
			[null, 'The reason is not known.', null]
		];
		for (const [reason, bold, plain] of notes) {
			expect(t.batocera.failedNote(reason, false)).toEqual({ bold, plain: plain ?? nothing });
			expect(t.batocera.failedNote(reason, true)).toEqual({ bold, plain: plain ?? older });
		}
		expect(t.batocera.failedInfo({ code: 'in-the-way', path: '/userdata/roms/windows/Night Harbour.pc.part' }, false)).toBe(
			'A folder is in the way on Batocera: /userdata/roms/windows/Night Harbour.pc.part. Remove it there, then send again. Nothing was left on the box.'
		);
		expect(t.batocera.failedInfo(null, true)).toBe('The reason is not known. The older version stays.');
	});

	it('word the line', () => {
		expect(t.batocera.step('copy', 1)).toBe('Copying to Batocera, 1 of 3');
		expect(t.batocera.waitingStep(1)).toBe('Waiting for Batocera, 1 of 3');
		expect(t.batocera.sentDay(null)).toBe('Sent by Canvas.');
		expect(t.batocera.sentDay('30 September')).toBe('Sent on 30 September.');
	});

	it("word a send's numbers in the line, and as the bar's value text", () => {
		expect(t.batocera.numbers(55, 11)).toBe('55 % · about 11 minutes left');
		expect(t.batocera.numbers(99, null)).toBe('99 %');
		expect(t.batocera.barText(55, 11)).toBe('55 %, about 11 minutes left');
		expect(t.batocera.barText(12, null)).toBe('12 %');
	});

	it('count the games ahead, the minutes left and the clock of the countdown', () => {
		expect(t.batocera.ahead(1)).toBe('One other game is being sent first.');
		expect(t.batocera.ahead(3)).toBe('3 other games are being sent first.');
		expect(t.batocera.minutesLeft(1)).toBe('about 1 minute left');
		expect(t.batocera.minutesLeft(11)).toBe('about 11 minutes left');
		expect(t.batocera.clock(581)).toBe('9:41');
		expect(t.batocera.clock(4)).toBe('0:04');
	});

	it('say in the connection test that SSH did not start', () => {
		expect(t.settings.batoceraCheck.noSsh).toBe('Batocera answers, but its SSH did not start within 20 seconds.');
	});

	it('say in the connection test that the box has no innoextract', () => {
		expect(t.settings.batoceraCheck.noInnoextract).toBe('Batocera has no innoextract, which unpacking a game needs.');
	});

	it('say that Batocera unpacks the installers Canvas copies to it', () => {
		expect(t.batocera.notThere).toBe('Canvas copies the installers to Batocera, which unpacks them.');
		expect(t.settings.batoceraText).toBe(
			"Adds Batocera to a game's download menu once the connection test below has passed. Canvas copies the game's Windows installers to the box, which unpacks them; a DOS game goes to Batocera's DOS system."
		);
	});

	it('say that Play is starting on the TV, and hint at the settings in Batocera after a send', () => {
		expect(t.batocera.starting).toBe('Starting…');
		const hint = 'Some games need extra settings in Batocera before they run well, such as the controls.';
		expect(t.batocera.inList('windows')).toBe(`It is in Batocera's list, under Windows. ${hint}`);
		expect(t.batocera.inList('dos')).toBe(`It is in Batocera's list, under DOS. ${hint}`);
		expect(t.batocera.listLater).toBe(`It shows in Batocera's list once the game on the TV is closed. ${hint}`);
	});

	it('say that the game did not start on the TV', () => {
		expect(t.batocera.notStartedTitle).toBe('The game did not start on the TV.');
		expect(t.batocera.notStartedPlain).toBe('Press Play again.');
	});
});
