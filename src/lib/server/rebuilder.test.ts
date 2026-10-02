import { describe, expect, it, vi } from 'vitest';
import type { Index } from './index-types';
import { createLogger, silentLogger } from './log';
import { Rebuilder } from './rebuilder';

const index: Index = {
	schema: 5,
	builtAt: '2026-09-29T02:30:00.000Z',
	version: 'v1',
	entries: [],
	details: {},
	files: {}
};

function setup(build: () => Promise<Index> = async () => index) {
	const store = { set: vi.fn(async () => {}) };
	const before = vi.fn();
	const rebuilder = new Rebuilder({ build, store, log: silentLogger, before });
	return { rebuilder, store, before };
}

describe('Rebuilder', () => {
	it('has never run at first', () => {
		expect(setup().rebuilder.status()).toEqual({
			running: false,
			lastResult: 'never',
			lastAt: null,
			lastError: null,
			lastDurationMs: null
		});
	});

	it('stores the index it built', async () => {
		const { rebuilder, store, before } = setup();
		expect(await rebuilder.run()).toBe('ok');
		expect(store.set).toHaveBeenCalledWith(index);
		expect(before).toHaveBeenCalledOnce();
		expect(rebuilder.status()).toMatchObject({ running: false, lastResult: 'ok', lastError: null });
		expect(rebuilder.status().lastAt).toMatch(/^\d{4}-/);
	});

	it('leaves the store alone when the build fails', async () => {
		const { rebuilder, store } = setup(async () => {
			throw new Error('the library list is empty');
		});
		expect(await rebuilder.run()).toBe('failed');
		expect(store.set).not.toHaveBeenCalled();
		expect(rebuilder.status()).toMatchObject({
			running: false,
			lastResult: 'failed',
			lastError: 'the library list is empty'
		});
	});

	it('runs one rebuild at a time', async () => {
		let finish = () => {};
		const { rebuilder, store } = setup(
			() => new Promise<Index>((resolve) => (finish = () => resolve(index)))
		);
		const first = rebuilder.run();
		expect(rebuilder.status().running).toBe(true);
		expect(await rebuilder.run()).toBe('busy');
		expect(rebuilder.start()).toBe('busy');
		finish();
		expect(await first).toBe('ok');
		expect(store.set).toHaveBeenCalledOnce();
		expect(rebuilder.start()).toBe('started');
	});

	it('reports each result', async () => {
		const failure = new Error('no');
		const results: [boolean, unknown][] = [];
		const good = setup().rebuilder;
		good.onResult = (ok, error) => results.push([ok, error]);
		await good.run();
		const bad = setup(async () => {
			throw failure;
		}).rebuilder;
		bad.onResult = (ok, error) => results.push([ok, error]);
		await bad.run();
		expect(results).toEqual([
			[true, null],
			[false, failure]
		]);
	});

	it('finishes and keeps its status when the one told of the result throws', async () => {
		const lines: string[] = [];
		const store = { set: vi.fn(async () => {}) };
		const rebuilder = new Rebuilder({
			build: async () => index,
			store,
			log: createLogger((line) => lines.push(line))
		});
		rebuilder.onResult = () => {
			throw new Error('listener broke');
		};
		await expect(rebuilder.run()).resolves.toBe('ok');
		expect(rebuilder.status()).toMatchObject({ running: false, lastResult: 'ok', lastError: null });
		expect(lines.some((l) => l.includes('ERROR') && l.includes('listener broke'))).toBe(true);
		expect(rebuilder.start()).toBe('started');
	});

	it('finishes when even the logger throws', async () => {
		const throwing = () => {
			throw new Error('log broke');
		};
		const rebuilder = new Rebuilder({
			build: async () => {
				throw new Error('build broke');
			},
			store: { set: vi.fn(async () => {}) },
			log: { info: throwing, warn: throwing, error: throwing }
		});
		rebuilder.onResult = () => {
			throw new Error('listener broke');
		};
		await expect(rebuilder.run()).resolves.toBe('failed');
		expect(rebuilder.status()).toMatchObject({
			running: false,
			lastResult: 'failed',
			lastError: 'build broke'
		});
	});

	it('does not report a rebuild that was refused', async () => {
		let finish = () => {};
		const { rebuilder } = setup(
			() => new Promise<Index>((resolve) => (finish = () => resolve(index)))
		);
		const onResult = vi.fn();
		rebuilder.onResult = onResult;
		const first = rebuilder.run();
		await rebuilder.run();
		expect(onResult).not.toHaveBeenCalled();
		finish();
		await first;
		expect(onResult).toHaveBeenCalledOnce();
	});
});
