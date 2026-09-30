import { describe, expect, it } from 'vitest';
import { createLogger } from './log';

function capture() {
	const lines: string[] = [];
	return { lines, log: createLogger((line) => lines.push(line)) };
}

describe('createLogger', () => {
	it('writes one line with time, level and message', () => {
		const { lines, log } = capture();
		log.info('rebuild finished');
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\S+ INFO rebuild finished$/);
	});

	it('appends fields as key=value', () => {
		const { lines, log } = capture();
		log.warn('record skipped', { id: '1003', reason: 'no metadata found' });
		expect(lines[0]).toMatch(/ WARN record skipped id=1003 reason="no metadata found"$/);
	});

	it('masks fields that could hold a secret', () => {
		const { lines, log } = capture();
		log.error('login failed', { password: 'secret', Token: 'abc', authorization: 'Bearer abc' });
		expect(lines[0]).not.toContain('secret');
		expect(lines[0]).not.toContain('abc');
		expect(lines[0]).toContain('password=***');
	});

	it('keeps a message on one line', () => {
		const { lines, log } = capture();
		log.error('bad\nmessage', { detail: 'two\nlines' });
		expect(lines[0]).not.toContain('\n');
	});
});
