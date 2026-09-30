// Every text of the interface, in one place. A second language is a second
// file of this shape. Text that comes from GOG (titles, genres, descriptions)
// is not here: it is shown as it is.

import type { GenreGroup } from './genres';
import type { MatchField } from './search/query';
import type { Together } from './search/state';
import type { Os } from './types';
import type { Visitor } from './visitor';

const plural = (n: number, one: string, many: string): string => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** "Windows", "Windows and Linux", "Windows, macOS and Linux". */
function list(items: string[]): string {
	return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

const osName: Record<Os, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

export const t = {
	name: 'Canvas',
	nameSuffix: 'for vangogh',
	pageTitle: 'Canvas for vangogh',
	gameTitle: (title: string) => `${title} | Canvas for vangogh`,

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
		filtersOn: (n: number) => `Filters, ${n} on`
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
		sortRecent: 'Recently added'
	},

	card: {
		dlc: (n: number) => `${n} DLC`,
		filesMissing: 'Files missing',
		filesMissingLong: 'The files of this game are missing in the archive',
		orphan: 'DLC, base game not owned',
		reason: {
			dlc: (value: string) => `contains: ${value}`,
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
		partOf: 'Part of',
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
		features: 'Features'
	},

	download: {
		button: (os: Os) => `Download for ${osName[os]}`,
		again: 'Download again',
		/** The switch beside the main button, and its menu. */
		another: 'Download for another system',
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
		notForTitle: (visitor: Visitor) =>
			visitor === 'other' ? 'Choose the files for your system.' : `Not available for ${osName[visitor as Os]}.`,
		notForText: (systems: Os[]) => `This game exists for ${list(systems.map((os) => osName[os]))}. The files are listed below.`,
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

	foot: {
		version: (version: string) => `Canvas ${version}`,
		updated: (when: string) => `Library updated ${when}`,
		stale: (days: number) => `Library last updated ${days} days ago`,
		archivedBy: 'The games are archived by',
		vangogh: 'vangogh',
		readsApi: 'Canvas reads them through its API.',
		source: 'Source code'
	},

	preparing: {
		title: 'The library is being prepared',
		text: 'Canvas is reading the archive for the first time. This page shows the games as soon as it is done.'
	},

	notInLibrary: 'This game is not in the library.',

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
