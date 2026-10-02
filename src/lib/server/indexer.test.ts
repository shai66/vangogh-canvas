import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createLogger } from './log';
import { RebuildFailed, buildIndex, fileId } from './indexer';
import { apiProduct, details, extra, file, records } from './testing/fixtures';
import {
	VangoghAuthError,
	VangoghHttpError,
	VangoghUnreachable,
	type VangoghSource
} from './vangogh/client';

function source(overrides: Partial<VangoghSource> = {}): VangoghSource {
	return {
		availableProducts: async () => records.library,
		metadata: async (type, id) =>
			(type === 'gog-api-products' ? records.apiProducts[id] : records.details[id]) ?? null,
		filenames: async (id) => records.filenames[id] ?? {},
		fileOnDisk: async ({ productId, manualUrl }) => {
			const names = records.extraFiles[productId] ?? {};
			return Object.hasOwn(names, manualUrl) ? names[manualUrl] : null;
		},
		...overrides
	};
}

function logger() {
	const lines: string[] = [];
	return { lines, log: createLogger((line) => lines.push(line)) };
}

const fixed = () => new Date('2026-09-29T02:30:00.000Z');

describe('buildIndex', () => {
	it('lists games, the orphaned DLC and the broken record, and leaves the pack out', async () => {
		const index = await buildIndex(source(), logger().log, fixed);
		expect(index.entries.map((e) => [e.id, e.kind])).toEqual([
			['1001', 'game'],
			['1002', 'game'],
			['2002', 'orphaned-dlc'],
			['1003', 'game']
		]);
		expect(index.schema).toBe(5);
		expect(index.builtAt).toBe('2026-09-29T02:30:00.000Z');
	});

	it('keeps the position in the library list as the order', async () => {
		const index = await buildIndex(source(), logger().log);
		expect(index.entries.map((e) => e.order)).toEqual([0, 1, 2, 4]);
	});

	it('builds a full list entry', async () => {
		const index = await buildIndex(source(), logger().log);
		expect(index.entries[0]).toEqual({
			id: '1001',
			title: 'The Long Dark Road',
			kind: 'game',
			os: ['windows', 'macos', 'linux'],
			genres: ['Role-playing', 'Adventure'],
			tags: ['Atmospheric', 'Story Rich', 'Turn-Based'],
			developers: ['Šťastný Studio'],
			publisher: 'Road Works',
			multiplayer: true,
			coop: true,
			poster: 'a'.repeat(64),
			banner: '3'.repeat(64),
			releaseYear: 2002,
			dlc: ['Road Expansion'],
			extraKinds: ['manuals', 'audio', 'wallpapers'],
			order: 0,
			complete: true,
			hasFiles: true
		});
	});

	it('hands the wide artwork to the detail only', async () => {
		const index = await buildIndex(source(), logger().log);
		expect(index.details['1001'].backdrop).toBe('5'.repeat(64));
		expect(index.details['1002'].backdrop).toBeNull();
		expect(index.details['1001'].banner).toBe('3'.repeat(64));
		expect(index.entries[0]).not.toHaveProperty('backdrop');
	});

	it('hands the year of the original release to the list entry and the detail', async () => {
		const index = await buildIndex(source(), logger().log);
		expect(index.entries[0].releaseYear).toBe(2002);
		expect(index.details['1001'].releaseYear).toBe(2002);
		expect(index.entries[1].releaseYear).toBeNull();
		expect(index.details['1002'].releaseYear).toBeNull();
	});

	it('hands what GOG says about the macOS installer to the detail only', async () => {
		const old = apiProduct({
			title: 'The Long Dark Road',
			os: ['windows', 'osx', 'linux'],
			additional: '<p>Mac notice: Needs macOS 10.14 or older.</p>'
		});
		const index = await buildIndex(
			source({
				metadata: async (type, id) =>
					type === 'gog-api-products'
						? id === '1001'
							? old
							: (records.apiProducts[id] ?? null)
						: (records.details[id] ?? null)
			}),
			logger().log
		);
		expect(index.details['1001'].macNotice).toBe('Needs macOS 10.14 or older.');
		expect(index.details['1002'].macNotice).toBeNull();
		// A record without metadata has none either.
		expect(index.details['1003'].macNotice).toBeNull();
		expect(index.entries[0]).not.toHaveProperty('macNotice');
	});

	it('hands the address of the game\'s page on GOG.com to the detail only', async () => {
		const index = await buildIndex(source(), logger().log);
		expect(index.details['1001'].storeUrl).toBe('https://www.gog.com/en/game/the_long_dark_road');
		expect(index.details['1002'].storeUrl).toBeNull();
		// A record without metadata has none.
		expect(index.details['1003'].storeUrl).toBeNull();
		expect(index.entries[0]).not.toHaveProperty('storeUrl');
	});

	it('hands the system requirements to the detail only', async () => {
		const withRequirements = apiProduct({
			title: 'The Long Dark Road',
			os: ['windows', 'osx', 'linux'],
			requirements: { windows: { minimum: [['memory', 'Memory:', '4 GB RAM']] } }
		});
		const index = await buildIndex(
			source({
				metadata: async (type, id) =>
					type === 'gog-api-products'
						? id === '1001'
							? withRequirements
							: (records.apiProducts[id] ?? null)
						: (records.details[id] ?? null)
			}),
			logger().log
		);
		expect(index.details['1001'].requirements).toEqual({
			windows: { minimum: [{ id: 'memory', name: 'Memory', text: '4 GB RAM' }], recommended: [] }
		});
		expect(index.details['1002'].requirements).toEqual({});
		// A record without metadata has none.
		expect(index.details['1003'].requirements).toEqual({});
		expect(index.entries[0]).not.toHaveProperty('requirements');
	});

	it('nests the DLC with its files', async () => {
		const index = await buildIndex(source(), logger().log);
		const detail = index.details['1001'];
		expect(detail.dlc).toHaveLength(1);
		expect(detail.dlc[0].title).toBe('Road Expansion');
		expect(detail.dlc[0].downloads.windows?.[0]).toMatchObject({
			filename: 'setup_road_expansion_1.0.exe',
			sizeText: '500 MB',
			run: true
		});
	});

	it('lists a DLC of the library list even when the details do not name it', async () => {
		const index = await buildIndex(
			source({
				metadata: async (type, id) => {
					if (type === 'gog-details' && id === '1001') {
						return details({ english: { windows: [file('/downloads/the_long_dark_road/en1installer0', 'x')] } });
					}
					return (type === 'gog-api-products' ? records.apiProducts[id] : records.details[id]) ?? null;
				}
			}),
			logger().log
		);
		expect(index.entries[0].dlc).toEqual(['Road Expansion']);
		expect(index.details['1001'].dlc).toEqual([{ title: 'Road Expansion', downloads: {} }]);
	});

	it('offers only the files that exist, and marks the first of each system to run', async () => {
		const index = await buildIndex(source(), logger().log);
		const windows = index.details['1001'].downloads.windows ?? [];
		expect(windows.map((f) => [f.filename, f.run])).toEqual([
			['setup_the_long_dark_road_2.1.exe', true],
			['setup_the_long_dark_road_2.1-1.bin', false],
			['setup_the_long_dark_road_2.1-2.bin', false]
		]);
		expect(index.details['1001'].downloads.macos?.[0].run).toBe(true);
		expect(index.details['1001'].downloadLanguage).toBeNull();
	});

	it('uses the last part of a file name that holds a path', async () => {
		const index = await buildIndex(
			source({
				filenames: async (id) =>
					id === '1002'
						? { '/downloads/windows_only_game/en1installer0': 'windows_only_game/setup.exe' }
						: (records.filenames[id] ?? {})
			}),
			logger().log
		);
		expect(index.details['1002'].downloads.windows?.[0].filename).toBe('setup.exe');
		const target = Object.values(index.files).find((t) => t.productId === '1002');
		expect(target?.filename).toBe('setup.exe');
	});

	it('records where each file is in vangogh', async () => {
		const index = await buildIndex(source(), logger().log);
		const first = index.details['1001'].downloads.windows?.[0];
		expect(index.files[`1001/${first?.fileId}`]).toEqual({
			productId: '1001',
			downloadType: 'installer',
			manualUrl: '/downloads/the_long_dark_road/en1installer0',
			filename: 'setup_the_long_dark_road_2.1.exe'
		});
		const dlc = index.details['1001'].dlc[0].downloads.windows?.[0];
		expect(index.files[`1001/${dlc?.fileId}`]).toMatchObject({
			productId: '1001',
			downloadType: 'downloadable-content'
		});
		expect(Object.keys(index.files)).toHaveLength(10);
	});

	it('lists the extras that are on disk, the DLC\'s with the game\'s, by kind', async () => {
		const index = await buildIndex(source(), logger().log);
		expect(index.details['1001'].extras).toEqual([
			{ fileId: fileId('/downloads/the_long_dark_road/en0extra0'), name: 'manual', kind: 'manuals', sizeText: '12 MB', sizeBytes: 12 * 1024 ** 2 },
			{ fileId: fileId('/downloads/the_long_dark_road/en0extra1'), name: 'original soundtrack', kind: 'audio', sizeText: '150 MB', sizeBytes: 150 * 1024 ** 2 },
			{ fileId: fileId('/downloads/road_expansion/en0extra0'), name: 'wallpapers', kind: 'wallpapers', sizeText: '5 MB', sizeBytes: 5 * 1024 ** 2 }
		]);
		expect(index.details['1002'].extras).toEqual([]);
		expect(index.entries.find((e) => e.id === '1002')!.extraKinds).toEqual([]);
	});

	it('records where each extra is in vangogh, under the base game', async () => {
		const index = await buildIndex(source(), logger().log);
		expect(index.files[`1001/${fileId('/downloads/road_expansion/en0extra0')}`]).toEqual({
			productId: '1001',
			downloadType: 'extra',
			manualUrl: '/downloads/road_expansion/en0extra0',
			filename: 'road_expansion_wallpapers.zip'
		});
		// Not on disk: no place.
		expect(index.files[`1001/${fileId('/downloads/the_long_dark_road/en0extra2')}`]).toBeUndefined();
	});

	it('asks only about extras vangogh downloads, of products that are listed', async () => {
		const asked: string[] = [];
		await buildIndex(
			source({
				fileOnDisk: async ({ productId, manualUrl }) => {
					asked.push(`${productId}${manualUrl}`);
					return null;
				}
			}),
			logger().log
		);
		expect(asked.sort()).toEqual([
			'1001/downloads/road_expansion/en0extra0',
			'1001/downloads/the_long_dark_road/en0extra0',
			'1001/downloads/the_long_dark_road/en0extra1',
			'1001/downloads/the_long_dark_road/en0extra2'
		]);
		// Not the extra of "0 MB", and nothing of 1004, which is left out: GOG offers no installer for it.
	});

	it('leaves out the extras of a game vangogh cannot say about, logs it, and builds the rest', async () => {
		const { lines, log } = logger();
		const index = await buildIndex(
			source({
				fileOnDisk: async () => {
					throw new VangoghHttpError(500, '/api/gog/manual-url/…');
				}
			}),
			log
		);
		expect(index.details['1001'].extras).toEqual([]);
		expect(index.entries[0].extraKinds).toEqual([]);
		// The installers are still there.
		expect(index.details['1001'].downloads.windows).toHaveLength(3);
		expect(lines.some((l) => l.includes('extras not available') && l.includes('id=1001'))).toBe(true);
	});

	it('leaves out an extra whose address is refused, without a word, and lists the others', async () => {
		const { lines, log } = logger();
		const base = records.details['1001'] as object;
		const index = await buildIndex(
			source({
				metadata: async (type, id) =>
					type === 'gog-details' && id === '1001'
						? {
								...base,
								dlcs: [],
								extras: [
									extra('/downloads/x/../en0extra0', 'sneaky', 'manuals', '1 MB'),
									extra('/downloads/the_long_dark_road/en0extra0', 'manual', 'manuals', '12 MB')
								]
							}
						: ((type === 'gog-api-products' ? records.apiProducts[id] : records.details[id]) ?? null),
				// What the client answers for an address it refuses.
				fileOnDisk: async ({ manualUrl }) =>
					manualUrl.includes('..') ? null : 'the_long_dark_road_manual.pdf'
			}),
			log
		);
		expect(index.details['1001'].extras.map((e) => e.name)).toEqual(['manual']);
		expect(lines.some((l) => l.includes('extras not available'))).toBe(false);
	});

	it('fails when the extras of more than half of the records cannot be checked', async () => {
		const withExtras = details({
			english: { windows: [file('/downloads/x/en1installer0', 'X')] },
			extras: [extra('/downloads/x/en0extra0', 'manual', 'manuals', '1 MB')]
		});
		const error = await buildIndex(
			source({
				availableProducts: async () => [
					{ id: '1001', tt: 'A', os: [1] },
					{ id: '1002', tt: 'B', os: [1] }
				],
				metadata: async (type, id) => (type === 'gog-api-products' ? (records.apiProducts[id] ?? null) : withExtras),
				filenames: async () => ({ '/downloads/x/en1installer0': 'x.exe' }),
				fileOnDisk: async () => {
					throw new VangoghUnreachable();
				}
			}),
			logger().log
		).catch((e) => e);
		expect(error).toBeInstanceOf(RebuildFailed);
	});

	it('passes a rejected login during the check of the extras on as it is', async () => {
		const error = await buildIndex(
			source({
				fileOnDisk: async () => {
					throw new VangoghAuthError('vangogh rejected the login');
				}
			}),
			logger().log
		).catch((e) => e);
		expect(error).toBeInstanceOf(VangoghAuthError);
	});

	it('sends no address of vangogh to the browser', async () => {
		const index = await buildIndex(source(), logger().log);
		const sent = JSON.stringify([index.entries, index.details]);
		expect(sent).not.toContain('/downloads/');
		expect(sent).not.toContain('manualUrl');
	});

	it('shows an orphaned DLC with what it requires, and logs it', async () => {
		const { lines, log } = logger();
		const index = await buildIndex(source(), log);
		expect(index.details['2002']).toMatchObject({
			kind: 'orphaned-dlc',
			requires: 'GOG product 9999',
			downloads: {}
		});
		expect(lines.some((l) => l.includes('orphaned dlc') && l.includes('id=2002'))).toBe(true);
	});

	it('names the required game when the record gives its title', async () => {
		const raw = apiProduct({ title: 'Lonely Expansion', type: 'DLC' }) as {
			_links: Record<string, unknown>;
		};
		raw._links.requiresGames = [{ href: 'https://api.gog.com/v2/games/9999', title: 'Base Game' }];
		const index = await buildIndex(
			source({
				metadata: async (type, id) =>
					type === 'gog-api-products' && id === '2002'
						? raw
						: ((type === 'gog-api-products' ? records.apiProducts[id] : records.details[id]) ?? null)
			}),
			logger().log
		);
		expect(index.details['2002'].requires).toBe('Base Game');
	});

	it('leaves out a DLC of the list whose base game is owned', async () => {
		const index = await buildIndex(
			source({
				metadata: async (type, id) =>
					type === 'gog-api-products' && id === '2002'
						? apiProduct({ title: 'Lonely Expansion', type: 'DLC', requires: ['1002'] })
						: ((type === 'gog-api-products' ? records.apiProducts[id] : records.details[id]) ?? null)
			}),
			logger().log
		);
		expect(index.entries.map((e) => e.id)).toEqual(['1001', '1002', '1003']);
	});

	it('names the packs a game is part of', async () => {
		const index = await buildIndex(source(), logger().log);
		expect(index.details['1001'].partOf).toEqual(['Road Trilogy']);
		expect(index.details['1002'].partOf).toEqual([]);
	});

	it('lists a pack that has files of its own', async () => {
		const index = await buildIndex(
			source({
				metadata: async (type, id) =>
					type === 'gog-details' && id === '3001'
						? details({ english: { windows: [file('/downloads/road_trilogy/en1installer0', 'Bonus')] } })
						: ((type === 'gog-api-products' ? records.apiProducts[id] : records.details[id]) ?? null),
				filenames: async (id) =>
					id === '3001'
						? { '/downloads/road_trilogy/en1installer0': 'setup_bonus.exe' }
						: (records.filenames[id] ?? {})
			}),
			logger().log
		);
		expect(index.entries.map((e) => e.id)).toContain('3001');
	});

	it('keeps a record without metadata with its title and systems only', async () => {
		const { lines, log } = logger();
		const index = await buildIndex(source(), log);
		expect(index.entries.at(-1)).toMatchObject({
			id: '1003',
			title: 'Broken Record',
			os: ['windows'],
			genres: [],
			poster: null,
			banner: null,
			complete: false
		});
		expect(index.details['1003']).toMatchObject({
			description: '',
			downloads: {},
			backdrop: null,
			releaseYear: null,
			complete: false
		});
		expect(lines.some((l) => l.includes('WARN') && l.includes('id=1003'))).toBe(true);
	});

	it('keeps a game whose record cannot be read', async () => {
		const index = await buildIndex(
			source({
				metadata: async (type, id) => {
					if (id === '1002') throw new VangoghHttpError(500, '/api/metadata');
					return (type === 'gog-api-products' ? records.apiProducts[id] : records.details[id]) ?? null;
				}
			}),
			logger().log
		);
		expect(index.entries.find((e) => e.id === '1002')).toMatchObject({
			title: 'Windows Only Game',
			complete: false
		});
	});

	it('keeps a game complete, without files, when its file names cannot be read', async () => {
		const index = await buildIndex(
			source({
				filenames: async (id) => {
					if (id === '1002') throw new VangoghHttpError(500, '/api/gog/filenames/1002');
					return records.filenames[id] ?? {};
				}
			}),
			logger().log
		);
		expect(index.entries.find((e) => e.id === '1002')?.complete).toBe(true);
		expect(index.details['1002'].downloads).toEqual({});
	});

	it('fails when the file names cannot be read for most records', async () => {
		const library = Array.from({ length: 4 }, (_, i) => ({ id: String(5000 + i), tt: `G${i}`, os: [1] }));
		await expect(
			buildIndex(
				source({
					availableProducts: async () => library,
					metadata: async (type, id) =>
						type === 'gog-api-products'
							? apiProduct({ title: 'x' })
							: details({ english: { windows: [file('/downloads/x/en1installer0', 'x')] } }),
					filenames: async (id) => {
						throw new VangoghHttpError(503, `/api/gog/filenames/${id}`);
					}
				}),
				logger().log
			)
		).rejects.toBeInstanceOf(RebuildFailed);
	});

	it('succeeds when exactly half of the records fail', async () => {
		const library = Array.from({ length: 4 }, (_, i) => ({ id: String(5000 + i), tt: `G${i}`, os: [1] }));
		const index = await buildIndex(
			source({
				availableProducts: async () => library,
				metadata: async (type, id) =>
					type === 'gog-api-products'
						? apiProduct({ title: 'x' })
						: details({ english: { windows: [file('/downloads/x/en1installer0', 'x')] } }),
				filenames: async (id) => {
					if (id === '5000' || id === '5001') throw new VangoghHttpError(503, `/api/gog/filenames/${id}`);
					return { '/downloads/x/en1installer0': 'setup.exe' };
				}
			}),
			logger().log
		);
		expect(index.entries).toHaveLength(4);
	});

	it('fails when more than half of the records fail', async () => {
		const library = Array.from({ length: 4 }, (_, i) => ({ id: String(5000 + i), tt: `G${i}`, os: [1] }));
		await expect(
			buildIndex(
				source({
					availableProducts: async () => library,
					metadata: async (type, id) =>
						type === 'gog-api-products'
							? apiProduct({ title: 'x' })
							: details({ english: { windows: [file('/downloads/x/en1installer0', 'x')] } }),
					filenames: async (id) => {
						if (id === '5000' || id === '5001' || id === '5002') throw new VangoghHttpError(503, `/api/gog/filenames/${id}`);
						return { '/downloads/x/en1installer0': 'setup.exe' };
					}
				}),
				logger().log
			)
		).rejects.toThrow('3 of 4 records could not be read');
	});

	it.each([['constructor'], ['__proto__'], ['toString']])(
		'survives a file whose address is %j, and does not offer it',
		async (manualUrl) => {
			const index = await buildIndex(
				source({
					metadata: async (type, id) =>
						type === 'gog-details' && id === '1002'
							? details({
									english: {
										windows: [
											file(manualUrl, 'Odd'),
											file('/downloads/windows_only_game/en1installer0', 'Fine')
										]
									}
								})
							: ((type === 'gog-api-products' ? records.apiProducts[id] : records.details[id]) ?? null)
				}),
				logger().log
			);
			expect(index.details['1002'].downloads.windows?.map((f) => f.name)).toEqual(['Fine']);
		}
	);

	it('fails when vangogh has no record of any product', async () => {
		await expect(
			buildIndex(source({ metadata: async () => null }), logger().log)
		).rejects.toThrow('6 of 6 records could not be read');
	});

	it('fails when most products have no record', async () => {
		await expect(
			buildIndex(
				source({
					metadata: async (type, id) =>
						id === '1001' || id === '1002'
							? ((type === 'gog-api-products' ? records.apiProducts[id] : records.details[id]) ?? null)
							: null
				}),
				logger().log
			)
		).rejects.toBeInstanceOf(RebuildFailed);
	});

	it('still succeeds when one product has no record', async () => {
		const index = await buildIndex(source(), logger().log);
		expect(records.apiProducts['1003']).toBeUndefined();
		expect(index.entries.find((e) => e.id === '1003')?.complete).toBe(false);
	});

	describe('a product that gog offers no installer for', () => {
		type Records = { product?: (id: string) => unknown; details?: (id: string) => unknown };
		/** The fixture records, with some of them replaced. */
		const changed = (r: Records) =>
			source({
				metadata: async (type, id) => {
					const replace = type === 'gog-api-products' ? r.product : r.details;
					if (replace) {
						const value = replace(id);
						if (value !== undefined) return value;
					}
					return (type === 'gog-api-products' ? records.apiProducts[id] : records.details[id]) ?? null;
				}
			});
		const extrasOnly = details({
			extras: [{ manualUrl: '/downloads/x/en0extra0', name: 'wallpapers', type: 'wallpapers', info: 1, size: '1 MB' }]
		});
		const leftOutLines = (lines: string[]) =>
			lines.filter((l) => l.includes('product left out, gog offers no installer'));

		it('is left out of the entries, the details and the files, and is logged', async () => {
			const { lines, log } = logger();
			const index = await buildIndex(source(), log);
			expect(index.entries.map((e) => e.id)).not.toContain('1004');
			expect(index.details['1004']).toBeUndefined();
			expect(Object.values(index.files).filter((t) => t.productId === '1004')).toEqual([]);
			const logged = leftOutLines(lines);
			expect(logged).toHaveLength(1);
			expect(logged[0]).toContain(' INFO ');
			expect(logged[0]).toContain('id=1004');
			expect(logged[0]).toContain('Goodie Collection');
		});

		it('is not listed and not logged for a product that offers installers', async () => {
			const { lines, log } = logger();
			await buildIndex(source(), log);
			expect(leftOutLines(lines).some((l) => l.includes('id=1001') || l.includes('id=1002'))).toBe(false);
		});

		it('is listed when it has no details record', async () => {
			const { lines, log } = logger();
			const index = await buildIndex(changed({ details: (id) => (id === '1004' ? null : undefined) }), log);
			expect(index.entries.find((e) => e.id === '1004')).toMatchObject({
				kind: 'game',
				complete: true,
				hasFiles: false
			});
			expect(leftOutLines(lines)).toEqual([]);
		});

		it('is listed when its details record could not be fetched', async () => {
			const { lines, log } = logger();
			const index = await buildIndex(
				changed({
					details: (id) => {
						if (id === '1004') throw new VangoghHttpError(500, '/api/metadata/gog-details/1004');
					}
				}),
				log
			);
			expect(index.entries.find((e) => e.id === '1004')).toMatchObject({ complete: false, hasFiles: false });
			expect(leftOutLines(lines)).toEqual([]);
		});

		it('is listed when its product record is broken', async () => {
			const { lines, log } = logger();
			const index = await buildIndex(changed({ product: (id) => (id === '1004' ? null : undefined) }), log);
			expect(index.entries.find((e) => e.id === '1004')).toMatchObject({
				title: 'Goodie Collection',
				complete: false,
				hasFiles: false
			});
			expect(leftOutLines(lines)).toEqual([]);
		});

		it('is listed when its file names could not be read, and it offers installers', async () => {
			const index = await buildIndex(
				source({
					filenames: async (id) => {
						if (id === '1002') throw new VangoghHttpError(500, '/api/gog/filenames/1002');
						return records.filenames[id] ?? {};
					}
				}),
				logger().log
			);
			expect(index.entries.find((e) => e.id === '1002')).toMatchObject({ complete: true, hasFiles: false });
		});

		it('is listed when it is an orphaned DLC', async () => {
			const { lines, log } = logger();
			const index = await buildIndex(changed({ details: (id) => (id === '2002' ? extrasOnly : undefined) }), log);
			expect(index.entries.find((e) => e.id === '2002')).toMatchObject({
				kind: 'orphaned-dlc',
				hasFiles: false
			});
			expect(index.details['2002']).toBeDefined();
			expect(leftOutLines(lines).some((l) => l.includes('id=2002'))).toBe(false);
		});

		it('is not the reason a DLC is nested: the DLC rule comes first', async () => {
			const { lines, log } = logger();
			const index = await buildIndex(
				changed({
					product: (id) =>
						id === '2002' ? apiProduct({ title: 'Lonely Expansion', type: 'DLC', requires: ['1002'] }) : undefined,
					details: (id) => (id === '2002' ? extrasOnly : undefined)
				}),
				log
			);
			expect(index.entries.map((e) => e.id)).not.toContain('2002');
			expect(lines.some((l) => l.includes('dlc is nested under its game') && l.includes('id=2002'))).toBe(true);
			expect(leftOutLines(lines).some((l) => l.includes('id=2002'))).toBe(false);
		});

		it('leaves a pack out under the rule of packs, and says so', async () => {
			const { lines, log } = logger();
			const index = await buildIndex(changed({ details: (id) => (id === '3001' ? extrasOnly : undefined) }), log);
			expect(index.entries.map((e) => e.id)).not.toContain('3001');
			expect(lines.some((l) => l.includes('pack left out of the list') && l.includes('id=3001'))).toBe(true);
			expect(leftOutLines(lines).some((l) => l.includes('id=3001'))).toBe(false);
		});

		it('is listed and without files when gog offers installers and the archive holds none', async () => {
			const { lines, log } = logger();
			const index = await buildIndex(
				source({ filenames: async (id) => (id === '1002' ? {} : (records.filenames[id] ?? {})) }),
				log
			);
			expect(index.entries.find((e) => e.id === '1002')).toMatchObject({ complete: true, hasFiles: false });
			expect(index.details['1002'].downloads).toEqual({});
			expect(leftOutLines(lines).some((l) => l.includes('id=1002'))).toBe(false);
		});

		it('has files when only its DLC has files', async () => {
			const index = await buildIndex(
				source({
					filenames: async (id) =>
						id === '1001'
							? { '/downloads/road_expansion/en1installer0': 'setup_road_expansion_1.0.exe' }
							: (records.filenames[id] ?? {})
				}),
				logger().log
			);
			expect(index.details['1001'].downloads).toEqual({});
			expect(index.entries[0]).toMatchObject({ id: '1001', hasFiles: true });
		});

		it('does not count as a failed record for the threshold, also when its file names cannot be read', async () => {
			const library = Array.from({ length: 4 }, (_, i) => ({ id: String(5000 + i), tt: `G${i}`, os: [1] }));
			const { lines, log } = logger();
			const index = await buildIndex(
				source({
					availableProducts: async () => library,
					metadata: async (type, id) =>
						type === 'gog-api-products'
							? apiProduct({ title: 'x' })
							: id === '5003'
								? details({ english: { windows: [file('/downloads/x/en1installer0', 'x')] } })
								: extrasOnly,
					filenames: async (id) => {
						if (id === '5003') return { '/downloads/x/en1installer0': 'setup.exe' };
						throw new VangoghHttpError(503, `/api/gog/filenames/${id}`);
					}
				}),
				log
			);
			expect(index.entries.map((e) => e.id)).toEqual(['5003']);
			expect(leftOutLines(lines)).toHaveLength(3);
			expect(lines.filter((l) => l.includes('file names not available'))).toHaveLength(3);
		});

		it('leaves a gap in the order', async () => {
			const list = records.library as { id: string }[];
			const pick = (id: string) => list.find((p) => p.id === id);
			const index = await buildIndex(
				source({ availableProducts: async () => [pick('1001'), pick('1004'), pick('1002')] }),
				logger().log
			);
			expect(index.entries.map((e) => [e.id, e.order])).toEqual([
				['1001', 0],
				['1002', 2]
			]);
		});
	});

	it('says of every entry whether it has files', async () => {
		const index = await buildIndex(source(), logger().log);
		for (const entry of index.entries) {
			expect(typeof entry.hasFiles).toBe('boolean');
			expect(index.details[entry.id].hasFiles).toBe(entry.hasFiles);
		}
		expect(Object.fromEntries(index.entries.map((e) => [e.id, e.hasFiles]))).toEqual({
			'1001': true,
			'1002': true,
			'2002': false,
			'1003': false
		});
	});

	it('does not ask for file names of a product without details', async () => {
		const asked: string[] = [];
		await buildIndex(
			source({
				filenames: async (id) => {
					asked.push(id);
					return records.filenames[id] ?? {};
				}
			}),
			logger().log
		);
		// 1004 has a details record, so its file names are asked for.
		expect(asked.sort()).toEqual(['1001', '1002', '1004']);
	});

	it('names the language when the downloads are not English', async () => {
		const index = await buildIndex(
			source({
				metadata: async (type, id) =>
					type === 'gog-details' && id === '1002'
						? details({ other: [['Deutsch', { windows: [file('/downloads/windows_only_game/en1installer0', 'x')] }]] })
						: ((type === 'gog-api-products' ? records.apiProducts[id] : records.details[id]) ?? null)
			}),
			logger().log
		);
		expect(index.details['1002'].downloadLanguage).toBe('Deutsch');
	});

	it('gives the same version and file ids for the same data', async () => {
		const one = await buildIndex(source(), logger().log, fixed);
		const two = await buildIndex(source(), logger().log, () => new Date('2026-09-30T02:30:00Z'));
		expect(two.version).toBe(one.version);
		expect(Object.keys(two.files)).toEqual(Object.keys(one.files));
		expect(one.version).toMatch(/^[0-9a-f]{16}$/);
	});

	it('gives another version when the data changes', async () => {
		const one = await buildIndex(source(), logger().log);
		const two = await buildIndex(
			source({ availableProducts: async () => (records.library as unknown[]).slice(0, 2) }),
			logger().log
		);
		expect(two.version).not.toBe(one.version);
	});

	it('runs at most four products at a time', async () => {
		const library = Array.from({ length: 12 }, (_, i) => ({ id: String(5000 + i), tt: `G${i}`, os: [1] }));
		let running = 0;
		let most = 0;
		await buildIndex(
			source({
				availableProducts: async () => library,
				metadata: async (type) => {
					if (type !== 'gog-api-products') return null;
					most = Math.max(most, ++running);
					await new Promise((resolve) => setTimeout(resolve, 5));
					running--;
					return apiProduct({ title: 'x' });
				}
			}),
			logger().log
		);
		expect(most).toBe(4);
	});

	// Review focus 2
	it.each([
		['is empty', []],
		['is not a list', { error: 'x' }],
		['is null', null]
	])('fails when the library list %s', async (_name, list) => {
		await expect(
			buildIndex(source({ availableProducts: async () => list }), logger().log)
		).rejects.toBeInstanceOf(RebuildFailed);
	});

	it('fails when the library list cannot be fetched', async () => {
		await expect(
			buildIndex(
				source({
					availableProducts: async () => {
						throw new VangoghUnreachable();
					}
				}),
				logger().log
			)
		).rejects.toBeInstanceOf(RebuildFailed);
	});

	// Review focus 1
	it('fails when vangogh goes away half way through', async () => {
		let calls = 0;
		await expect(
			buildIndex(
				source({
					metadata: async () => {
						throw new VangoghUnreachable();
					}
				}),
				logger().log
			)
		).rejects.toBeInstanceOf(RebuildFailed);
		await expect(
			buildIndex(
				source({
					metadata: async (type, id) => {
						if (++calls > 2) throw new VangoghUnreachable();
						return (type === 'gog-api-products' ? records.apiProducts[id] : records.details[id]) ?? null;
					}
				}),
				logger().log
			)
		).rejects.toThrow(/^\d of 6 records could not be read$/);
	});

	it('passes a rejected login on as it is', async () => {
		await expect(
			buildIndex(
				source({
					metadata: async () => {
						throw new VangoghAuthError('vangogh rejected the login');
					}
				}),
				logger().log
			)
		).rejects.toBeInstanceOf(VangoghAuthError);
		await expect(
			buildIndex(
				source({
					availableProducts: async () => {
						throw new VangoghAuthError('vangogh rejected the login');
					}
				}),
				logger().log
			)
		).rejects.toBeInstanceOf(VangoghAuthError);
	});
});

describe('fileId', () => {
	it('is stable, short and tells files apart', () => {
		expect(fileId('/downloads/a/en1installer0')).toBe(fileId('/downloads/a/en1installer0'));
		expect(fileId('/downloads/a/en1installer0')).not.toBe(fileId('/downloads/a/en1installer1'));
		expect(fileId('/downloads/a/en1installer0')).toMatch(/^[0-9a-f]{16}$/);
	});
});

describe.skipIf(!existsSync('samples/available-products.json'))('buildIndex on the real samples', () => {
	const read = (path: string): unknown | null =>
		existsSync(`samples/${path}`) ? JSON.parse(readFileSync(`samples/${path}`, 'utf8')) : null;

	const samples: VangoghSource = {
		availableProducts: async () => read('available-products.json'),
		metadata: async (type, id) => read(`metadata/${type}/${id}.json`),
		filenames: async (id) => {
			const names = read(`filenames/${id}.json`);
			if (names === null) throw new VangoghHttpError(500, `/api/gog/filenames/${id}`);
			return names as Record<string, string>;
		},
		// The samples do not say what is on disk.
		fileOnDisk: async () => null
	};

	it('builds an index in which a game has files exactly when vangogh names some, and leaves out what gog offers no installer for', async () => {
		const { lines, log } = logger();
		const index = await buildIndex(samples, log);
		const library = read('available-products.json') as { id: string }[];
		const listed = new Set(index.entries.map((e) => e.id));

		// A file with an address, under any language and system, of a record or of its DLC.
		const lists = (node: unknown): boolean => {
			if (typeof node !== 'object' || node === null) return false;
			const record = node as { downloads?: unknown; dlcs?: unknown };
			const own = (Array.isArray(record.downloads) ? record.downloads : []).some(
				(pair) =>
					Array.isArray(pair) &&
					Object.values((pair[1] ?? {}) as Record<string, unknown>).some(
						(files) =>
							Array.isArray(files) &&
							files.some((f) => typeof (f as { manualUrl?: unknown })?.manualUrl === 'string' && (f as { manualUrl: string }).manualUrl !== '')
					)
			);
			return own || (Array.isArray(record.dlcs) ? record.dlcs : []).some(lists);
		};
		const nested = new Set(
			lines.filter((l) => l.includes('dlc is nested')).map((l) => /id=(\S+)/.exec(l)?.[1] ?? '')
		);
		const packsOut = new Set(
			lines.filter((l) => l.includes('pack left out')).map((l) => /id=(\S+)/.exec(l)?.[1] ?? '')
		);
		const gogOffersNone = new Set(
			lines
				.filter((l) => l.includes('product left out, gog offers no installer'))
				.map((l) => /id=(\S+)/.exec(l)?.[1] ?? '')
		);

		const games = index.entries.filter((e) => e.kind === 'game' && e.complete);
		console.log(
			`${index.entries.length} entries, ${Object.keys(index.files).length} files, ` +
				`${index.entries.filter((e) => e.kind === 'orphaned-dlc').length} orphaned DLC, ` +
				`${index.entries.filter((e) => !e.complete).length} incomplete, ` +
				`${lines.filter((l) => l.includes(' WARN ')).length} warnings, ` +
				`${gogOffersNone.size} left out, ` +
				`${games.filter((e) => !e.hasFiles).length} complete games without files`
		);

		// Counted from the raw samples, independently of the indexer and of the mapper.
		const listsInstaller = (node: unknown): boolean => {
			if (Array.isArray(node)) return node.some(listsInstaller);
			if (typeof node !== 'object' || node === null) return false;
			return Object.entries(node).some(([key, value]) => {
				if (key === 'extras') return false;
				if (key === 'manualUrl') return typeof value === 'string' && value !== '';
				return listsInstaller(value);
			});
		};
		const isGame = (id: string) => {
			const record = read(`metadata/gog-api-products/${id}.json`) as { _embedded?: { productType?: unknown } } | null;
			return String(record?._embedded?.productType ?? '').toUpperCase() === 'GAME';
		};
		const expectedOut = library
			.map((p) => p.id)
			.filter((id) => {
				const record = read(`metadata/gog-details/${id}.json`) as { downloads?: unknown; dlcs?: unknown } | null;
				return isGame(id) && record !== null && !listsInstaller([record.downloads, record.dlcs]);
			})
			.sort();
		expect([...gogOffersNone].sort()).toEqual(expectedOut);
		expect(expectedOut.filter((id) => listed.has(id))).toEqual([]);
		const missing = library
			.map((p) => p.id)
			.filter((id) => !expectedOut.includes(id) && !nested.has(id) && !packsOut.has(id) && !listed.has(id));
		expect(missing).toEqual([]);

		// Every product of the library is an entry, a nested DLC, a pack left out, or left out because gog offers no installer.
		expect(index.entries.length + nested.size + packsOut.size + gogOffersNone.size).toBe(library.length);
		for (const id of gogOffersNone) {
			expect(listed.has(id)).toBe(false);
			expect(lists(read(`metadata/gog-details/${id}.json`))).toBe(false);
		}

		const mismatched: string[] = [];
		for (const entry of index.entries.filter((e) => e.complete)) {
			const filenamesRecord = read(`filenames/${entry.id}.json`) as Record<string, string> | null;
			const named = filenamesRecord !== null && Object.keys(filenamesRecord).length > 0;
			if (entry.hasFiles !== named) mismatched.push(entry.id);
		}

		expect(games.length).toBeGreaterThan(0);
		expect(mismatched).toEqual([]);
	});
});
