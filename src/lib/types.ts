// Shapes that travel between the backend and the browser. Spec section 4.

export type Os = 'windows' | 'macos' | 'linux';
export const ALL_OS: readonly Os[] = ['windows', 'macos', 'linux'];

export type Kind = 'game' | 'orphaned-dlc';

export interface ListEntry {
	id: string;
	title: string;
	kind: Kind;
	os: Os[];
	genres: string[];
	tags: string[];
	developers: string[];
	publisher: string;
	multiplayer: boolean;
	coop: boolean;
	/** Image id of the portrait poster, null when the archive has none. */
	poster: string | null;
	/** Image id of the wide image with the game's logo. It stands in for a missing poster. */
	banner: string | null;
	/** Titles of the nested DLC. */
	dlc: string[];
	/** Position in the library list. */
	order: number;
	/** False when the record was broken and only title and OS are known. */
	complete: boolean;
	/** True when at least one file can be downloaded, the product's own or one of its DLC's. */
	hasFiles: boolean;
}

export interface FileEntry {
	fileId: string;
	/** The name GOG gives the download, such as "Game (Part 1 of 5)". */
	name: string;
	/** The name of the file on disk, such as "setup_game_1.0.exe". */
	filename: string;
	version: string;
	/** Size as GOG gives it, such as "2.5 GB". */
	sizeText: string;
	sizeBytes: number;
	/** True for the file the user starts after the download. */
	run: boolean;
}

export type Downloads = Partial<Record<Os, FileEntry[]>>;

export interface DlcDetail {
	title: string;
	downloads: Downloads;
}

export interface Detail extends Omit<ListEntry, 'dlc'> {
	/** Sanitised HTML. */
	description: string;
	languages: string[];
	features: string[];
	/** Image ids. */
	screenshots: string[];
	/** Image id of the wide artwork without the logo, shown behind the head of the detail. */
	backdrop: string | null;
	/** The year the game first came out, which is not the year it came to GOG. Null when GOG names none. */
	releaseYear: number | null;
	/** What GOG says about the macOS installer of the game ("Mac notice"), as plain text. Null when GOG says nothing. */
	macNotice: string | null;
	downloads: Downloads;
	/** Null for English, otherwise the language the downloads are in. */
	downloadLanguage: string | null;
	dlc: DlcDetail[];
	/** For an orphaned DLC: the game it needs. */
	requires: string | null;
	/** Titles of owned packs that include the game. */
	partOf: string[];
}

/** The body of GET /api/index. */
export interface IndexPayload {
	builtAt: string;
	version: string;
	entries: ListEntry[];
}
