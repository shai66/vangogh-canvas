import { describe, expect, it } from 'vitest';
import { details, file, records } from '../testing/fixtures';
import { mapDetails } from './downloads';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

describe('mapDetails', () => {
	const mapped = mapDetails(records.details['1001']);

	it('takes the English downloads and groups them by system', () => {
		expect(mapped.downloads.language).toBeNull();
		expect(Object.keys(mapped.downloads.byOs)).toEqual(['windows', 'macos', 'linux']);
		expect(mapped.downloads.byOs.windows).toHaveLength(4);
		expect(mapped.downloads.byOs.macos).toHaveLength(1);
	});

	it('maps a file', () => {
		expect(mapped.downloads.byOs.windows?.[1]).toEqual({
			manualUrl: '/downloads/the_long_dark_road/en1installer1',
			name: 'The Long Dark Road (Part 2 of 3)',
			version: '2.1',
			sizeText: '4 GB',
			sizeBytes: 4 * 1024 ** 3
		});
	});

	it('keeps the order of the files', () => {
		expect(mapped.downloads.byOs.windows?.map((f) => f.manualUrl.split('/').pop())).toEqual([
			'en1installer0',
			'en1installer1',
			'en1installer2',
			'en1patch0'
		]);
	});

	it('maps the DLC', () => {
		expect(mapped.dlcs).toHaveLength(1);
		expect(mapped.dlcs[0].title).toBe('Road Expansion');
		expect(mapped.dlcs[0].downloads.byOs.windows?.[0].manualUrl).toBe(
			'/downloads/road_expansion/en1installer0'
		);
	});

	it('uses the first language and names it when there is no English', () => {
		const raw = details({
			other: [
				['Deutsch', { windows: [file('/downloads/x/de1installer0', 'X')] }],
				['polski', { windows: [file('/downloads/x/pl1installer0', 'X')] }]
			]
		});
		const { downloads } = mapDetails(raw);
		expect(downloads.language).toBe('Deutsch');
		expect(downloads.byOs.windows?.[0].manualUrl).toBe('/downloads/x/de1installer0');
	});

	it('takes the first language with files when the English entry has none', () => {
		const raw = {
			downloads: [
				['English', { windows: [], mac: [{ name: 'no address' }] }],
				['Deutsch', { windows: [file('/downloads/x/de1installer0', 'X')] }],
				['polski', { windows: [file('/downloads/x/pl1installer0', 'X')] }]
			]
		};
		const { downloads } = mapDetails(raw);
		expect(downloads.language).toBe('Deutsch');
		expect(downloads.byOs.windows?.map((f) => f.manualUrl)).toEqual(['/downloads/x/de1installer0']);
	});

	it('still prefers English when it has files, wherever it is in the list', () => {
		const raw = details({
			other: [['Deutsch', { windows: [file('/downloads/x/de1installer0', 'X')] }]],
			english: { linux: [file('/downloads/x/en1installer0', 'X')] }
		});
		const { downloads } = mapDetails(raw);
		expect(downloads.language).toBeNull();
		expect(Object.keys(downloads.byOs)).toEqual(['linux']);
	});

	it('finds DLC nested inside DLC', () => {
		const raw = {
			downloads: [],
			dlcs: [{ title: 'Outer', downloads: [], dlcs: [{ title: 'Inner', downloads: [] }] }]
		};
		expect(mapDetails(raw).dlcs.map((d) => d.title)).toEqual(['Outer', 'Inner']);
	});

	it('skips entries without an address, unknown systems and repeated files', () => {
		const raw = {
			downloads: [
				[
					'English',
					{
						windows: [file('/downloads/x/a', 'A'), file('/downloads/x/a', 'A again'), { name: 'none' }, null],
						amiga: [file('/downloads/x/b', 'B')]
					}
				]
			]
		};
		const { byOs } = mapDetails(raw).downloads;
		expect(Object.keys(byOs)).toEqual(['windows']);
		expect(byOs.windows?.map((f) => f.name)).toEqual(['A']);
	});

	it('ignores systems named like the properties of an object', () => {
		const raw = {
			downloads: [
				[
					'English',
					{
						constructor: [file('/downloads/x/a', 'A')],
						toString: [file('/downloads/x/b', 'B')],
						linux: [file('/downloads/x/c', 'C')]
					}
				]
			]
		};
		const { byOs } = mapDetails(raw).downloads;
		expect(Object.keys(byOs)).toEqual(['linux']);
		expect(byOs.linux?.map((f) => f.name)).toEqual(['C']);
	});

	it.each([[null], [undefined], ['text'], [[]], [{}], [{ downloads: 'x', dlcs: {} }], [{ downloads: [['English']] }]])(
		'survives %j',
		(raw) => {
			expect(mapDetails(raw)).toEqual({
				downloads: { language: null, byOs: {} },
				dlcs: [],
				offersInstallers: false
			});
		}
	);
});

describe('offersInstallers', () => {
	const x = (name: string) => file(`/downloads/x/${name}`, 'X');

	it.each([
		['a record with files', mapDetails(records.details['1002'])],
		[
			'files only in a language that is not English',
			mapDetails(details({ other: [['Deutsch', { windows: [x('de1installer0')] }]] }))
		],
		[
			'files only in a language that is not chosen',
			mapDetails({
				downloads: [
					['English', { windows: [{ name: 'no address' }] }],
					['Deutsch', { linux: [x('de3installer0')] }]
				]
			})
		],
		[
			'files only of a DLC',
			mapDetails(details({ dlcs: [{ title: 'Add-on', english: { windows: [x('en1installer0')] } }] }))
		],
		[
			'files only of a DLC nested in a DLC',
			mapDetails({
				downloads: [],
				dlcs: [
					{ title: 'Outer', downloads: [], dlcs: [{ title: 'Inner', downloads: [['English', { mac: [x('a')] }]] }] }
				]
			})
		],
		['the system osx', mapDetails({ downloads: [['English', { osx: [x('a')] }]] })]
	])('is true for %s', (_name, mapped) => {
		expect(mapped.offersInstallers).toBe(true);
	});

	it.each([
		[
			'an empty list of downloads and extras',
			details({
				extras: [{ manualUrl: '/downloads/x/en0extra0', name: 'wallpapers', type: 'wallpapers', info: 1, size: '1 MB' }]
			})
		],
		['a language whose systems are all empty', { downloads: [['English', { windows: [], mac: [], linux: [] }]] }],
		['only a system that is not known', { downloads: [['English', { amiga: [x('a')] }]] }],
		['entries without an address', { downloads: [['English', { windows: [{ name: 'none' }, { manualUrl: '' }] }]] }],
		[
			'extras that carry an address, beside DLC without any',
			{
				downloads: [],
				extras: [{ manualUrl: '/downloads/x/en0extra0', name: 'w' }],
				dlcs: [{ title: 'Add-on', downloads: [], extras: [{ manualUrl: '/downloads/x/en0extra1' }] }]
			}
		]
	])('is false for %s', (_name, raw) => {
		expect(mapDetails(raw).offersInstallers).toBe(false);
	});

	it('is false for the record of 1004 of the fixtures', () => {
		expect(mapDetails(records.details['1004']).offersInstallers).toBe(false);
	});
});

const sampleDir = 'samples/metadata/gog-details';

describe.skipIf(!existsSync(sampleDir))('mapDetails on the real samples', () => {
	const files = existsSync(sampleDir) ? readdirSync(sampleDir).filter((name) => name.endsWith('.json')) : [];

	it('finds files for nearly every record', () => {
		const without = files.filter((name) => {
			const mapped = mapDetails(JSON.parse(readFileSync(`${sampleDir}/${name}`, 'utf8')));
			return Object.keys(mapped.downloads.byOs).length === 0;
		});
		expect(without.length).toBeLessThan(files.length * 0.1);
	});

	it('reads a size for every file', () => {
		const unreadable: string[] = [];
		for (const name of files) {
			const mapped = mapDetails(JSON.parse(readFileSync(`${sampleDir}/${name}`, 'utf8')));
			const all = [mapped.downloads, ...mapped.dlcs.map((d) => d.downloads)];
			for (const downloads of all) {
				for (const list of Object.values(downloads.byOs)) {
					for (const f of list) if (f.sizeBytes === 0) unreadable.push(`${name}: "${f.sizeText}"`);
				}
			}
		}
		expect(unreadable).toEqual([]);
	});
});
