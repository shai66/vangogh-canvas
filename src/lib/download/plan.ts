import type { JobView } from '$lib/batocera';
import type { Preferred } from '$lib/settings';
import { ALL_OS, type Detail, type FileEntry, type Os } from '$lib/types';
import type { Visitor } from '$lib/visitor';

/**
 * What the download block shows at its top.
 *   unread     the record of the game could not be read
 *   no-files   GOG offers installers, the archive holds none
 *   mine       the game exists for the visitor's system: the main button
 *   not-mine   it exists, but not for the visitor's system: a note, and the
 *              button in the quiet style for a system the game has
 *   dlc-only   the game has no file of its own, only DLC has: a note, no button
 *   phone      a phone or tablet: no main button
 *   other      a system Canvas cannot name: as not-mine
 */
export type BlockKind = 'unread' | 'no-files' | 'dlc-only' | 'mine' | 'not-mine' | 'phone' | 'other';

/** The systems the detail has any file for, the game's own or a DLC's. */
export function systemsOf(detail: Detail): Os[] {
	return ALL_OS.filter(
		(os) =>
			(detail.downloads[os]?.length ?? 0) > 0 ||
			detail.dlc.some((d) => (d.downloads[os]?.length ?? 0) > 0)
	);
}

export function blockKind(detail: Detail, visitor: Visitor): BlockKind {
	if (!detail.complete) return 'unread';
	if (!detail.hasFiles || systemsOf(detail).length === 0) return 'no-files';
	if (visitor === 'phone') return visitor;
	if (buttonSystems(detail).length === 0) return 'dlc-only';
	if (visitor === 'other') return visitor;
	return (detail.downloads[visitor]?.length ?? 0) > 0 ? 'mine' : 'not-mine';
}

/**
 * True while the panel "Install with theo" shows (0.11.0, spec 6.1): theo is switched on, the game has files of
 * its own, the visitor is at a computer, and the archive holds the game in English. theo asks for the English
 * files unless it is told a language, and Canvas knows the language's name, not theo's code for it.
 */
export function theoShown(theo: boolean, kind: BlockKind, downloadLanguage: string | null): boolean {
	return theo && (kind === 'mine' || kind === 'not-mine' || kind === 'other') && downloadLanguage === null;
}

/**
 * The tab the file list opens on: Windows while the main button is on Batocera, which sends the Windows
 * files (2026-10-22); the preferred system when the main button starts on it (button and tab start
 * together); else the visitor's system when the game has it, else the first.
 */
export function firstTab(detail: Detail, visitor: Visitor, preferred: Preferred = 'auto', onBatocera = false): Os | null {
	const systems = systemsOf(detail);
	if (onBatocera && systems.includes('windows')) return 'windows';
	const starts = visitor !== 'phone' && preferred !== 'auto' && preferred !== 'batocera' && buttonSystems(detail).includes(preferred);
	if (starts) return preferred;
	return systems.find((os) => os === visitor) ?? systems[0] ?? null;
}

/** The systems the main button can download for: those the game itself has files for. */
export function buttonSystems(detail: Detail): Os[] {
	return ALL_OS.filter((os) => (detail.downloads[os]?.length ?? 0) > 0);
}

/** What the main button is for: a system's files, or Batocera (0.12.0). */
export type Target = Os | 'batocera';

/**
 * Where the main button is, or null when there is no button (spec 0.12.0, section 7.2). On a phone or a
 * tablet it is Batocera's while `batocera` is true, and there is none otherwise. On a computer it is the
 * pick of the switch or of a tab, else the preferred platform of the settings when the game has it, else
 * the visitor's own system when the game has it, else the first the game has. `batocera` is true while
 * Batocera is set up and the game can go to it for this browser. A game marked "Doesn't run on Batocera"
 * never starts on it, though an unlocked browser can pick it (section 7.6). Nothing remembers the pick: a
 * detail that is opened again starts from here.
 */
export function buttonTarget(
	detail: Detail,
	visitor: Visitor,
	picked: Target | null = null,
	preferred: Preferred = 'auto',
	batocera = false,
	marked = false
): Target | null {
	const kind = blockKind(detail, visitor);
	if (kind === 'phone') return batocera ? 'batocera' : null;
	if (kind === 'unread' || kind === 'no-files' || kind === 'dlc-only') return null;
	const offered = buttonSystems(detail);
	const has = (target: Target) => (target === 'batocera' ? batocera : offered.includes(target));
	if (picked && has(picked)) return picked;
	if (preferred !== 'auto' && has(preferred) && !(preferred === 'batocera' && marked)) return preferred;
	return offered.find((os) => os === visitor) ?? offered[0] ?? null;
}

/**
 * True when the game can go to Batocera, apart from the mark and the settings (spec 0.12.0, section 2.1):
 * a complete game with Windows files of its own, as the server's `canGo` has it.
 */
export function goesToBatocera(detail: Detail): boolean {
	return detail.kind === 'game' && detail.complete && (detail.downloads.windows?.length ?? 0) > 0;
}

/**
 * The platform the note "Not available for …" names, or null for no note (2026-10-21): the one the main button is
 * expected to start on, when the game does not have it. That is the preferred platform; Autoselect, and Batocera
 * while it is not set up, mean the visitor's own system, and `other` asks to choose the files. Batocera is had by a
 * game that can go to it, and a marked game has no note. Decided by the settings and the game, never by a pick, so
 * picking moves nothing. A phone, a record that could not be read, a game without files and one with DLC files only
 * keep their own notes.
 */
export function missingFor(
	detail: Detail,
	visitor: Visitor,
	preferred: Preferred,
	batoceraReady: boolean,
	marked: boolean
): Os | 'batocera' | 'other' | null {
	const kind = blockKind(detail, visitor);
	if (kind !== 'mine' && kind !== 'not-mine' && kind !== 'other') return null;
	if (preferred === 'batocera' && batoceraReady) return marked || goesToBatocera(detail) ? null : 'batocera';
	if (preferred !== 'auto' && preferred !== 'batocera') return buttonSystems(detail).includes(preferred) ? null : preferred;
	return kind === 'mine' ? null : kind === 'other' ? 'other' : (visitor as Os);
}

const JUST_SENT_MS = 10 * 60_000;

/** True for ten minutes after a send ended as sent: the check after "On Batocera" shows (spec 2026-10-21, section 3.2). */
export function justSent(job: JobView | null, now: number): boolean {
	if (job?.state !== 'done' || !job.endedAt) return false;
	const ended = Date.parse(job.endedAt);
	return Number.isFinite(ended) && now - ended < JUST_SENT_MS;
}

/**
 * The system a tab of the file list turns the main button to, or null when the tab leaves the
 * button where it is: the tab of a system for which only a DLC has files.
 */
export function buttonForTab(detail: Detail, tab: Os): Os | null {
	return buttonSystems(detail).includes(tab) ? tab : null;
}

export function totalBytes(files: FileEntry[]): number {
	return files.reduce((sum, file) => sum + (Number.isFinite(file.sizeBytes) ? file.sizeBytes : 0), 0);
}

/** The file to open when all downloads have finished. */
export function runFile(files: FileEntry[]): FileEntry | null {
	return files.find((file) => file.run) ?? files[0] ?? null;
}

/**
 * GOG names every part of a game with the whole title: "Game (Part 3 of 7)".
 * In a list of parts the part number says as much.
 */
export function partLabel(file: FileEntry, inParts: boolean): string {
	if (!inParts) return file.name;
	return file.name.match(/\((Part \d+ of \d+)\)\s*$/i)?.[1] ?? file.name;
}

/** The version all files share, or null when they differ or have none. */
export function sharedVersion(files: FileEntry[]): string | null {
	const first = files[0]?.version ?? '';
	return first !== '' && files.every((file) => file.version === first) ? first : null;
}

/** Up to this many files are all shown. */
export const SHOW_ALL_UP_TO = 8;
/** Of more, this many are shown until the visitor asks for the rest. */
export const SHOWN_OF_MANY = 5;

export function visibleFiles(files: FileEntry[], expanded: boolean): FileEntry[] {
	return expanded || files.length <= SHOW_ALL_UP_TO ? files : files.slice(0, SHOWN_OF_MANY);
}

export interface DlcFiles {
	title: string;
	files: FileEntry[];
}

/** The owned DLC that has files for a system. */
export function dlcFor(detail: Detail, os: Os): DlcFiles[] {
	return detail.dlc
		.map((d) => ({ title: d.title, files: d.downloads[os] ?? [] }))
		.filter((d) => d.files.length > 0);
}

/**
 * What is known against the macOS installer of a game.
 *   gog       GOG says it itself, in its "Mac notice": the words are GOG's
 *   unlisted  GOG says nothing, and lists the game for some systems but not for
 *             macOS, while the archive holds a macOS installer
 */
export type MacNote = { kind: 'gog'; text: string } | { kind: 'unlisted' };

/** The note for a game, or null. Only a game with a macOS file of its own has one. */
export function macNote(detail: Detail): MacNote | null {
	if ((detail.downloads.macos?.length ?? 0) === 0) return null;
	if (detail.macNotice) return { kind: 'gog', text: detail.macNotice };
	return detail.os.length > 0 && !detail.os.includes('macos') ? { kind: 'unlisted' } : null;
}

/**
 * Where the note stands: under the main button while the button is on macOS,
 * otherwise with the macOS files while their tab is open. Never in both.
 * `target` is null when there is no main button, as on a phone.
 */
export function notePlace(note: MacNote | null, target: Os | null, tab: Os | null): 'button' | 'list' | null {
	if (note === null) return null;
	if (target === 'macos') return 'button';
	return tab === 'macos' ? 'list' : null;
}

/** True while the main button must not be yellow: it is on macOS, and GOG itself says the installer will not work. */
export function discouraged(note: MacNote | null, target: Os | null): boolean {
	return note?.kind === 'gog' && target === 'macos';
}

/**
 * True while the main button is yellow. Yellow says "press this": only for the visitor's own
 * computer, until it was pressed for that system, and not where GOG itself says that the
 * installer will not work. Another system, chosen by a tab or by the switch, gets the quiet button.
 */
export function isPrimary(
	kind: BlockKind,
	visitor: Visitor,
	target: Os | null,
	pressed: boolean,
	note: MacNote | null
): boolean {
	return kind === 'mine' && target !== null && target === visitor && !pressed && !discouraged(note, target);
}
