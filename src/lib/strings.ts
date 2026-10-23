// Every text of the interface, in one place. A second language is a second
// file of this shape. Text that comes from GOG (titles, genres, descriptions)
// is not here: it is shown as it is.

import type { FailReason, JobView, StepName } from './batocera';
import { formatSize, upperFirst } from './format';
import type { GenreGroup } from './genres';
import type { MatchField } from './search/query';
import type { Together } from './search/state';
import type { CollectionKind, JoinedGroup, Os, RatingBody } from './types';

const plural = (n: number, one: string, many: string): string => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** A piece of a text with words in bold: the plain words, then the bold ones. A component draws the bold ones as <b>. */
export interface TextPart {
	plain: string;
	bold: string;
}

/** "Windows", "Windows and Linux", "Windows, macOS and Linux". */
function list(items: string[]): string {
	return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

const osName: Record<Os, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

/** What a collection is, as the card, the sheet and the row name it. */
const COLLECTION_KIND: Record<CollectionKind, string> = { series: 'Series', pack: 'Pack', collection: 'Collection' };

/** The names the kinds of extras are shown by, by GOG's word. Their order is in src/lib/extras.ts. */
const EXTRA_KIND_NAMES = new Map<string, string>([
	['manuals', 'Manual'],
	['guides & reference', 'Guide'],
	['audio', 'Audio'],
	['artworks', 'Artwork'],
	['wallpapers', 'Wallpaper'],
	['avatars', 'Avatars'],
	['video', 'Video'],
	['game add-ons', 'Add-on']
]);

/** A kind of extra as it is shown. A kind GOG adds later keeps GOG's word, with a capital letter. */
function extraKind(kind: string): string {
	const word = kind.trim();
	if (word === '') return 'Extra';
	return EXTRA_KIND_NAMES.get(word.toLowerCase()) ?? upperFirst(word);
}

/** Canvas's names for GOG's rows of system requirements, by GOG's id. Another row keeps GOG's label. */
const REQUIREMENT_ROWS = new Map<string, string>([
	['system', 'System'],
	['processor', 'Processor'],
	['memory', 'Memory'],
	['graphics', 'Graphics'],
	['directx', 'DirectX'],
	['sound', 'Sound'],
	['network', 'Network'],
	['storage', 'Storage'],
	['other', 'Other']
]);

/**
 * Why a send stopped, as sections 3 and 9.3 of the spec word it; fetch, checksum, copy, in-the-way and login are Claude's
 * wording, and so are box-room and unrar since 0.12.1, approved by the user (2026-10-23).
 */
function reasonOf(r: FailReason): string {
	switch (r.code) {
		case 'box-down':
			return 'Batocera does not answer. Turn it on, then send again.';
		case 'box-room':
			return `Batocera has ${formatSize(r.free)} free, and the send needs ${formatSize(r.need)} while it unpacks.`;
		case 'fetch':
			return 'The installer could not be fetched from vangogh.';
		case 'checksum':
			return 'A file from vangogh was damaged on the way.';
		case 'unpack':
			return 'This installer could not be unpacked.';
		case 'unrar':
			return "This installer needs RAR support, which Batocera's innoextract does not have.";
		case 'copy':
			return 'The copy to Batocera broke off.';
		case 'in-the-way':
			return `A folder is in the way on Batocera: ${r.path}. Remove it there, then send again.`;
		case 'key-changed':
			return "Batocera's key has changed. If it was reinstalled, test the connection again in settings.";
		case 'login':
			return 'Batocera refused the login. Test the connection again in settings.';
	}
}

const ahead = (n: number): string => (n <= 1 ? 'One other game is being sent first.' : `${n} other games are being sent first.`);
const minutesLeft = (n: number): string => (n === 1 ? 'about 1 minute left' : `about ${n} minutes left`);
const percentText = (n: number): string => `${n} %`;

/** The last sentence of the "i" of a game on the box: Claude's wording, approved by the user (2026-10-21). */
const SETTINGS_HINT = 'Some games need extra settings in Batocera before they run well, such as the controls.';

const STEP: Record<StepName, string> = {
	copy: 'Copying to Batocera',
	unpack: 'Unpacking on Batocera',
	reload: "Reloading Batocera's list"
};

/** Step 1 while it waits for Batocera before the copy: chosen by the user from three options (2026-10-21). */
const WAITING_FOR_BOX = 'Waiting for Batocera';

/** What a failed send left on the box: nothing, or, after a failed update, the older version (the user, 2026-10-21). */
const LEFT_NOTHING = 'Nothing was left on the box.';
const LEFT_OLDER = 'The older version stays.';
const NOT_KNOWN = 'The reason is not known.';

/** The two sentences of the note of a failed send (spec 2026-10-21, section 5.3); `older` for a failed update. */
function failedNote(r: FailReason | null, older: boolean): { bold: string; plain: string } {
	const left = older ? LEFT_OLDER : LEFT_NOTHING;
	if (!r) return { bold: NOT_KNOWN, plain: left };
	switch (r.code) {
		case 'box-down':
			return { bold: 'Batocera does not answer.', plain: 'Turn it on, then send again.' };
		// Short forms in the note, the full text in its "i": the user's choice (2026-10-23).
		case 'box-room':
			return { bold: 'Batocera has no room to unpack it.', plain: `${formatSize(r.free)} free, ${formatSize(r.need)} needed.` };
		case 'unrar':
			return { bold: 'This installer needs RAR support.', plain: left };
		case 'fetch':
		case 'checksum':
		case 'unpack':
		case 'copy':
			return { bold: reasonOf(r), plain: left };
		case 'in-the-way':
			return { bold: 'A folder is in the way on Batocera.', plain: 'Remove it there, then send again.' };
		case 'key-changed':
			return { bold: "Batocera's key has changed.", plain: 'Test the connection again in settings.' };
		case 'login':
			return { bold: 'Batocera refused the login.', plain: 'Test the connection again in settings.' };
	}
}

/** The "i" of the note of a failed send: the reason in full, then what is left on the box. */
function failedInfo(r: FailReason | null, older: boolean): string {
	return `${r ? reasonOf(r) : NOT_KNOWN} ${older ? LEFT_OLDER : LEFT_NOTHING}`;
}

const BATOCERA = {
	name: 'Batocera',
	/** The labels of the main button on Batocera. */
	send: 'Send to Batocera',
	stop: 'Stop sending',
	play: 'Play on the TV',
	/** While Play waits for the box's answer; Claude's wording, approved by the user (2026-10-21). */
	starting: 'Starting…',
	/** The state in the row of the menu, where a system has its files. */
	menu: {
		no: 'Not there yet',
		offWakes: 'Off, Canvas wakes it',
		off: 'Off',
		waiting: 'Waiting',
		sending: 'Sending',
		on: 'On Batocera',
		newer: 'Newer version',
		marked: "Doesn't run there"
	},
	/** The line beside the button: bold, then plain. */
	windowsVersion: (size: string) => `Windows version, ${size}`,
	dosGame: (size: string) => `DOS game, ${size}`,
	/** Claude's wording since 0.12.1, approved by the user (2026-10-23). */
	notThere: 'Canvas copies the installers to Batocera, which unpacks them.',
	offWakes: 'Batocera is off. Canvas wakes it, then copies the game.',
	waiting: 'Waiting to be sent',
	ahead,
	closeThis: 'You can close this: the server goes on.',
	onBox: 'On Batocera',
	newer: (box: string, archive: string) => `Batocera has ${box}; vangogh has ${archive}.`,
	/** A newer version whose version text is the same, or not known: GOG changed the files under it. Claude's wording. */
	newerFiles: "vangogh's installer files have changed since it was sent.",
	marked: "Doesn't run on Batocera",
	/** The flag at the end of the line, with the settings unlocked: its name and its tooltip (spec 2026-10-21, 6.3). */
	markIt: "Doesn't run? Mark it",
	unmark: 'Take the mark back',
	minutesLeft,
	/** The plain line while a send waits for Batocera: whether Canvas woke the box for the send. */
	box: { no: 'Batocera is on', waking: 'Batocera is waking up', awake: 'Batocera is awake' } satisfies Record<JobView['waking'], string>,
	/** Under the system the game went to; "DOS" is Claude's wording, the spec gives "Windows" only. Then the hint. */
	inList: (system: 'windows' | 'dos') => `It is in Batocera's list, under ${system === 'dos' ? 'DOS' : 'Windows'}. ${SETTINGS_HINT}`,
	listLater: `It shows in Batocera's list once the game on the TV is closed. ${SETTINGS_HINT}`,
	/** The seconds of the countdown as a clock: "9:41". */
	clock: (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
	keepOn: 'Keep it on',
	keptOn: 'Batocera stays on.',
	runningTitle: 'A game is running on the TV.',
	runningText: 'Close it and start this one?',
	force: 'Close it and play',
	cancel: 'Cancel',
	newerTitle: 'vangogh has a newer version.',
	savesStay: 'Saves stay as they are.',
	update: 'Update on Batocera',
	noScreenTitle: 'Batocera sees no screen.',
	/** A start Batocera did not make (section 5): Claude's wording, approved by the user (2026-10-23). */
	notStartedTitle: 'The game did not start on the TV.',
	notStartedPlain: 'Press Play again.',
	goneTitle: 'The game is no longer on Batocera.',
	/** A Play that found the box off, with waking off (section 5). */
	downTitle: 'Batocera does not answer.',
	downText: 'Turn it on, then press Play.',
	failedTitle: 'The send stopped.',
	reason: reasonOf,
	retry: 'Try again',
	/** A phone where the game is marked and the settings are locked (section 7.6). */
	markedNote: 'It was tried on the box and marked in Canvas.',
	/** The line beside the main button and the one note under it, direction B (spec 2026-10-21, sections 3 to 5). */
	notYet: 'Not on Batocera yet.',
	turnOn: 'Turn Batocera on to send.',
	step: (step: StepName, n: number) => `${STEP[step]}, ${n} of 3`,
	waitingStep: (n: number) => `${WAITING_FOR_BOX}, ${n} of 3`,
	/** A send's numbers in the line, "55 % · about 11 minutes left", and the same as the bar's value text; no minutes while they are null. */
	numbers: (percent: number, minutes: number | null) => (minutes === null ? percentText(percent) : `${percentText(percent)} · ${minutesLeft(minutes)}`),
	barText: (percent: number, minutes: number | null) => (minutes === null ? percentText(percent) : `${percentText(percent)}, ${minutesLeft(minutes)}`),
	sentDay: (day: string | null) => (day ? `Sent on ${day}.` : 'Sent by Canvas.'),
	byHand: 'Put there by hand.',
	hidden: 'Hidden for everyone else.',
	startingLine: 'Starting the game on the TV…',
	closingLine: 'Closing the other game first…',
	wakingLine: 'Waking Batocera to play…',
	startedLine: 'Started. Pick up the remote.',
	/** The "i": its name, and its words. */
	moreName: 'More about this',
	versionOf: (version: string) => `Version ${version}.`,
	hint: SETTINGS_HINT,
	handInfo: 'Canvas leaves a game put there by hand as it is.',
	/** The TV at the line's left: its name, and its tooltips. */
	tvName: "Batocera's state",
	tvOn: 'Batocera is on.',
	tvWoken: 'Batocera is on. Canvas woke it for this send.',
	tvWaking: 'Batocera is waking up. Canvas woke it for this send.',
	tvWakingPlay: 'Batocera is waking up. Canvas woke it to start the game.',
	tvCounting: (time: string) => `Batocera is on. Canvas woke it for this send, so it shuts down in ${time}.`,
	tvOffPlay: 'Batocera is off. Canvas wakes it to play.',
	tvUnknown: 'Canvas has not looked at Batocera yet.',
	/** The notes. */
	shutsDown: (time: string) => `Batocera shuts down in ${time}.`,
	wokeForSend: 'Canvas woke it for this send.',
	noScreenPlain: 'Turn the TV on, then restart Batocera.',
	failedNote,
	failedInfo
};

export const t = {
	name: 'Canvas',
	nameSuffix: 'for vangogh',
	pageTitle: 'Canvas for vangogh',
	gameTitle: (title: string) => `${title} | Canvas for vangogh`,
	collectionTitle: (name: string) => `${name} | Canvas for vangogh`,
	glanceTitle: 'Library at a glance | Canvas for vangogh',
	settingsTitle: 'Settings | Canvas for vangogh',

	osName,
	together: { multiplayer: 'Multiplayer', coop: 'Co-op' } satisfies Record<Together, string>,

	bar: {
		home: 'Canvas, the whole library',
		searchLabel: 'Search the library',
		searchPlaceholder: 'Search games, DLC, genres, studios',
		clearSearch: 'Clear the search',
		platforms: 'Show games for',
		onlyFor: (os: Os) => `Only games for ${osName[os]}`,
		filters: 'Filters',
		filtersOn: (n: number) => `Filters, ${n} on`,
		collections: 'Collections',
		collectionsTitle: 'Show each collection as one card'
	},

	count: {
		/** Follows the number of games: "118 games". */
		games: (total: number) => (total === 1 ? 'game' : 'games'),
		/** Follows the number of games shown: "37 of 118 games". */
		ofTotal: (total: number) => `of ${plural(total, 'game', 'games')}`,
		removeFilter: (label: string) => `Remove the filter ${label}`,
		clearAll: 'Clear all',
		sorted: 'Sorted',
		sortTitle: 'A to Z',
		sortRecent: 'Recently added',
		sortYear: 'Release year',
		/** Between the count of games and the count of collections: "138 games · 17 collections". */
		separator: ' · ',
		/** Follows the number of collections. */
		collections: (n: number) => (n === 1 ? 'collection' : 'collections'),
		/** The room the collections part of the count line keeps, three digits wide in tabular figures. */
		room: ' · 000 collections'
	},

	card: {
		dlc: (n: number) => `${n} DLC`,
		filesMissing: 'Files missing',
		filesMissingLong: 'The files of this game are missing in the archive',
		orphan: 'DLC, base game not owned',
		reason: {
			dlc: (value: string) => `contains: ${value}`,
			series: (value: string) => `series: ${value}`,
			pack: (value: string) => `pack: ${value}`,
			genre: (value: string) => `genre: ${value}`,
			tag: (value: string) => `tag: ${value}`,
			developer: (value: string) => `by ${value}`,
			publisher: (value: string) => `published by ${value}`
		} satisfies Record<MatchField, (value: string) => string>
	},

	empty: {
		title: 'No game matches',
		search: (q: string, filtered: boolean) =>
			`Nothing in the library matches “${q}”${filtered ? ' with the filters that are on' : ''}.`,
		filters: 'No game in the library has this combination of filters.',
		clear: 'Clear search and filters'
	},

	filters: {
		title: 'Filters',
		close: 'Close',
		platform: 'Platform',
		games: (n: number) => plural(n, 'game', 'games'),
		together: 'Play together',
		age: 'Age',
		/** The one chip of the section "Age": the games for adults are left out. Also the chip in the count line. */
		hide18: 'Hide 18+',
		group: { genre: 'Genre', setting: 'Setting', style: 'How it plays' } satisfies Record<GenreGroup, string>,
		showAll: (n: number) => `Show all ${n} genres`,
		clear: 'Clear filters',
		show: (n: number) => `Show ${plural(n, 'game', 'games')}`
	},

	detail: {
		close: 'Close',
		publishedBy: 'published by',
		orphan: (base: string | null) =>
			base ? `This is DLC. It needs ${base}, which is not in the library.` : 'This is DLC. Its base game is not in the library.',
		screenshots: 'Screenshots',
		earlier: 'Earlier screenshots',
		more: 'More screenshots',
		larger: (n: number) => `Screenshot ${n}, larger view`,
		previous: 'Previous screenshot',
		next: 'Next screenshot',
		position: (n: number, of: number) => `${n} of ${of}`,
		about: 'About this game',
		tags: 'Tags',
		searchTag: (tag: string) => `Search for the tag ${tag}`,
		languages: 'Languages',
		features: 'Features',
		/** The link to the game's page on GOG.com, after the makers. Words only: GOG's logo is a trademark. */
		store: 'GOG.com',
		storeTitle: 'This game on GOG.com, in a new tab',
		/** The one rating after the systems. ESRB rates by category, written here by its age: "ESRB 17+". */
		rating: (body: RatingBody, age: number) => (body === 'esrb' ? `ESRB ${age}+` : `${body.toUpperCase()} ${age}`)
	},

	requirements: {
		title: 'System requirements',
		/** The row of tabs, for a screen reader. */
		tabs: 'System requirements for',
		minimum: 'Minimum',
		recommended: 'Recommended',
		none: (os: Os) => `GOG lists none for ${osName[os]}.`,
		/** The name a row is shown by: Canvas's for a row it knows, GOG's label for another. */
		row: (id: string, name: string) => REQUIREMENT_ROWS.get(id) ?? name
	},

	extras: {
		title: 'Extras',
		kind: extraKind,
		/** The kinds with their numbers, for the pill and the panel: "Manual (5), Audio (4), Artwork". */
		kinds: (counts: [string, number][]) => counts.map(([kind, n]) => (n > 1 ? `${extraKind(kind)} (${n})` : extraKind(kind))).join(', '),
		/** What a screen reader hears for the pill. */
		count: (n: number) => plural(n, 'extra', 'extras'),
		pill: (kinds: string) => `Extras: ${kinds}`
	},

	collections: {
		kind: COLLECTION_KIND,
		/** What a screen reader hears for a collection's badge. */
		games: (n: number) => plural(n, 'game', 'games'),
		/** The tooltip of a collection's badge: "Pack of 5 games: A, B, C, D, E". */
		pill: (kind: CollectionKind, titles: string[]) => `${COLLECTION_KIND[kind]} of ${plural(titles.length, 'game', 'games')}: ${titles.join(', ')}`,
		/** The years of a collection's games: "1991–1997", or one year. */
		years: (first: number, last: number) => (first === last ? String(first) : `${first}–${last}`),
		/** What a collection is, on its sheet: "**Pack** of 4 games on GOG, 3 in your library, **1991–1997**". */
		what: (kind: CollectionKind, total: number | null, inLibrary: number, years: string): TextPart[] => {
			const parts: TextPart[] = [{ plain: '', bold: COLLECTION_KIND[kind] }];
			if (kind === 'pack' && total !== null) {
				const held = total > inLibrary ? `${inLibrary} in your library` : 'all in your library';
				parts.push({ plain: ` of ${total} games on GOG, ${held}`, bold: '' });
			} else {
				parts.push({ plain: `, ${plural(inLibrary, 'game', 'games')} in your library`, bold: '' });
			}
			if (years) parts.push({ plain: ', ', bold: years });
			return parts;
		},
		/** The series and packs joined into a collection: "With the games of GOG's pack **X** and series **Y**." */
		joined: (groups: JoinedGroup[]): TextPart[] =>
			groups.length === 0
				? []
				: [
						...groups.map((g, i) => ({
							plain: `${i === 0 ? "With the games of GOG's " : i === groups.length - 1 ? ' and ' : ', '}${g.kind} `,
							bold: g.name
						})),
						{ plain: '.', bold: '' }
					],
		storeTitle: 'This pack on GOG.com, in a new tab',
		gamesTitle: 'Games in your library',
		gamesNote: (n: number) => `${n}, oldest first`,
		/** The folded line in a game's detail, after the collection's name: "Pack, 5 games in your library". */
		shelf: (kind: CollectionKind, n: number) => `${COLLECTION_KIND[kind]}, ${plural(n, 'game', 'games')} in your library`,
		/** Under this game's poster in the row: "This game · 1998". */
		here: (year: number | null) => (year ? `This game · ${year}` : 'This game'),
		earlier: 'Earlier games',
		more: 'More games'
	},

	download: {
		button: (os: Os) => `Download for ${osName[os]}`,
		again: 'Download again',
		/** The switch beside the main button, and its menu. */
		another: 'Download for another system',
		/** The same, while the menu has Batocera in it (0.12.0). */
		anotherOrBatocera: 'Other systems and Batocera',
		thisComputer: 'This computer',
		files: (n: number) => plural(n, 'file', 'files'),
		summary: (n: number, size: string) => `${plural(n, 'file', 'files')}, ${size}`,
		eachOnItsOwn: 'Each file downloads on its own, into the same folder. Your browser may ask once to allow that.',
		version: (version: string) => `Version ${version}`,
		started: (n: number) => (n === 1 ? 'The download has started.' : `${n} downloads have started.`),
		whenFinished: (n: number) => (n === 1 ? 'When it has finished,' : 'When all of them have finished,'),
		/** Around the name of the file to open: "open setup.exe. It installs the game." */
		runBefore: { windows: 'open', macos: 'open', linux: 'run' } satisfies Record<Os, string>,
		runAfter: {
			windows: '. It installs the game.',
			macos: ' and follow the installer.',
			linux: ' in a terminal. It installs the game.'
		} satisfies Record<Os, string>,
		keepTogether: 'Keep the other files in the same folder.',
		nothingHappens:
			'Only one file arrived? Your browser stopped the others. Allow multiple downloads for this site (the browser asks in the address bar), or download the files one by one below.',
		notForTitle: (platform: Os | 'batocera' | 'other') =>
			platform === 'other'
				? 'Choose the files for your system.'
				: `Not available for ${platform === 'batocera' ? BATOCERA.name : osName[platform]}.`,
		notForText: (systems: Os[]) => `This game exists for ${list(systems.map((os) => osName[os]))}. The files are listed below.`,
		/** Claude's words from the user's idea (2026-10-21). */
		notForBatoceraText: 'This game has no Windows version. The files are listed below.',
		dlcOnlyTitle: 'Only DLC of this game is in the archive.',
		dlcOnlyText: 'The files are listed below.',
		phoneTitle: 'Installers are meant for a computer.',
		phoneText: 'Open Canvas on the computer you want to play on.',
		showFiles: 'Show the files anyway',
		unreachableTitle: 'The archive is not reachable right now.',
		unreachableText: 'Try again in a few minutes.',
		noFilesTitle: 'The files of this game are missing in the archive.',
		noFilesText:
			'Nothing can be downloaded until the archive has them again. Tell the person who looks after it: a sync did not finish, or a download failed.',
		unreadTitle: 'The details of this game are not available right now.',
		unreadText: 'Canvas could not read its record in the archive. It tries again with the next update of the library.',
		platforms: 'Files by platform',
		openThis: 'Open this one to install',
		downloadFile: (filename: string) => `Download ${filename}`,
		/** What a screen reader hears for a file of the list: its part or name, and its size (0.10.2). */
		downloadPart: (name: string, size: string) => (size ? `Download ${name}, ${size}` : `Download ${name}`),
		fileMissing: 'This file is missing in the archive.',
		showAll: (n: number) => `Show all ${n} files`,
		language: (language: string) => `These files are in ${language}. The archive has no English version of this game.`,
		/** In front of GOG's own words about the macOS installer. */
		macNoticeBy: 'GOG says:',
		macUnlisted: 'GOG does not list this game for macOS. The installer may not work on a current Mac.',
		/** The sign on the macOS row of the switch, for a screen reader and as a tooltip. */
		hasNotice: 'There is a notice about this installer',
		dlcTitle: 'DLC you own',
		dlcText: (hasButton: boolean) =>
			`${hasButton ? 'The button above downloads the game only. ' : ''}DLC is installed after the game.`,
		dlcAll: 'Download all DLC'
	},

	/** The panel "Install with theo" in a game's detail, while the settings switch it on (0.11.0). */
	theo: {
		title: 'Install with theo',
		text: 'theo downloads this game from vangogh, installs it and starts it, on macOS or Linux.',
		about: 'About theo',
		command: (id: string) => `theo install ${id}`,
		copy: 'Copy',
		copied: 'Copied',
		/** The name of the button, for a screen reader. */
		copyLabel: 'Copy the command'
	},

	/** Send to Batocera in a game's detail (0.12.0, sections 3, 5 and 7). */
	batocera: BATOCERA,

	glance: {
		/** The title of the way in, shown on hover. */
		open: 'Library at a glance',
		/** Ends the name of the way in, after the count it shows: "135 games: Library at a glance". Visually hidden. */
		inLink: ': Library at a glance',
		title: 'Library at a glance',
		/** The line under the title: "135 games, 22 collections · as of 4 October, 04:30", the numbers in bold. */
		head: (games: number, collections: number, when: string | null): TextPart[] => [
			{ plain: '', bold: plural(games, 'game', 'games') },
			...(collections > 0
				? [
						{ plain: ', ', bold: String(collections) },
						{ plain: ` ${collections === 1 ? 'collection' : 'collections'}`, bold: '' }
					]
				: []),
			...(when ? [{ plain: ` · as of ${when}`, bold: '' }] : [])
		],
		space: 'Space in the archive',
		/** Before the total: "about 856 GB". GOG rounds every size. */
		about: 'about',
		spaceNote: "GOG's sizes of the files in the archive, added up: installers, DLC and extras. The space on the disk can differ a little.",
		extras: 'Extras',
		systems: 'Systems',
		systemsNote: 'games for each',
		decades: 'Games by decade',
		decadesNote: (noYear: number) => `of their first release${noYear > 0 ? `, ${noYear} without a year` : ''}`,
		decade: (decade: number) => `${decade}s`,
		noYears: 'No year is known.',
		genres: 'Genres',
		genresNote: (n: number) => (n === 1 ? 'the most common' : `the ${n} most common`),
		noGenres: 'No genre is known.',
		/** The titles of the rows, shown on hover. */
		sizeRow: (system: string, size: string) => `${system}: installers and DLC, ${size}`,
		extrasRow: (size: string) => `Extras: manuals, soundtracks, artwork and the rest, ${size}`,
		systemRow: (n: number, games: number, system: string) => `${n} of ${plural(games, 'game', 'games')} for ${system}`,
		decadeRow: (n: number, decade: number) => `${plural(n, 'game', 'games')} from the ${decade}s`,
		genreRow: (n: number, games: number, genre: string) => `${n} of ${plural(games, 'game', 'games')}: ${genre}`
	},

	foot: {
		version: (version: string) => `Canvas ${version}`,
		updated: (when: string) => `Library updated ${when}`,
		stale: (days: number) => `Library last updated ${days} days ago`,
		archivedBy: 'The games are archived by',
		vangogh: 'vangogh',
		readsApi: 'Canvas reads them through its API.',
		source: 'Canvas on GitHub',
		/** After the version, when a newer Canvas is released: a link to the release. */
		update: 'Update available',
		updateTitle: (version: string) => `Canvas ${version} is released`,
		/** The way into the settings, before "Canvas on GitHub" (0.11.0). */
		settings: 'Settings',
		/** The tooltip of "Settings" while no PIN is set: the words, the name of the setting, the words after it. */
		settingsOff: {
			before: 'Settings are off. To turn them on, give Canvas a PIN: ',
			code: 'SETTINGS_PIN',
			after: ", 4 to 8 digits, in the container's environment. Then restart Canvas."
		}
	},

	/** The PIN prompt at /settings while the browser is locked (0.11.0). */
	pin: {
		title: 'Settings are locked',
		text: 'Enter the PIN to change how Canvas works for everyone at home.',
		/** In place of the text when the settings were locked while the sheet was open. */
		again: 'Settings were locked again. Enter the PIN.',
		field: 'PIN',
		wrong: 'That is not the PIN. Try again.',
		failed: 'Canvas did not answer. Try again.',
		/** Canvas answered and refused: from another site, as behind a proxy, or the PIN was removed. */
		refused: 'Canvas refused the request. See the README.',
		unlock: 'Unlock',
		hint: 'The PIN is set where Canvas is installed. Ask whoever set it up.'
	},

	/** The settings sheet (0.11.0). */
	settings: {
		title: 'Settings',
		intro: 'They apply to everyone who opens Canvas here. A change is saved at once.',
		saved: 'Saved',
		/** The foot of the sheet: "Unlocked in this browser until 19 November". */
		until: (day: string) => `Unlocked in this browser until ${day}`,
		lock: 'Lock',
		/** The tabs of the sheet (spec 2026-10-21, section 3). */
		tabs: { library: 'Library', downloads: 'Downloads', batocera: 'Batocera', server: 'Server' },
		/** The panel of the library defaults, its note after the title, and its rows. */
		opens: 'How the library opens',
		opensNote: 'in a browser that has not chosen its own view',
		sorted: 'Sorted',
		platforms: 'Platforms',
		/** After the platform chips, while none is pressed. */
		noneChosen: 'None chosen: all games',
		collections: 'Collections',
		showCollections: 'Show collections',
		age: 'Age',
		keepsOwn: 'A browser where someone already chose a view keeps their choice.',
		/** The panel of the theo command. */
		theo: 'theo',
		theoNote: 'for people who install games with theo',
		theoSwitch: "Show the theo command in a game's detail",
		theoText: 'theo installs games from vangogh and starts them, on macOS and Linux.',
		theoLink: 'theo on GitHub',
		/** The panel of the preferred platform (0.12.0, section 8). */
		preferred: 'Preferred platform',
		preferredNote: "what a game's main button starts on",
		preferredRow: 'Starts on',
		preferredAuto: 'Autoselect',
		preferredBatocera: 'Batocera',
		/** The title of the Batocera chip while Batocera is not set up; Claude's wording, for the user to confirm. */
		preferredNotReady: 'Batocera: once it is set up in the Batocera tab',
		preferredText:
			"Autoselect starts on the visitor's own system, as before. Another choice applies when the game has it, else Autoselect. A phone or tablet starts on Batocera whenever Batocera is set up.",
		/** The panel of Batocera (0.12.0, section 9). */
		batocera: 'Batocera',
		batoceraNote: 'for sending games to a Batocera box by the TV',
		/** Batocera is experimental: the tag after the title and the sentence under the switch, Claude's wording chosen by the user (2026-10-21). */
		batoceraTag: 'Experimental',
		batoceraExperimental: 'Experimental: most games need settings in Batocera before they run well, and some do not run at all.',
		batoceraSwitch: 'Send games to Batocera',
		/** Claude's wording since 0.12.1, approved by the user (2026-10-23). */
		batoceraText:
			"Adds Batocera to a game's download menu once the connection test below has passed. Canvas copies the game's Windows installers to the box, which unpacks them; a DOS game goes to Batocera's DOS system.",
		batoceraLink: 'About Batocera',
		batoceraAddress: 'Address',
		batoceraAddressHint: 'Batocera shows it in its menu, under Network settings.',
		batoceraUser: 'User',
		batoceraPassword: 'Password',
		batoceraPasswordSaved: 'Saved. Type to change it.',
		batoceraPasswordHint: [
			{ plain: 'Canvas starts with ', bold: 'linux' },
			{ plain: ", Batocera's own default. With Enforce security on, Batocera shows its password under Security.", bold: '' }
		] satisfies TextPart[],
		batoceraConnection: 'Connection',
		batoceraTest: 'Test connection',
		/** The five lines of the connection test (section 9.3): before a test, passed, and failed or a warning. */
		batoceraCheck: {
			before: ['Batocera answers', 'The login works', 'Canvas can write games to the box', "Free space and Batocera's version", 'EmulationStation answers'],
			answers: (address: string) => `Batocera answers at ${address}`,
			noAnswer: (address: string) => `Nothing answers at ${address}. Is Batocera on, and is the address right?`,
			login: 'The login works',
			refused: 'The login was refused. Check the user and the password.',
			/** Line 2 when the box answers and its SSH does not start; Claude's wording. */
			noSsh: 'Batocera answers, but its SSH did not start within 20 seconds.',
			writes: 'Canvas can write games to roms/windows and roms/dos',
			/** The box's own reason after the colon, when it gave one. */
			cannotWrite: (folder: string, reason: string | null) => (reason ? `Canvas cannot write to ${folder}: ${reason}` : `Canvas cannot write to ${folder}.`),
			/** Line 3 when the box has no innoextract (0.12.1); Claude's wording, approved by the user (2026-10-23). */
			noInnoextract: 'Batocera has no innoextract, which unpacking a game needs.',
			space: (free: string, version: string) => `${free} free, Batocera ${version}`,
			noSpace: 'Canvas could not read the free space or the version.',
			es: 'EmulationStation answers',
			noEs: 'EmulationStation did not answer. Games still arrive; they show after Batocera restarts.',
			mac: (mac: string) => `The box's network card is saved for waking it: ${mac}`
		},
		batoceraWake: 'Wake Batocera when sending',
		batoceraWakeText:
			"When the box is off, Canvas wakes it over the network while it fetches the game. Needs a cable, Wake-on-LAN on the box, and Canvas on the host's network (see the README).",
		batoceraTestWake: 'Test wake',
		/** The one line of the wake test (section 9.5); "did not shut down" is Claude's wording. */
		batoceraWakeLine: {
			before: 'Canvas shuts Batocera down, then wakes it. Takes about a minute.',
			down: 'Batocera is shutting down…',
			waking: 'Woke it, waiting for an answer…',
			woke: (seconds: number) => `Batocera woke and answered after ${seconds === 1 ? '1 second' : `${seconds} seconds`}.`,
			noAnswer: "No answer after 3 minutes. Is Canvas on the host's network, and Wake-on-LAN on in the box?",
			busy: 'A game is running on the TV. Try again when it is closed.',
			notDown: 'Batocera did not shut down within a minute. Try again, or turn it off and on by hand.'
		},
		batoceraShutdown: 'Shut down after sending',
		batoceraShutdownText:
			'Only when Canvas woke Batocera for the send. It waits 10 minutes, so the game can still be started, and never shuts down while a game runs.',
		/** The red notices under the head: the folder cannot be written, a change got no answer, or Canvas refused it. */
		unwritable: 'Canvas cannot save settings: the folder /settings cannot be written. Give the container a volume there, as the README shows.',
		unreachable: 'Canvas did not answer. The change was not saved.',
		refused: 'Canvas refused the change. The README says why, under "The settings page".',
		/** In the foot, where "Saved" shows, after a change that could not be saved; Claude's wording (spec 2026-10-21, section 3). */
		notSaved: 'Not saved',
		/** The panel "This Canvas" of the Server tab (spec 2026-10-21, section 4); its words are Claude's. */
		facts: {
			title: 'This Canvas',
			note: 'what the server says now',
			version: 'Version',
			running: 'Running',
			vangogh: 'vangogh',
			library: 'Library',
			batocera: 'Batocera',
			upToDate: 'Up to date',
			/** A link to the release, as the foot's notice. */
			isOut: (version: string) => `${version} is out`,
			checked: (when: string) => `checked ${when}`,
			checkOff: 'Update check off',
			since: (when: string) => `since ${when}`,
			/** When something happened: "today at 11:04", else "21 October at 11:04". */
			today: (time: string) => `today at ${time}`,
			onDay: (day: string, time: string) => `${day} at ${time}`,
			/** How long Canvas has run: minutes under an hour, hours under two days, then days. */
			minutes: (n: number) => plural(n, 'minute', 'minutes'),
			hours: (n: number) => plural(n, 'hour', 'hours'),
			days: (n: number) => plural(n, 'day', 'days'),
			signedIn: 'Signed in',
			loginRefused: 'Login refused',
			games: (games: number, collections: number) => `${plural(games, 'game', 'games')}, ${plural(collections, 'collection', 'collections')}`,
			/** "read today at 11:04, next at 04:30", or "read 30 September, next at 04:30"; without a library yet, the next read only. */
			read: (when: string | null, next: string) => (when ? `read ${when}, next at ${next}` : `next at ${next}`),
			reading: 'reading…',
			/** Its reason is the title. */
			readFailed: 'the last read failed',
			batoceraOff: 'Off',
			batoceraNotSetUp: 'Not set up',
			batoceraSetUp: 'Set up',
			jobs: (n: number) => (n === 0 ? 'no send running' : n === 1 ? '1 send waiting or running' : `${n} sends waiting or running`),
			readNow: 'Read now',
			readingNow: 'Reading…'
		},
		/** The panel "Server" of the Server tab (section 5): the texts under the rows are the spec's. */
		server: 'Server',
		serverNote: 'what Canvas does on its own',
		rebuild: 'Daily rebuild',
		rebuildText: "Canvas reads vangogh's library again every day at this time, after vangogh's own sync at night.",
		zone: 'Time zone',
		zoneNow: (summer: boolean, offset: string) => (summer ? `It follows summer time: now ${offset}.` : `Now ${offset}.`),
		zoneText: 'Canvas shows its times in it: when the library was read, when a game went to Batocera.',
		updates: 'Check for updates',
		updatesText: 'Canvas asks GitHub once a day whether a newer Canvas is out, and its foot says so.',
		/** After each text: "Starts from REBUILD_AT in the stack.", the name of the variable as code. */
		from: { before: 'Starts from ', after: ' in the stack.' },
		/** The names of the stack's variables the three settings start from. */
		fromName: { rebuild: 'REBUILD_AT', zone: 'TZ', updates: 'VERSION_CHECK' }
	},

	/** The page while there is no library: reading, or why the last reading failed (0.10.2). */
	preparing: {
		reading: {
			title: 'The library is being prepared',
			text: 'Canvas is reading the archive for the first time. This page shows the games as soon as it is done.'
		},
		unreadable: {
			title: 'Canvas cannot read the archive',
			text: 'When Canvas last tried, vangogh did not answer, answered with an error, or listed no games yet. Canvas tries again by itself, at the latest with the next daily update, and this page shows the games as soon as it has them. The log of the Canvas container names the cause; a restart of Canvas tries again at once.'
		},
		refused: {
			title: 'vangogh refused the login',
			text: 'vangogh did not accept the account that Canvas logs in with, VANGOGH_USERNAME and VANGOGH_PASSWORD in the settings of Canvas. Check that the account exists in vangogh and that both settings match it; vangogh reads its accounts only when it starts. Then restart Canvas, or wait: it tries again by itself, at the latest with the next daily update.'
		}
	},

	notInLibrary: 'This game is not in the library.',
	collectionNotInLibrary: 'This collection is not in the library.',

	error: {
		notFoundTitle: 'This page does not exist',
		failedTitle: 'Something went wrong',
		failedText: 'Canvas could not show this page. Try again in a moment.',
		back: 'Go to the library'
	}
};

export const VANGOGH_URL = 'https://github.com/arelate/vangogh';
/** Where the source of Canvas can be read. */
export const SOURCE_URL = 'https://github.com/shai66/vangogh-canvas';
/** theo, which installs games from vangogh (0.11.0). */
export const THEO_URL = 'https://github.com/arelate/theo';
/** Batocera, which plays games on the TV (0.12.0). */
export const BATOCERA_URL = 'https://batocera.org';
/** The page of a release on GitHub. */
export const releaseUrl = (version: string): string => `${SOURCE_URL}/releases/tag/v${version}`;
