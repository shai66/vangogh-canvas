import { describe, expect, it } from 'vitest';
import { IMAGE_ID, imageIdFromUrl } from './imageId';

const id = 'c4f4c8a2f0b94d9e8d0a5f1d2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e';

describe('imageIdFromUrl', () => {
	it.each([
		[`https://images.gog-statics.com/${id}.jpg`],
		[`https://images.gog-statics.com/${id}_{formatter}.jpg`],
		[`https://images.gog-statics.com/${id}{formatter}.png`],
		[`https://images.gog-statics.com/${id}_%7Bformatter%7D.jpg`],
		[`https://images.gog-statics.com/${id}.jpg?x=1#y`],
		[`//images.gog-statics.com/${id}`]
	])('reads the id from %s', (url) => {
		expect(imageIdFromUrl(url)).toBe(id);
	});

	it.each([[''], [null], [undefined], ['https://x/../../etc/passwd'], ['https://x/a%zz.jpg'], ['https://x/short.jpg']])(
		'gives nothing for %s',
		(url) => {
			expect(imageIdFromUrl(url)).toBeUndefined();
		}
	);
});

describe('IMAGE_ID', () => {
	it('accepts letters and digits only', () => {
		expect(IMAGE_ID.test(id)).toBe(true);
		expect(IMAGE_ID.test(`${id}/../x`)).toBe(false);
		expect(IMAGE_ID.test('metadata/gog-other-record')).toBe(false);
	});
});
