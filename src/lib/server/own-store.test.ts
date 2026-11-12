import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from './log';
import { mendOwn, OWN_FILE, OwnStore } from './own-store';

let folder: string;
let lines: string[];
const ownStore = (dir = folder) => new OwnStore({ dir, log: createLogger((line) => lines.push(line)) });
const warnings = () => lines.filter((line) => line.includes(' WARN '));
const writeOwn = (content: object | string) =>
	writeFile(join(folder, OWN_FILE), typeof content === 'string' ? content : JSON.stringify(content));

beforeEach(async () => {
	folder = await mkdtemp(join(tmpdir(), 'canvas-own-'));
	lines = [];
});
afterEach(async () => {
	await rm(folder, { recursive: true, force: true });
});

describe('mendOwn', () => {
	const mend = (raw: unknown) => {
		const warned: string[] = [];
		return { ...mendOwn(raw, (what) => warned.push(what)), warned };
	};

	it('reads a valid file as it is', () => {
		const collections = [
			{ id: 'h1', name: 'Rainy Sundays', members: [{ game: '11' }, { collection: 's5' }] },
			{ id: 'h3', name: 'Ferries', members: [] }
		];
		expect(mend({ version: 1, next: 4, collections })).toEqual({ next: 4, collections, warned: [] });
	});

	it('leaves out a collection that is not an object, or has a bad or repeated id or name', () => {
		const { collections, warned } = mend({
			version: 1,
			next: 9,
			collections: [
				{ id: 'h1', name: '  Rainy  ', members: [] },
				'h2',
				{ id: 's2', name: 'Not own', members: [] },
				{ id: 'h4', name: '   ', members: [] },
				{ id: 'h1', name: 'Again', members: [] },
				{ id: 'h5', name: 'rainy', members: [] },
				{ id: 'h6', name: 'Kept', members: [] }
			]
		});
		// The name trimmed.
		expect(collections).toEqual([
			{ id: 'h1', name: 'Rainy', members: [] },
			{ id: 'h6', name: 'Kept', members: [] }
		]);
		expect(warned).toEqual(['collections[1]', 'collections[2]', 'collections[3]', 'collections[4]', 'collections[5]']);
	});

	it('drops a member that is not valid or is repeated, and keeps the rest', () => {
		const { collections, warned } = mend({
			version: 1,
			next: 2,
			collections: [
				{
					id: 'h1',
					name: 'Rainy',
					members: [{ game: '11' }, { collection: 'h3' }, { game: '11' }, { game: 12 }, { collection: 'p7' }]
				},
				{ id: 'h2', name: 'No list', members: 'none' }
			]
		});
		expect(collections).toEqual([
			{ id: 'h1', name: 'Rainy', members: [{ game: '11' }, { collection: 'p7' }] },
			{ id: 'h2', name: 'No list', members: [] }
		]);
		expect(warned).toEqual(['collections[0].members[1]', 'collections[0].members[2]', 'collections[0].members[3]', 'collections[1].members']);
	});

	it('takes the larger of the stored next and one more than the highest id', () => {
		const one = [{ id: 'h7', name: 'A', members: [] }];
		expect(mend({ version: 1, next: 12, collections: one }).next).toBe(12);
		expect(mend({ version: 1, next: 3, collections: one }).next).toBe(8);
		expect(mend({ version: 1, next: 1, collections: [] }).next).toBe(1);
	});

	it('mends a next that is not a whole number from one, with a warning', () => {
		expect(mend({ version: 1, next: 'four', collections: [{ id: 'h2', name: 'A', members: [] }] })).toMatchObject({
			next: 3,
			warned: ['next']
		});
		expect(mend({ version: 1, next: 0, collections: [] })).toMatchObject({ next: 1, warned: ['next'] });
		expect(mend({ version: 1, next: 2.5, collections: [] })).toMatchObject({ next: 1, warned: ['next'] });
	});

	it('reads a file that is not an object, or has no list, as no collections', () => {
		expect(mend([])).toEqual({ next: 1, collections: [], warned: ['file'] });
		expect(mend({ version: 1, next: 5, collections: {} })).toEqual({ next: 5, collections: [], warned: ['collections'] });
	});

	it('leaves out a collection whose id number is not a safe integer, so that next stays safe', () => {
		expect(
			mend({
				version: 1,
				next: 3,
				collections: [
					{ id: 'h2', name: 'A', members: [] },
					{ id: 'h9007199254740993', name: 'Too far', members: [] }
				]
			})
		).toEqual({ next: 3, collections: [{ id: 'h2', name: 'A', members: [] }], warned: ['collections[1]'] });
	});
});

describe('OwnStore', () => {
	let store: OwnStore;

	beforeEach(() => {
		store = ownStore();
	});

	it('reads no file as no collections', async () => {
		await store.load();
		expect(store.all()).toEqual([]);
		expect(warnings()).toEqual([]);
	});

	it('mends a file: a bad collection and a bad member go, with warnings', async () => {
		await writeOwn({
			version: 1,
			next: 3,
			collections: [
				{ id: 'h1', name: 'Rainy', members: [{ game: '11' }, { collection: 'h3' }, { collection: 's5' }] },
				{ id: 'x', name: 'Broken', members: [{ game: '12' }] }
			]
		});
		await store.load();
		expect(store.all()).toEqual([{ id: 'h1', name: 'Rainy', members: [{ game: '11' }, { collection: 's5' }] }]);
		expect(warnings()).toHaveLength(2);
		expect(warnings().map((line) => line.match(/ part=(\S+)/)?.[1])).toEqual(['collections[0].members[1]', 'collections[1]']);
	});

	describe('a file that cannot be read, is not JSON or is not an object', () => {
		/** The names in the folder other than the file itself: the copy set aside. */
		const asides = async () => (await readdir(folder)).filter((name) => name !== OWN_FILE);

		for (const [what, content] of [
			['not JSON', '{'],
			['empty', ''],
			['a list', '[{"id":"h1","name":"A","members":[]}]'],
			['null', 'null'],
			['a string', '"collections"']
		] as const) {
			it(`sets one that is ${what} aside with a warning naming both, starts empty, and a create writes a new file`, async () => {
				await writeOwn(content);
				await store.load();
				expect(store.all()).toEqual([]);
				const [aside] = await asides();
				expect(aside).toMatch(/^collections\.json\.unreadable-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z$/);
				expect(warnings()).toHaveLength(1);
				expect(warnings()[0]).toContain(`file=${join(folder, OWN_FILE)}`);
				expect(warnings()[0]).toContain(`aside=${join(folder, aside)}`);
				// Next is 1, and the new file is written beside the copy, which keeps the old bytes.
				expect(await store.create({ name: 'A', members: [] })).toEqual({ ok: true, collection: { id: 'h1', name: 'A', members: [] } });
				expect(JSON.parse(await readFile(join(folder, OWN_FILE), 'utf8'))).toEqual({ version: 1, next: 2, collections: [{ id: 'h1', name: 'A', members: [] }] });
				expect(await asides()).toEqual([aside]);
				expect(await readFile(join(folder, aside), 'utf8')).toBe(content);
			});
		}

		it('sets one that cannot be read aside: a folder in its place', async () => {
			await mkdir(join(folder, OWN_FILE));
			await writeFile(join(folder, OWN_FILE, 'inside'), 'kept');
			await store.load();
			expect(store.all()).toEqual([]);
			const [aside] = await asides();
			expect(aside).toMatch(/^collections\.json\.unreadable-/);
			expect(warnings()).toHaveLength(1);
			expect(warnings()[0]).toContain(`aside=${join(folder, aside)}`);
			expect(await store.create({ name: 'A', members: [] })).toMatchObject({ ok: true });
			expect(await readFile(join(folder, aside, 'inside'), 'utf8')).toBe('kept');
		});

		// Root may rename in a folder it cannot write.
		it.skipIf(process.getuid?.() === 0)('refuses every change when it cannot be set aside, and leaves it as it is', async () => {
			await writeOwn('{');
			await chmod(folder, 0o555);
			try {
				await store.load();
				expect(await store.create({ name: 'A', members: [] })).toEqual({ ok: false, error: 'unwritable' });
				expect(warnings()[0]).toContain('cannot be set aside');
			} finally {
				await chmod(folder, 0o755);
			}
			expect(await readdir(folder)).toEqual([OWN_FILE]);
			expect(await readFile(join(folder, OWN_FILE), 'utf8')).toBe('{');
		});
	});

	describe('a file written by a newer Canvas', () => {
		const newer = JSON.stringify({
			version: 2,
			next: 4,
			collections: [
				{ id: 'h1', name: 'Rainy', members: [{ game: '11' }], colour: 'blue' },
				{ id: 'h3', name: 'Ferries', members: [{ game: '12' }, { shelf: 'top' }] }
			]
		});

		it('is read as far as it can be, with a warning that a newer Canvas wrote it', async () => {
			await writeOwn(newer);
			await store.load();
			expect(store.all()).toEqual([
				{ id: 'h1', name: 'Rainy', members: [{ game: '11' }] },
				{ id: 'h3', name: 'Ferries', members: [{ game: '12' }] }
			]);
			expect(warnings().filter((line) => line.includes('newer'))).toHaveLength(1);
			expect(warnings().find((line) => line.includes('newer'))).toContain(`file=${join(folder, OWN_FILE)}`);
		});

		it('refuses every change as unwritable and leaves the file byte for byte', async () => {
			await writeOwn(newer);
			await store.load();
			expect(await store.create({ name: 'New', members: [] })).toEqual({ ok: false, error: 'unwritable' });
			expect(await store.change('h1', { name: 'Sunny' })).toEqual({ ok: false, error: 'unwritable' });
			expect(await store.change('h1', { add: [{ game: '13' }] })).toEqual({ ok: false, error: 'unwritable' });
			expect(await store.remove('h3')).toEqual({ ok: false, error: 'unwritable' });
			expect(await readFile(join(folder, OWN_FILE), 'utf8')).toBe(newer);
			expect(await readdir(folder)).toEqual([OWN_FILE]);
			expect(store.all().map((c) => c.name)).toEqual(['Rainy', 'Ferries']);
		});
	});

	it('creates h1, then h2, and never reuses a number after a delete', async () => {
		await store.load();
		const first = await store.create({ name: 'A', members: [] });
		expect(first.ok && first.collection.id).toBe('h1');
		expect(await store.remove('h1')).toEqual({ ok: true });
		expect(store.all()).toEqual([]);
		const second = await store.create({ name: 'B', members: [] });
		expect(second.ok && second.collection.id).toBe('h2');
		// Not after a restart either.
		await store.remove('h2');
		const again = ownStore();
		await again.load();
		const third = await again.create({ name: 'C', members: [] });
		expect(third.ok && third.collection.id).toBe('h3');
	});

	it('refuses a taken name, letter case ignored', async () => {
		await store.load();
		await store.create({ name: 'A', members: [] });
		expect(await store.create({ name: 'a', members: [] })).toEqual({ ok: false, error: 'name-taken' });
		expect(store.all()).toEqual([{ id: 'h1', name: 'A', members: [] }]);
	});

	it('renames, but not to a name another collection has', async () => {
		await store.load();
		await store.create({ name: 'Rainy', members: [] });
		await store.create({ name: 'Ferries', members: [] });
		expect(await store.change('h2', { name: 'RAINY' })).toEqual({ ok: false, error: 'name-taken' });
		// Its own name in another letter case is not taken.
		expect(await store.change('h1', { name: 'RAINY' })).toEqual({ ok: true, collection: { id: 'h1', name: 'RAINY', members: [] } });
		expect(store.get('h1')).toEqual({ id: 'h1', name: 'RAINY', members: [] });
		expect(store.get('h2')).toEqual({ id: 'h2', name: 'Ferries', members: [] });
	});

	it('adds only what is not in it, and removes', async () => {
		await store.load();
		await store.create({ name: 'A', members: [{ game: '1' }] });
		expect(await store.change('h1', { add: [{ game: '1' }, { collection: 's5' }] })).toEqual({
			ok: true,
			collection: { id: 'h1', name: 'A', members: [{ game: '1' }, { collection: 's5' }] }
		});
		expect(await store.change('h1', { remove: [{ game: '1' }] })).toEqual({
			ok: true,
			collection: { id: 'h1', name: 'A', members: [{ collection: 's5' }] }
		});
		expect(store.get('h1')).toEqual({ id: 'h1', name: 'A', members: [{ collection: 's5' }] });
	});

	it('answers no-collection for an unknown id', async () => {
		await store.load();
		await store.create({ name: 'A', members: [] });
		expect(await store.change('h9', { name: 'B' })).toEqual({ ok: false, error: 'no-collection' });
		expect(await store.change('h9', { add: [{ game: '1' }] })).toEqual({ ok: false, error: 'no-collection' });
		expect(await store.remove('h9')).toEqual({ ok: false, error: 'no-collection' });
		expect(store.get('h9')).toBeNull();
		expect(store.all()).toEqual([{ id: 'h1', name: 'A', members: [] }]);
	});

	it('runs overlapping changes one after the other', async () => {
		await store.load();
		const answers = await Promise.all([
			store.create({ name: 'A', members: [] }),
			store.create({ name: 'a', members: [] }),
			store.create({ name: 'B', members: [] }),
			store.change('h2', { add: [{ game: '1' }] })
		]);
		expect(answers).toEqual([
			{ ok: true, collection: { id: 'h1', name: 'A', members: [] } },
			{ ok: false, error: 'name-taken' },
			{ ok: true, collection: { id: 'h2', name: 'B', members: [] } },
			{ ok: true, collection: { id: 'h2', name: 'B', members: [{ game: '1' }] } }
		]);
		expect(JSON.parse(await readFile(join(folder, OWN_FILE), 'utf8')).collections).toEqual(store.all());
	});

	it('writes the file whole through a temporary file and reads it back after a restart', async () => {
		await store.load();
		await store.create({ name: 'Rainy', members: [{ game: '11' }, { collection: 's5' }] });
		await store.create({ name: 'Ferries', members: [] });
		expect(JSON.parse(await readFile(join(folder, OWN_FILE), 'utf8'))).toEqual({
			version: 1,
			next: 3,
			collections: [
				{ id: 'h1', name: 'Rainy', members: [{ game: '11' }, { collection: 's5' }] },
				{ id: 'h2', name: 'Ferries', members: [] }
			]
		});
		// Neither the temporary file nor the probe is left.
		expect(await readdir(folder)).toEqual([OWN_FILE]);
		const restarted = ownStore();
		await restarted.load();
		expect(restarted.all()).toEqual(store.all());
		expect(warnings()).toEqual([]);
	});

	describe('in a folder that cannot be written', () => {
		it('knows at start, refuses a change and keeps memory, and is writable again after a write that works', async () => {
			await writeFile(join(folder, 'a-file'), 'a file where a folder is expected');
			const s = ownStore(join(folder, 'a-file', 'settings'));
			await s.load();
			expect(warnings()).toHaveLength(1);
			expect(await s.create({ name: 'A', members: [] })).toEqual({ ok: false, error: 'unwritable' });
			expect(s.all()).toEqual([]);
			await rm(join(folder, 'a-file'));
			// The number the failed create would have taken is still free.
			expect(await s.create({ name: 'B', members: [] })).toEqual({ ok: true, collection: { id: 'h1', name: 'B', members: [] } });
		});

		it('keeps memory and says unwritable when the folder cannot be written', async () => {
			const dir = join(folder, 'settings');
			const s = ownStore(dir);
			await s.load();
			await s.create({ name: 'A', members: [{ game: '1' }] });
			await rm(dir, { recursive: true });
			await writeFile(dir, 'a file where a folder is expected');
			expect(await s.change('h1', { add: [{ game: '2' }] })).toEqual({ ok: false, error: 'unwritable' });
			expect(await s.change('h1', { name: 'B' })).toEqual({ ok: false, error: 'unwritable' });
			expect(await s.remove('h1')).toEqual({ ok: false, error: 'unwritable' });
			expect(await s.create({ name: 'C', members: [] })).toEqual({ ok: false, error: 'unwritable' });
			expect(s.all()).toEqual([{ id: 'h1', name: 'A', members: [{ game: '1' }] }]);
		});
	});
});
