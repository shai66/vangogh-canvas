import { describe, expect, it } from 'vitest';
import { nextTab } from './tabs';

describe('nextTab', () => {
	it('moves right and left around the row, and to its ends', () => {
		expect(nextTab('ArrowRight', 3, 0)).toBe(1);
		expect(nextTab('ArrowRight', 3, 2)).toBe(0);
		expect(nextTab('ArrowLeft', 3, 0)).toBe(2);
		expect(nextTab('Home', 3, 2)).toBe(0);
		expect(nextTab('End', 3, 0)).toBe(2);
	});

	it('gives -1 for another key and for an empty row', () => {
		expect(nextTab('Enter', 3, 0)).toBe(-1);
		expect(nextTab('ArrowRight', 0, 0)).toBe(-1);
	});
});
