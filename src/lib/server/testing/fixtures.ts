// Hand-made records in the shapes vangogh returns. Six products cover the
// rules of spec section 4:
//   1001  a game for three systems, multi-part on Windows, one DLC, in a pack, with extras
//   1002  a game for Windows only, one file
//   2002  a DLC whose base game (9999) is not owned
//   3001  a pack that includes 1001 and has no files of its own
//   1003  a product without any metadata
//   1004  a product of type GAME that gog offers no installer for (extras only)

export const POSTER = {
	'1001': 'a'.repeat(64),
	'1002': 'b'.repeat(64),
	'2002': 'c'.repeat(64),
	'1004': '9'.repeat(64)
};
export const SHOT = { one: 'd'.repeat(64), two: 'e'.repeat(64) };
/** The wide image with the logo, which stands in for a missing portrait poster. */
export const BANNER = { '1001': '3'.repeat(64), '1002': '4'.repeat(64) };
/** The wide artwork without the logo. */
export const BACKDROP = { '1001': '5'.repeat(64) };

export const library: unknown = [
	{ id: '1001', tt: 'The Long Dark Road', os: [1, 2, 3], dlc: { '2001': 'Road Expansion' } },
	{ id: '1002', tt: 'Windows Only Game', os: [1] },
	{ id: '2002', tt: 'Lonely Expansion', os: [1] },
	{ id: '3001', tt: 'Road Trilogy', os: [1, 2, 3] },
	{ id: '1003', tt: 'Broken Record', os: [1] },
	{ id: '1004', tt: 'Goodie Collection', os: [1] }
];

export interface ApiProductOptions {
	title: string;
	type?: string;
	genres?: string[];
	tags?: string[];
	os?: string[];
	developers?: string[];
	publisher?: string;
	features?: string[];
	languages?: string[];
	description?: string;
	screenshots?: string[];
	poster?: string;
	banner?: string;
	backdrop?: string;
	/** The date of the original release, as GOG writes it: "2002-09-27T00:00:00+02:00". */
	released?: string;
	/** The field `additionalRequirements`: HTML with notes of all kinds, GOG's "Mac notice" among them. */
	additional?: string;
	/** The address of the game's page on GOG.com, `_links.store.href`. */
	store?: string;
	/** GOG's system requirements by system name ("windows", "osx", "linux"): rows of [id, GOG's label, text]. */
	requirements?: Record<string, { minimum?: [string, string, string][]; recommended?: [string, string, string][] }>;
	requires?: string[];
	includes?: string[];
	includedIn?: string[];
}

function links(ids: string[] = []) {
	return ids.map((id) => ({ href: `https://api.gog.com/v2/games/${id}?locale=en-US` }));
}

/** A `gog-api-products` record. */
export function apiProduct(o: ApiProductOptions): unknown {
	return {
		description: o.description ?? '<p>About the game.</p>',
		overview: '',
		featuresDescription: '',
		additionalRequirements: o.additional ?? '',
		_embedded: {
			product: {
				title: o.title,
				...(o.released ? { globalReleaseDate: o.released } : {}),
				...(o.banner
					? { _links: { image: { href: `https://images.gog-statics.com/${o.banner}_{formatter}.jpg` } } }
					: {})
			},
			productType: o.type ?? 'GAME',
			tags: (o.genres ?? []).map((name) => ({ name })),
			properties: (o.tags ?? []).map((name) => ({ name })),
			supportedOperatingSystems: (o.os ?? ['windows']).map((name) => {
				const wanted = o.requirements?.[name];
				const rows = (list: [string, string, string][] = []) =>
					list.map(([id, label, description]) => ({ id, name: label, description }));
				return {
					operatingSystem: { name },
					...(wanted
						? {
								systemRequirements: [
									...(wanted.minimum ? [{ type: 'minimum', description: '', requirements: rows(wanted.minimum) }] : []),
									...(wanted.recommended ? [{ type: 'recommended', description: '', requirements: rows(wanted.recommended) }] : [])
								]
							}
						: {})
				};
			}),
			developers: (o.developers ?? []).map((name) => ({ name })),
			publisher: { name: o.publisher ?? '' },
			features: (o.features ?? []).map((name) => ({ name })),
			localizations: (o.languages ?? ['en']).map((code) => ({
				_embedded: { language: { code } }
			})),
			screenshots: (o.screenshots ?? []).map((id) => ({
				_links: { self: { href: `https://images.gog-statics.com/${id}_{formatter}.jpg` } }
			}))
		},
		_links: {
			...(o.poster
				? { boxArtImage: { href: `https://images.gog-statics.com/${o.poster}.jpg` } }
				: {}),
			...(o.backdrop
				? { galaxyBackgroundImage: { href: `https://images.gog-statics.com/${o.backdrop}.jpg` } }
				: {}),
			...(o.store ? { store: { href: o.store } } : {}),
			requiresGames: links(o.requires),
			includesGames: links(o.includes),
			isIncludedInGames: links(o.includedIn)
		}
	};
}

/** One entry of a download list. */
export function file(manualUrl: string, name: string, size = '1 GB', version = '1.0'): unknown {
	return { manualUrl, name, version, date: '', type: 'game', info: 1, size };
}

/** One of GOG's goodies in a details record, with GOG's word for its kind, such as "manuals". */
export function extra(manualUrl: string, name: string, type: string, size = '10 MB'): unknown {
	return { manualUrl, name, type, info: 1, size };
}

export interface ByOs {
	windows?: unknown[];
	mac?: unknown[];
	linux?: unknown[];
}

export interface DetailsOptions {
	english?: ByOs;
	other?: [string, ByOs][];
	dlcs?: { title: string; english: ByOs; extras?: unknown[] }[];
	extras?: unknown[];
}

/** A `gog-details` record. */
export function details(o: DetailsOptions): unknown {
	return {
		title: 'ignored',
		downloads: [...(o.other ?? []), ...(o.english ? [['English', o.english]] : [])],
		extras: o.extras ?? [],
		dlcs: (o.dlcs ?? []).map((d) => ({
			title: d.title,
			downloads: [['English', d.english]],
			extras: d.extras ?? []
		}))
	};
}

const road = '/downloads/the_long_dark_road';

export const records = {
	library,
	apiProducts: {
		'1001': apiProduct({
			title: 'The Long Dark Road',
			genres: ['Role-playing', 'Adventure'],
			tags: ['Atmospheric', 'Story Rich', 'Turn-Based'],
			os: ['windows', 'osx', 'linux'],
			developers: ['Šťastný Studio'],
			publisher: 'Road Works',
			features: ['Single-player', 'Multi-player', 'Co-op', 'Achievements'],
			languages: ['en', 'sk'],
			description:
				'<p>A <b>long</b> road.</p><script>alert(1)</script><img src="x" onerror="alert(1)">',
			screenshots: [SHOT.one, SHOT.two],
			poster: POSTER['1001'],
			banner: BANNER['1001'],
			backdrop: BACKDROP['1001'],
			released: '2002-09-27T00:00:00+02:00',
			store: 'https://www.gog.com/en/game/the_long_dark_road',
			includedIn: ['3001']
		}),
		'1002': apiProduct({
			title: 'Windows Only Game',
			genres: ['Strategy'],
			tags: ['Turn-Based'],
			os: ['windows'],
			developers: ['Small Team'],
			publisher: 'Small Team',
			features: ['Single-player'],
			poster: POSTER['1002'],
			banner: BANNER['1002']
		}),
		'2002': apiProduct({
			title: 'Lonely Expansion',
			type: 'DLC',
			genres: ['Strategy'],
			os: ['windows'],
			poster: POSTER['2002'],
			requires: ['9999']
		}),
		'3001': apiProduct({
			title: 'Road Trilogy',
			type: 'PACK',
			os: ['windows', 'osx', 'linux'],
			includes: ['1001']
		}),
		'1004': apiProduct({
			title: 'Goodie Collection',
			genres: ['Action'],
			poster: POSTER['1004']
		})
	} as Record<string, unknown>,
	details: {
		'1001': details({
			other: [['Deutsch', { windows: [file(`${road}/de1installer0`, 'German build')] }]],
			english: {
				windows: [
					file(`${road}/en1installer0`, 'The Long Dark Road (Part 1 of 3)', '1 MB', '2.1'),
					file(`${road}/en1installer1`, 'The Long Dark Road (Part 2 of 3)', '4 GB', '2.1'),
					file(`${road}/en1installer2`, 'The Long Dark Road (Part 3 of 3)', '3.5 GB', '2.1'),
					file(`${road}/en1patch0`, 'Patch 2.0 to 2.1', '200 MB', '2.1')
				],
				mac: [file(`${road}/en2installer0`, 'The Long Dark Road', '7 GB', '2.1')],
				linux: [file(`${road}/en3installer0`, 'The Long Dark Road', '7 GB', '2.1')]
			},
			extras: [
				extra(`${road}/en0extra0`, 'manual', 'manuals', '12 MB'),
				extra(`${road}/en0extra1`, 'original soundtrack', 'audio', '150 MB'),
				// Listed by GOG, not in the archive.
				extra(`${road}/en0extra2`, 'artbook', 'artworks', '30 MB'),
				// A size vangogh reads as nothing: it never downloads it, and Canvas never asks.
				extra(`${road}/en0extra3`, 'avatars', 'avatars', '0 MB')
			],
			dlcs: [
				{
					title: 'Road Expansion',
					english: {
						windows: [file('/downloads/road_expansion/en1installer0', 'Road Expansion', '500 MB')]
					},
					extras: [extra('/downloads/road_expansion/en0extra0', 'wallpapers', 'wallpapers', '5 MB')]
				}
			]
		}),
		'1002': details({
			english: {
				windows: [file('/downloads/windows_only_game/en1installer0', 'Windows Only Game', '300 MB')]
			}
		}),
		'1004': details({
			extras: [
				{ manualUrl: '/downloads/goodie_collection/en0extra0', name: 'wallpapers', type: 'wallpapers', info: 1, size: '10 MB' },
				{ manualUrl: '/downloads/goodie_collection/en0extra1', name: 'artworks', type: 'artworks', info: 1, size: '20 MB' }
			]
		})
	} as Record<string, unknown>,
	filenames: {
		'1001': {
			[`${road}/en1installer0`]: 'setup_the_long_dark_road_2.1.exe',
			[`${road}/en1installer1`]: 'setup_the_long_dark_road_2.1-1.bin',
			[`${road}/en1installer2`]: 'setup_the_long_dark_road_2.1-2.bin',
			[`${road}/en2installer0`]: 'the_long_dark_road_2.1.pkg',
			[`${road}/en3installer0`]: 'the_long_dark_road_2_1.sh',
			'/downloads/road_expansion/en1installer0': 'setup_road_expansion_1.0.exe'
		},
		'1002': {
			'/downloads/windows_only_game/en1installer0': 'setup_windows_only_game_1.0.exe'
		},
		'1004': {}
	} as Record<string, Record<string, string>>,
	/** The extras vangogh has on disk, by product and address, with the name of the file. vangogh's file names never list them. */
	extraFiles: {
		'1001': {
			[`${road}/en0extra0`]: 'the_long_dark_road_manual.pdf',
			[`${road}/en0extra1`]: 'the_long_dark_road_ost.zip',
			'/downloads/road_expansion/en0extra0': 'road_expansion_wallpapers.zip'
		}
	} as Record<string, Record<string, string>>
};
