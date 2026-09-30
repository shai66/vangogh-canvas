import { describe, expect, it } from 'vitest';
import type { FileEntry } from '$lib/types';
import { downloadUrl, startDownloads, type Checked, type Starter } from './start';

const file = (fileId: string): FileEntry => ({
	fileId,
	name: fileId,
	filename: `${fileId}.bin`,
	version: '1.0',
	sizeText: '1 GB',
	sizeBytes: 1024 ** 3,
	run: false
});

/** A starter that writes down what it was asked, and answers as told. */
function recorder(answers: Record<string, Checked> = {}) {
	const log: string[] = [];
	const io: Starter = {
		async check(url) {
			log.push(`check ${url}`);
			return answers[url] ?? 'ok';
		},
		trigger(url) {
			log.push(`trigger ${url}`);
		},
		async wait(ms) {
			log.push(`wait ${ms}`);
		}
	};
	return { log, io };
}

describe('downloadUrl', () => {
	it('builds the address of a file, and keeps odd ids inside their segment', () => {
		expect(downloadUrl('1001', 'abc123')).toBe('/download/1001/abc123');
		expect(downloadUrl('../x', 'a/b?c')).toBe('/download/..%2Fx/a%2Fb%3Fc');
	});
});

describe('startDownloads', () => {
	it('starts every file, one after another, with a pause between them', async () => {
		const { log, io } = recorder();
		const result = await startDownloads('1001', [file('a'), file('b'), file('c')], io, 50);
		expect(result).toEqual({ started: ['a', 'b', 'c'], missing: [], unreachable: false });
		expect(log).toEqual([
			'check /download/1001/a',
			'trigger /download/1001/a',
			'check /download/1001/b',
			'wait 50',
			'trigger /download/1001/b',
			'check /download/1001/c',
			'wait 50',
			'trigger /download/1001/c'
		]);
	});

	it('skips a file that is missing in the archive and goes on', async () => {
		const { log, io } = recorder({ '/download/1001/b': 'missing' });
		const result = await startDownloads('1001', [file('a'), file('b'), file('c')], io, 50);
		expect(result).toEqual({ started: ['a', 'c'], missing: ['b'], unreachable: false });
		expect(log).not.toContain('trigger /download/1001/b');
	});

	it('does not pause before the first download, even when earlier files were missing', async () => {
		const { log, io } = recorder({ '/download/1001/a': 'missing' });
		await startDownloads('1001', [file('a'), file('b')], io, 50);
		expect(log).toEqual(['check /download/1001/a', 'check /download/1001/b', 'trigger /download/1001/b']);
	});

	it('stops when the archive cannot be reached, and says so', async () => {
		const { log, io } = recorder({ '/download/1001/b': 'unreachable' });
		const result = await startDownloads('1001', [file('a'), file('b'), file('c')], io, 50);
		expect(result).toEqual({ started: ['a'], missing: [], unreachable: true });
		expect(log).not.toContain('check /download/1001/c');
	});

	it('does nothing for no files', async () => {
		const { log, io } = recorder();
		expect(await startDownloads('1001', [], io)).toEqual({ started: [], missing: [], unreachable: false });
		expect(log).toEqual([]);
	});
});
