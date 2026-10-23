import { describe, expect, it } from 'vitest';
import type { JobView } from '$lib/batocera';
import type { Detail, FileEntry } from '$lib/types';
import {
	blockKind,
	buttonForTab,
	buttonSystems,
	buttonTarget,
	dlcFor,
	discouraged,
	firstTab,
	goesToBatocera,
	isPrimary,
	justSent,
	macNote,
	missingFor,
	notePlace,
	partLabel,
	runFile,
	sharedVersion,
	systemsOf,
	theoShown,
	totalBytes,
	visibleFiles,
	type MacNote
} from './plan';

const GB = 1024 ** 3;

function file(over: Partial<FileEntry> = {}): FileEntry {
	return {
		fileId: 'f0',
		name: 'Game',
		filename: 'setup_game.exe',
		version: '1.0',
		sizeText: '1 GB',
		sizeBytes: GB,
		run: false,
		...over
	};
}

function detail(over: Partial<Detail> = {}): Detail {
	return {
		id: '1',
		title: 'Game',
		kind: 'game',
		os: ['windows'],
		genres: [],
		tags: [],
		developers: [],
		publisher: '',
		multiplayer: false,
		coop: false,
		poster: null,
		banner: null,
		order: 0,
		complete: true,
		hasFiles: true,
		description: '',
		languages: [],
		features: [],
		screenshots: [],
		backdrop: null,
		releaseYear: null,
		macNotice: null,
		dos: false,
		requirements: {},
		storeUrl: null,
		rating: null,
		downloads: { windows: [file({ run: true })] },
		downloadLanguage: null,
		dlc: [],
		extraKinds: [],
		extras: [],
		requires: null,
		collection: null,
		series: null,
		packs: [],
		adult: false,
		...over
	};
}

describe('blockKind', () => {
	it('says that the game exists for the visitor', () => {
		expect(blockKind(detail(), 'windows')).toBe('mine');
	});

	it('says that it does not', () => {
		expect(blockKind(detail(), 'macos')).toBe('not-mine');
	});

	it('tells a phone and an unknown system apart, even when the game has every system', () => {
		const all = detail({ downloads: { windows: [file()], macos: [file()], linux: [file()] } });
		expect(blockKind(all, 'phone')).toBe('phone');
		expect(blockKind(all, 'other')).toBe('other');
	});

	it('says that a record could not be read before anything else', () => {
		expect(blockKind(detail({ complete: false, hasFiles: false, downloads: {} }), 'windows')).toBe('unread');
	});

	it('says that the files are missing', () => {
		expect(blockKind(detail({ hasFiles: false, downloads: {} }), 'windows')).toBe('no-files');
		// The flag and the lists disagree: nothing to offer either way.
		expect(blockKind(detail({ hasFiles: true, downloads: {} }), 'windows')).toBe('no-files');
		expect(blockKind(detail({ hasFiles: true, downloads: { windows: [] } }), 'phone')).toBe('no-files');
	});

	it('does not take a game for the visitor\'s when its only files for the visitor are DLC', () => {
		const dlcOnly = detail({
			downloads: { windows: [file()] },
			dlc: [{ title: 'Extra', downloads: { linux: [file()] } }]
		});
		expect(blockKind(dlcOnly, 'linux')).toBe('not-mine');
	});

	it('says that only DLC has files, for every visitor but a phone', () => {
		const onlyDlc = detail({ downloads: {}, dlc: [{ title: 'Extra', downloads: { windows: [file()] } }] });
		for (const visitor of ['windows', 'macos', 'other'] as const) {
			expect(blockKind(onlyDlc, visitor)).toBe('dlc-only');
			expect(buttonTarget(onlyDlc, visitor)).toBeNull();
		}
		expect(blockKind(onlyDlc, 'phone')).toBe('phone');
	});
});

describe('systemsOf and firstTab', () => {
	const game = detail({
		downloads: { linux: [file()], windows: [file()] },
		dlc: [{ title: 'Extra', downloads: { macos: [file()] } }]
	});

	it('lists the systems in the fixed order, DLC-only systems included', () => {
		expect(systemsOf(game)).toEqual(['windows', 'macos', 'linux']);
	});

	it('opens on the preferred system when the main button starts on it, else as without one', () => {
		const both = detail({ downloads: { windows: [file()], linux: [file()] } });
		expect(firstTab(both, 'windows', 'linux')).toBe('linux');
		expect(firstTab(both, 'other', 'linux')).toBe('linux');
		// The button does not start on a system the game has DLC files for only, nor does the tab.
		expect(firstTab(game, 'windows', 'macos')).toBe('windows');
		// Batocera has no tab; a phone has no button.
		expect(firstTab(both, 'linux', 'batocera')).toBe('linux');
		expect(firstTab(both, 'phone', 'linux')).toBe('windows');
		expect(firstTab(both, 'linux', 'auto')).toBe('linux');
	});

	it('opens on Windows while the main button is on Batocera, which sends the Windows files', () => {
		const both = detail({ downloads: { windows: [file()], macos: [file()] } });
		expect(firstTab(both, 'macos', 'batocera', true)).toBe('windows');
		expect(firstTab(both, 'macos', 'auto', true)).toBe('windows');
		expect(firstTab(both, 'macos', 'batocera', false)).toBe('macos');
	});

	it('opens on the visitor’s system when the game has it, otherwise on the first', () => {
		expect(firstTab(game, 'linux')).toBe('linux');
		expect(firstTab(detail(), 'macos')).toBe('windows');
		expect(firstTab(game, 'phone')).toBe('windows');
		expect(firstTab(detail({ downloads: {} }), 'windows')).toBeNull();
	});
});

describe('buttonSystems and buttonTarget', () => {
	const game = detail({
		downloads: { linux: [file()], windows: [file()] },
		dlc: [{ title: 'Extra', downloads: { macos: [file()] } }]
	});

	it('offers the systems the game itself has files for, in the fixed order', () => {
		expect(buttonSystems(game)).toEqual(['windows', 'linux']);
		expect(buttonSystems(detail({ downloads: { windows: [] } }))).toEqual([]);
	});

	it('starts on the visitor\'s system when the game has it', () => {
		expect(buttonTarget(game, 'linux')).toBe('linux');
		expect(buttonTarget(game, 'windows')).toBe('windows');
	});

	it('starts on the first system the game has for a visitor whose own it does not have', () => {
		// macOS has a DLC only: the button downloads the game.
		expect(buttonTarget(game, 'macos')).toBe('windows');
		expect(buttonTarget(game, 'other')).toBe('windows');
		expect(buttonTarget(detail({ downloads: { linux: [file()] } }), 'windows')).toBe('linux');
	});

	it('follows the switch, as long as the game has the picked system', () => {
		expect(buttonTarget(game, 'windows', 'linux')).toBe('linux');
		expect(buttonTarget(game, 'macos', 'linux')).toBe('linux');
		expect(buttonTarget(game, 'linux', 'macos')).toBe('linux');
	});

	it('has no button on a phone, for a record that could not be read, and without files', () => {
		expect(buttonTarget(game, 'phone')).toBeNull();
		expect(buttonTarget(game, 'phone', 'windows')).toBeNull();
		expect(buttonTarget(detail({ complete: false, hasFiles: false, downloads: {} }), 'windows')).toBeNull();
		expect(buttonTarget(detail({ hasFiles: false, downloads: {} }), 'windows')).toBeNull();
		// Only a DLC has files: nothing for the button to download.
		const dlcOnly = detail({ downloads: {}, dlc: [{ title: 'Extra', downloads: { windows: [file()] } }] });
		expect(buttonTarget(dlcOnly, 'windows')).toBeNull();
	});
});

describe('the small helpers', () => {
	it('adds up sizes, taking a size that is not a number as nothing', () => {
		expect(totalBytes([file(), file({ sizeBytes: 2 * GB })])).toBe(3 * GB);
		expect(totalBytes([file(), file({ sizeBytes: Number.NaN })])).toBe(GB);
		expect(totalBytes([])).toBe(0);
	});

	it('names the file to open: the marked one, or the first', () => {
		const files = [file({ fileId: 'a' }), file({ fileId: 'b', run: true })];
		expect(runFile(files)?.fileId).toBe('b');
		expect(runFile([file({ fileId: 'a' })])?.fileId).toBe('a');
		expect(runFile([])).toBeNull();
	});

	it('shortens the name of a part, only in a list of parts', () => {
		const part = file({ name: 'The Long Dark Road (Part 2 of 3)' });
		expect(partLabel(part, true)).toBe('Part 2 of 3');
		expect(partLabel(part, false)).toBe('The Long Dark Road (Part 2 of 3)');
		expect(partLabel(file({ name: 'Patch 2.0 to 2.1' }), true)).toBe('Patch 2.0 to 2.1');
		expect(partLabel(file({ name: '' }), true)).toBe('');
	});

	it('gives the version only when all files share one', () => {
		expect(sharedVersion([file(), file()])).toBe('1.0');
		expect(sharedVersion([file(), file({ version: '1.1' })])).toBeNull();
		expect(sharedVersion([file({ version: '' })])).toBeNull();
		expect(sharedVersion([])).toBeNull();
	});

	it('shows up to eight files, and five of more until asked', () => {
		const many = (n: number) => Array.from({ length: n }, (_, i) => file({ fileId: `f${i}` }));
		expect(visibleFiles(many(8), false)).toHaveLength(8);
		expect(visibleFiles(many(9), false)).toHaveLength(5);
		expect(visibleFiles(many(30), true)).toHaveLength(30);
		expect(visibleFiles([], false)).toEqual([]);
	});

	it('lists the DLC that has files for a system', () => {
		const game = detail({
			dlc: [
				{ title: 'With files', downloads: { windows: [file()] } },
				{ title: 'Mac only', downloads: { macos: [file()] } },
				{ title: 'Listed, no files', downloads: {} }
			]
		});
		expect(dlcFor(game, 'windows').map((d) => d.title)).toEqual(['With files']);
		expect(dlcFor(game, 'linux')).toEqual([]);
	});
});

describe('macNote', () => {
	const NOTICE = 'The game is 32-bit only and will not work on macOS 10.15 and up.';
	const mac = file({ fileId: 'm0', filename: 'game.pkg', run: true });
	const both = { windows: [file({ run: true })], macos: [mac] };

	it('gives the words of GOG when GOG has a notice and the archive a macOS file', () => {
		const d = detail({ os: ['windows', 'macos'], macNotice: NOTICE, downloads: both });
		expect(macNote(d)).toEqual({ kind: 'gog', text: NOTICE });
	});

	it('gives the words of GOG also when GOG does not list the game for macOS', () => {
		expect(macNote(detail({ os: ['windows'], macNotice: NOTICE, downloads: both }))).toEqual({ kind: 'gog', text: NOTICE });
	});

	it('says that the game is not listed when GOG has no notice and the archive a macOS file', () => {
		expect(macNote(detail({ os: ['windows', 'linux'], downloads: both }))).toEqual({ kind: 'unlisted' });
	});

	it('gives nothing when no system is listed at all and GOG has no notice', () => {
		expect(macNote(detail({ os: [], downloads: both }))).toBeNull();
		expect(macNote(detail({ os: [], macNotice: NOTICE, downloads: both }))).toEqual({ kind: 'gog', text: NOTICE });
	});

	it('gives nothing when the game is listed for macOS and GOG has no notice', () => {
		expect(macNote(detail({ os: ['windows', 'macos'], downloads: both }))).toBeNull();
	});

	it('gives nothing when the game has no macOS file of its own', () => {
		expect(macNote(detail({ macNotice: NOTICE }))).toBeNull();
		expect(macNote(detail({ macNotice: NOTICE, downloads: { windows: [file()], macos: [] } }))).toBeNull();
		// Only a DLC has one.
		expect(macNote(detail({ macNotice: NOTICE, dlc: [{ title: 'Expansion', downloads: { macos: [mac] } }] }))).toBeNull();
		// And none at all.
		expect(macNote(detail({ macNotice: NOTICE, downloads: {}, hasFiles: false }))).toBeNull();
	});
});

describe('notePlace', () => {
	const gog: MacNote = { kind: 'gog', text: 'x' };
	const unlisted: MacNote = { kind: 'unlisted' };

	it.each([
		// The button is on macOS: under the button, whatever the tab.
		[gog, 'macos', 'macos', 'button'],
		[gog, 'macos', 'windows', 'button'],
		[unlisted, 'macos', 'macos', 'button'],
		// The button is elsewhere, or there is none (a phone): with the macOS files.
		[gog, 'windows', 'macos', 'list'],
		[gog, null, 'macos', 'list'],
		[unlisted, 'linux', 'macos', 'list'],
		// Neither the button nor the list is on macOS.
		[gog, 'windows', 'windows', null],
		[gog, null, 'linux', null],
		[gog, null, null, null],
		// Nothing to say.
		[null, 'macos', 'macos', null]
	] as const)('%j with the button on %s and the tab on %s: %s', (note, target, tab, place) => {
		expect(notePlace(note, target, tab)).toBe(place);
	});
});

describe('discouraged', () => {
	it('is true only while the button is on macOS and GOG itself says it will not work', () => {
		expect(discouraged({ kind: 'gog', text: 'x' }, 'macos')).toBe(true);
		expect(discouraged({ kind: 'gog', text: 'x' }, 'windows')).toBe(false);
		expect(discouraged({ kind: 'gog', text: 'x' }, null)).toBe(false);
		expect(discouraged({ kind: 'unlisted' }, 'macos')).toBe(false);
		expect(discouraged(null, 'macos')).toBe(false);
	});
});

describe('buttonForTab', () => {
	it('turns the button to the system of a tab the game has files for', () => {
		const d = detail({ os: ['windows', 'linux'], downloads: { windows: [file()], linux: [file()] } });
		expect(buttonForTab(d, 'linux')).toBe('linux');
		expect(buttonForTab(d, 'windows')).toBe('windows');
	});

	it('leaves the button where it is for a tab that only a DLC has files for', () => {
		const d = detail({ downloads: { windows: [file()] }, dlc: [{ title: 'Expansion', downloads: { macos: [file()] } }] });
		expect(buttonForTab(d, 'macos')).toBeNull();
	});
});

describe('isPrimary', () => {
	const gog: MacNote = { kind: 'gog', text: 'Will not work.' };

	it('is yellow for the visitor\'s own system, before it was pressed', () => {
		expect(isPrimary('mine', 'windows', 'windows', false, null)).toBe(true);
	});

	it('is quiet for any other system, once pressed, and without a button', () => {
		expect(isPrimary('mine', 'windows', 'linux', false, null)).toBe(false);
		expect(isPrimary('mine', 'windows', 'windows', true, null)).toBe(false);
		expect(isPrimary('mine', 'windows', null, false, null)).toBe(false);
		expect(isPrimary('not-mine', 'macos', 'windows', false, null)).toBe(false);
		expect(isPrimary('other', 'other', 'windows', false, null)).toBe(false);
	});

	it('is quiet on macOS where GOG says the installer will not work, also on a Mac', () => {
		expect(isPrimary('mine', 'macos', 'macos', false, gog)).toBe(false);
		expect(isPrimary('mine', 'macos', 'macos', false, { kind: 'unlisted' })).toBe(true);
	});
});

describe('theoShown', () => {
	it('shows the theo panel for a game with files at a computer, in English, while switched on', () => {
		for (const kind of ['mine', 'not-mine', 'other'] as const) {
			expect(theoShown(true, kind, null)).toBe(true);
			expect(theoShown(false, kind, null)).toBe(false);
		}
		for (const kind of ['phone', 'unread', 'no-files', 'dlc-only'] as const) {
			expect(theoShown(true, kind, null)).toBe(false);
		}
		expect(theoShown(true, 'mine', 'Deutsch')).toBe(false);
	});
});

describe('where the main button starts, with Batocera and the preferred platform', () => {
	const both = detail({ os: ['windows', 'macos'], downloads: { windows: [file()], macos: [file()] } });

	it('starts on Batocera on a phone once it is set up', () => {
		expect(buttonTarget(both, 'phone', null, 'auto', true)).toBe('batocera');
		expect(buttonTarget(both, 'phone', null, 'auto', false)).toBeNull();
		expect(buttonTarget(both, 'phone', null, 'windows', false)).toBeNull();
	});

	it('starts on the preferred platform when the game has it', () => {
		expect(buttonTarget(both, 'macos', null, 'windows', false)).toBe('windows');
		// No Linux files: the visitor's own system, as without a preferred platform.
		expect(buttonTarget(both, 'macos', null, 'linux', false)).toBe('macos');
		expect(buttonTarget(both, 'macos', null, 'batocera', true)).toBe('batocera');
		// Batocera not set up, or the game cannot go: as Autoselect.
		expect(buttonTarget(both, 'macos', null, 'batocera', false)).toBe('macos');
		expect(buttonTarget(both, 'macos', null, 'auto', true)).toBe('macos');
	});

	it('starts a marked game as with Autoselect, and lets an unlocked browser pick Batocera', () => {
		expect(buttonTarget(both, 'macos', null, 'batocera', true, true)).toBe('macos');
		expect(buttonTarget(both, 'macos', 'batocera', 'batocera', true, true)).toBe('batocera');
		// A phone has no choice: the button disabled, as section 7.6 says.
		expect(buttonTarget(both, 'phone', null, 'auto', true, true)).toBe('batocera');
	});

	it('a pick wins over the preferred platform', () => {
		expect(buttonTarget(both, 'macos', 'macos', 'batocera', true)).toBe('macos');
		expect(buttonTarget(both, 'macos', 'batocera', 'windows', true)).toBe('batocera');
		// Batocera cannot be picked where it cannot go.
		expect(buttonTarget(both, 'macos', 'batocera', 'windows', false)).toBe('windows');
	});

	it('takes a game to Batocera when it has Windows files of its own', () => {
		expect(goesToBatocera(both)).toBe(true);
		expect(goesToBatocera(detail({ downloads: { macos: [file()] } }))).toBe(false);
		expect(goesToBatocera(detail({ downloads: {}, dlc: [{ title: 'Extra', downloads: { windows: [file()] } }] }))).toBe(false);
		expect(goesToBatocera(detail({ complete: false }))).toBe(false);
		expect(goesToBatocera(detail({ kind: 'orphaned-dlc' }))).toBe(false);
	});
});

describe('missingFor, the platform the note "Not available for" names', () => {
	const windows = detail();
	const mac = detail({ os: ['macos'], downloads: { macos: [file()] } });
	const macAndLinux = detail({ os: ['macos', 'linux'], downloads: { macos: [file()], linux: [file()] } });

	it('names the visitor\'s own system with Autoselect when the game does not have it', () => {
		expect(missingFor(windows, 'macos', 'auto', false, false)).toBe('macos');
		expect(missingFor(mac, 'macos', 'auto', false, false)).toBeNull();
	});

	it('names the preferred system when the game does not have it, whatever the visitor sits at', () => {
		expect(missingFor(windows, 'macos', 'windows', false, false)).toBeNull();
		expect(missingFor(macAndLinux, 'macos', 'windows', false, false)).toBe('windows');
		expect(missingFor(macAndLinux, 'other', 'windows', true, false)).toBe('windows');
	});

	it('names Batocera, once it is set up, when the game has no Windows version', () => {
		expect(missingFor(windows, 'macos', 'batocera', true, false)).toBeNull();
		expect(missingFor(mac, 'macos', 'batocera', true, false)).toBe('batocera');
		// A marked game has a Windows version: the menu row says that it does not run there.
		expect(missingFor(windows, 'macos', 'batocera', true, true)).toBeNull();
	});

	it('takes Batocera that is not set up for Autoselect', () => {
		expect(missingFor(windows, 'macos', 'batocera', false, false)).toBe('macos');
		expect(missingFor(mac, 'macos', 'batocera', false, false)).toBeNull();
	});

	it('asks a system Canvas cannot name to choose, with Autoselect', () => {
		expect(missingFor(windows, 'other', 'auto', false, false)).toBe('other');
	});

	it('names nothing where the block has a note of its own', () => {
		for (const preferred of ['auto', 'windows', 'batocera'] as const) {
			expect(missingFor(mac, 'phone', preferred, true, false)).toBeNull();
			expect(missingFor(detail({ complete: false, hasFiles: false, downloads: {} }), 'macos', preferred, true, false)).toBeNull();
			expect(missingFor(detail({ hasFiles: false, downloads: {} }), 'macos', preferred, true, false)).toBeNull();
			const onlyDlc = detail({ downloads: {}, dlc: [{ title: 'Extra', downloads: { linux: [file()] } }] });
			expect(missingFor(onlyDlc, 'macos', preferred, true, false)).toBeNull();
		}
	});
});

function job(over: Partial<JobView> = {}): JobView {
	return {
		id: 'job-1',
		state: 'running',
		ahead: 0,
		step: 'copy',
		stepNumber: 1,
		steps: 3,
		overall: 0.42,
		bytesDone: 8.4 * GB,
		bytesAll: 20 * GB,
		minutesLeft: 11,
		waking: 'no',
		waitingForBox: false,
		reason: null,
		endedAt: null,
		listLater: false,
		...over
	};
}

describe('justSent', () => {
	it('is true for ten minutes after a send ended', () => {
		const now = Date.parse('2026-10-20T21:20:00Z');
		expect(justSent(job({ state: 'done', endedAt: '2026-10-20T21:14:03Z' }), now)).toBe(true);
		expect(justSent(job({ state: 'done', endedAt: '2026-10-20T21:09:59Z' }), now)).toBe(false);
		expect(justSent(job({ state: 'failed', endedAt: '2026-10-20T21:19:00Z' }), now)).toBe(false);
		expect(justSent(job({ state: 'running' }), now)).toBe(false);
		expect(justSent(null, now)).toBe(false);
	});
});
