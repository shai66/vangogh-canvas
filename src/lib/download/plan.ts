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

/** The tab the file list opens on: the visitor's system when the game has it. */
export function firstTab(detail: Detail, visitor: Visitor): Os | null {
	const systems = systemsOf(detail);
	return systems.find((os) => os === visitor) ?? systems[0] ?? null;
}

/** The systems the main button can download for: those the game itself has files for. */
export function buttonSystems(detail: Detail): Os[] {
	return ALL_OS.filter((os) => (detail.downloads[os]?.length ?? 0) > 0);
}

/**
 * The system the main button downloads for, or null when there is no button.
 * It is the visitor's own when the game has it, otherwise the first the game
 * has, until the visitor picks another with the switch. Nothing remembers the
 * pick: a detail that is opened again starts from here.
 */
export function buttonTarget(detail: Detail, visitor: Visitor, picked: Os | null = null): Os | null {
	const kind = blockKind(detail, visitor);
	if (kind === 'unread' || kind === 'no-files' || kind === 'phone' || kind === 'dlc-only') return null;
	const offered = buttonSystems(detail);
	if (picked && offered.includes(picked)) return picked;
	return offered.find((os) => os === visitor) ?? offered[0] ?? null;
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
