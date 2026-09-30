import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Index } from './index-types';
import { createLogger } from './log';
import { IndexStore } from './store';

const index: Index = {
	schema: 4,
	builtAt: '2026-09-29T02:30:00.000Z',
	version: '0123456789abcdef',
	entries: [],
	details: {},
	files: {}
};

let dir: string;
let lines: string[];
const store = (path = dir) => new IndexStore(path, createLogger((line) => lines.push(line)));

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'canvas-store-'));
	lines = [];
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe('IndexStore', () => {
	it('holds nothing at first', async () => {
		const s = store();
		expect(s.get()).toBeNull();
		expect(await s.load()).toBe(false);
		expect(s.get()).toBeNull();
	});

	it('gives back what was set', async () => {
		const s = store();
		await s.set(index);
		expect(s.get()).toEqual(index);
	});

	it('survives a restart', async () => {
		await store().set(index);
		const next = store();
		expect(await next.load()).toBe(true);
		expect(next.get()).toEqual(index);
	});

	it('creates the folder and leaves no temporary file', async () => {
		const nested = join(dir, 'a', 'b');
		await store(nested).set(index);
		expect(await readdir(nested)).toEqual(['index.json']);
	});

	// Review focus 3
	it('ignores a truncated file', async () => {
		const s = store();
		await writeFile(s.file, JSON.stringify(index).slice(0, 40));
		expect(await s.load()).toBe(false);
		expect(s.get()).toBeNull();
		expect(lines.some((l) => l.includes('WARN'))).toBe(true);
	});

	it.each([
		['an older schema', { ...index, schema: 0 }],
		['the schema before hasFiles', { ...index, schema: 1 }],
		['the schema before the wide images', { ...index, schema: 2 }],
		['the schema before the Mac notice', { ...index, schema: 3 }],
		['no schema', { ...index, schema: undefined }],
		['entries that are not a list', { ...index, entries: {} }],
		['no files', { ...index, files: undefined }],
		['a list', []],
		['null', null]
	])('ignores a file with %s', async (_name, content) => {
		const s = store();
		await writeFile(s.file, JSON.stringify(content));
		expect(await s.load()).toBe(false);
		expect(s.get()).toBeNull();
	});

	it('replaces a broken file on the next set', async () => {
		const s = store();
		await writeFile(s.file, '{broken');
		await s.load();
		await s.set(index);
		expect(JSON.parse(await readFile(s.file, 'utf8'))).toEqual(index);
	});

	it('reports whether the cache was written', async () => {
		const s = store();
		expect(s.cacheState()).toBe('never');
		await s.set(index);
		expect(s.cacheState()).toBe('written');

		const blocker = join(dir, 'blocker');
		await writeFile(blocker, 'a file where a folder is expected');
		const broken = store(join(blocker, 'cache'));
		await broken.set(index);
		expect(broken.cacheState()).toBe('failed');
	});

	it('reports the last write only', async () => {
		const s = store();
		await mkdir(s.file);
		await s.set(index);
		expect(s.cacheState()).toBe('failed');
		await rm(s.file, { recursive: true });
		await s.set(index);
		expect(s.cacheState()).toBe('written');
	});

	it('removes the temporary file when it cannot take the place of the cache', async () => {
		const s = store();
		// A folder where the file should be: the rename fails.
		await mkdir(s.file);
		await writeFile(join(s.file, 'keep'), 'x');
		await s.set(index);
		expect(s.cacheState()).toBe('failed');
		expect((await readdir(dir)).sort()).toEqual(['index.json']);
		expect(lines.some((l) => l.includes('ERROR'))).toBe(true);
	});

	it('warns when the cache cannot be read, but not when there is none', async () => {
		const s = store();
		expect(await s.load()).toBe(false);
		expect(lines).toEqual([]);
		await mkdir(s.file);
		expect(await s.load()).toBe(false);
		expect(lines.some((l) => l.includes('WARN') && l.includes('EISDIR'))).toBe(true);
	});

	it('keeps the index in memory when the file cannot be written', async () => {
		const blocker = join(dir, 'blocker');
		await writeFile(blocker, 'a file where a folder is expected');
		const s = store(join(blocker, 'cache'));
		await s.set(index);
		expect(s.get()).toEqual(index);
		expect(lines.some((l) => l.includes('ERROR'))).toBe(true);
	});
});
