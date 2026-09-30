import { describe, expect, it } from 'vitest';
import { mapLimit } from './util';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('mapLimit', () => {
	it('keeps the order of the results', async () => {
		const out = await mapLimit([30, 5, 15], 2, async (ms, index) => {
			await wait(ms);
			return `${index}:${ms}`;
		});
		expect(out).toEqual(['0:30', '1:5', '2:15']);
	});

	it('never runs more than the limit at once', async () => {
		let running = 0;
		let most = 0;
		await mapLimit(Array.from({ length: 12 }), 4, async () => {
			most = Math.max(most, ++running);
			await wait(5);
			running--;
		});
		expect(most).toBe(4);
	});

	it('gives an empty list for an empty list', async () => {
		expect(await mapLimit([], 4, async () => 1)).toEqual([]);
	});

	it('fails when one call fails', async () => {
		await expect(
			mapLimit([1, 2, 3], 2, async (n) => {
				if (n === 2) throw new Error('two');
				return n;
			})
		).rejects.toThrow('two');
	});
});
