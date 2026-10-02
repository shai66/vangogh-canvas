import { describe, expect, it } from 'vitest';
import { formatSize, upperFirst } from './format';

const MB = 1024 ** 2;
const GB = 1024 ** 3;

describe('formatSize', () => {
	it.each([
		[38 * GB, '38 GB'],
		[2.5 * GB, '2.5 GB'],
		[1 * GB, '1 GB'],
		[512 * MB, '512 MB'],
		[GB - 1, '1 GB'],
		[1023.4 * MB, '1023 MB'],
		[100, '1 MB'],
		[0, '0 MB'],
		[Number.NaN, '0 MB'],
		[-5, '0 MB']
	])('%d is shown as %s', (bytes, text) => {
		expect(formatSize(bytes)).toBe(text);
	});
});

describe('upperFirst', () => {
	it('starts a text with a capital letter and leaves the rest', () => {
		expect(upperFirst('manual (German)')).toBe('Manual (German)');
		expect(upperFirst('HD wallpaper')).toBe('HD wallpaper');
		expect(upperFirst('')).toBe('');
	});
});
