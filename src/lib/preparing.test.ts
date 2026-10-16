import { describe, expect, it } from 'vitest';
import { preparingState } from './preparing';

describe('what the page says while there is no library', () => {
	it('says it is reading while a rebuild runs, and before the first one has ended', () => {
		expect(preparingState({ running: true, lastResult: 'never' }, 'unknown')).toBe('reading');
		expect(preparingState({ running: false, lastResult: 'never' }, 'unknown')).toBe('reading');
		// A retry after a failure is reading again.
		expect(preparingState({ running: true, lastResult: 'failed' }, 'unknown')).toBe('reading');
	});

	it('says vangogh refused the login when the last try was refused', () => {
		expect(preparingState({ running: false, lastResult: 'failed' }, 'rejected')).toBe('refused');
	});

	it('says the archive cannot be read when the last try failed otherwise', () => {
		expect(preparingState({ running: false, lastResult: 'failed' }, 'unknown')).toBe('unreadable');
		expect(preparingState({ running: false, lastResult: 'failed' }, 'ok')).toBe('unreadable');
	});
});
