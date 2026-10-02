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
	/** The year the game first came out, which is not the year it came to GOG. Null when GOG names none. */
	releaseYear: number | null;
	/** Titles of the nested DLC. */
	dlc: string[];
	/** GOG's kind of each extra in the archive, such as "manuals", in the order of the panel. Its length is the pill's number. */
	extraKinds: string[];
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

/** One of GOG's goodies that is in the archive: a manual, a soundtrack, artwork. */
export interface ExtraFile {
	fileId: string;
	/** As GOG names it, such as "manual (German)". */
	name: string;
	/** GOG's word for its kind, such as "manuals". */
	kind: string;
	/** Size as GOG gives it, such as "1500 MB". */
	sizeText: string;
	sizeBytes: number;
}

/** One row of system requirements as GOG writes it: id "memory", label "Memory", text "4 GB RAM". */
export interface RequirementRow {
	/** GOG's id of the row, in lower case, such as "memory". */
	id: string;
	/** GOG's label without its colon, such as "Memory". The interface names known rows in its own words. */
	name: string;
	text: string;
}

/** What GOG says a computer needs to run the game, for one system. Either list may be empty. */
export interface RequirementSet {
	minimum: RequirementRow[];
	recommended: RequirementRow[];
}

/** By system. A system GOG lists no requirements for has no entry. */
export type Requirements = Partial<Record<Os, RequirementSet>>;

export interface Detail extends Omit<ListEntry, 'dlc'> {
	/** Sanitised HTML. */
	description: string;
	languages: string[];
	features: string[];
	/** Image ids. */
	screenshots: string[];
	/** Image id of the wide artwork without the logo, shown behind the head of the detail. */
	backdrop: string | null;
	/** What GOG says about the macOS installer of the game ("Mac notice"), as plain text. Null when GOG says nothing. */
	macNotice: string | null;
	/** GOG's system requirements. Empty when GOG lists none. */
	requirements: Requirements;
	/** The game's page on GOG.com, always an https address on www.gog.com, or null. */
	storeUrl: string | null;
	downloads: Downloads;
	/** Null for English, otherwise the language the downloads are in. */
	downloadLanguage: string | null;
	dlc: DlcDetail[];
	/** The extras in the archive, in the order of the panel. */
	extras: ExtraFile[];
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
