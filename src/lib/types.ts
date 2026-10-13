// Shapes that travel between the backend and the browser. Spec section 4.

export type Os = 'windows' | 'macos' | 'linux';
export const ALL_OS: readonly Os[] = ['windows', 'macos', 'linux'];

export type Kind = 'game' | 'orphaned-dlc';

/** What a collection is: one of GOG's series, a pack GOG sells, or series and packs joined. */
export type CollectionKind = 'series' | 'pack' | 'collection';

/** A series or a pack that was joined into a collection another one leads. */
export interface JoinedGroup {
	kind: 'series' | 'pack';
	name: string;
}

/** Games of the library that GOG groups by a series, a pack, or both joined. Spec, section 4.3. */
export interface Collection {
	/** "s" and GOG's series id, or "p" and the pack's product id: the lead's. */
	id: string;
	kind: CollectionKind;
	/** GOG's name of the lead, as GOG writes it. */
	name: string;
	/** Image id of the lead pack's poster. Null for a series, which has none. */
	poster: string | null;
	/** For a lead pack: the number of its games on GOG, those of packs inside it included. Null for a series. */
	total: number | null;
	/** The lead pack's page on GOG.com when GOG sells the games only as that pack, otherwise null. */
	storeUrl: string | null;
	/** The other series and packs joined in, the largest first. */
	joined: JoinedGroup[];
	/** Ids of its list entries, oldest first. Two or more. */
	games: string[];
}

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
	/** The id of the collection the entry is in, or null. */
	collection: string | null;
	/** The name of GOG's series of the game, also a series of one. For search. */
	series: string | null;
	/** The names of the packs that count and hold the game, A to Z. For search. */
	packs: string[];
	/** True when the game is for adults by the rule of spec 0.10.0, section 3.1: hidden by "Hide 18+". */
	adult: boolean;
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

/** The body whose rating the detail shows, spec 0.10.0, section 3.2. */
export type RatingBody = 'pegi' | 'esrb' | 'usk';

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
	/** The one rating the detail shows: PEGI, else ESRB by its age, else USK. Null when none of them rated the game. */
	rating: { body: RatingBody; age: number } | null;
	downloads: Downloads;
	/** Null for English, otherwise the language the downloads are in. */
	downloadLanguage: string | null;
	dlc: DlcDetail[];
	/** The extras in the archive, in the order of the panel. */
	extras: ExtraFile[];
	/** For an orphaned DLC: the game it needs. */
	requires: string | null;
}

/** The body of GET /api/index. */
export interface IndexPayload {
	builtAt: string;
	version: string;
	entries: ListEntry[];
	/** Every collection, by name. */
	collections: Collection[];
}

/** The library at a glance, worked out by the server from the index. Spec 0.9.1, section 4.2. */
export interface Glance {
	/** Bytes of the files in the archive by system, installers and DLC. */
	bytes: Record<Os, number>;
	/** Bytes of the extras in the archive. */
	extrasBytes: number;
	/** Entries GOG lists for each system, as the platform filter counts them. */
	systems: Record<Os, number>;
	/** [decade, games] from the first decade with a game to the last: [[1990, 38], [2000, 41]]. */
	decades: [number, number][];
	/** Entries without a year. */
	noYear: number;
	/** The most common genres of the group "genre", most first: [['Action', 48]]. */
	genres: [string, number][];
}
