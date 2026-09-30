import { describe, expect, it } from 'vitest';
import { parseSize } from './size';

describe('parseSize', () => {
	it.each([
		['2.5 GB', 2684354560],
		['2,5 GB', 2684354560],
		['512 MB', 536870912],
		['1 KB', 1024],
		['1 TB', 1099511627776],
		['10 B', 10],
		[' 3gb ', 3221225472]
	])('reads %s', (text, bytes) => {
		expect(parseSize(text)).toBe(bytes);
	});

	it.each([[''], ['big'], ['GB'], ['-1 GB'], [null], [undefined], [12]])(
		'gives 0 for %s',
		(text) => {
			expect(parseSize(text)).toBe(0);
		}
	);
});
