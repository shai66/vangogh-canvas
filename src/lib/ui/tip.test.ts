import { describe, expect, it } from 'vitest';
import { nextTip } from './tip.svelte';

describe('nextTip', () => {
	it('opens on pointing and closes when the pointer leaves', () => {
		const open = nextTip(null, { kind: 'enter', id: 'a' });
		expect(open).toEqual({ id: 'a', by: 'pointer' });
		expect(nextTip(open, { kind: 'leave', id: 'a' })).toBeNull();
		expect(nextTip(open, { kind: 'leave', id: 'b' })).toEqual({ id: 'a', by: 'pointer' });
	});

	it('keeps a focused or tapped tooltip while pointed at and after the pointer leaves', () => {
		const pointed = nextTip({ id: 'a', by: 'focus' }, { kind: 'enter', id: 'a' });
		expect(pointed).toEqual({ id: 'a', by: 'focus' });
		expect(nextTip(pointed, { kind: 'leave', id: 'a' })).toEqual({ id: 'a', by: 'focus' });
		expect(nextTip({ id: 'a', by: 'tap' }, { kind: 'enter', id: 'a' })).toEqual({ id: 'a', by: 'tap' });
	});

	it('keeps a tapped tooltip when the pointer leaves, and closes it on a second tap', () => {
		const tapped = nextTip(null, { kind: 'tap', id: 'a' });
		expect(tapped).toEqual({ id: 'a', by: 'tap' });
		expect(nextTip(tapped, { kind: 'leave', id: 'a' })).toEqual({ id: 'a', by: 'tap' });
		expect(nextTip(tapped, { kind: 'tap', id: 'a' })).toBeNull();
		// A click while pointed at keeps it open once the pointer goes.
		expect(nextTip({ id: 'a', by: 'pointer' }, { kind: 'tap', id: 'a' })).toEqual({ id: 'a', by: 'tap' });
	});

	it('opens on keyboard focus and closes on blur, however it was opened', () => {
		const focused = nextTip(null, { kind: 'focus', id: 'a' });
		expect(focused).toEqual({ id: 'a', by: 'focus' });
		expect(nextTip(focused, { kind: 'blur', id: 'a' })).toBeNull();
		expect(nextTip({ id: 'a', by: 'tap' }, { kind: 'blur', id: 'a' })).toBeNull();
		expect(nextTip({ id: 'a', by: 'tap' }, { kind: 'blur', id: 'b' })).toEqual({ id: 'a', by: 'tap' });
	});

	it('keeps one open at a time', () => {
		expect(nextTip({ id: 'a', by: 'tap' }, { kind: 'enter', id: 'b' })).toEqual({ id: 'b', by: 'pointer' });
		expect(nextTip({ id: 'a', by: 'focus' }, { kind: 'tap', id: 'b' })).toEqual({ id: 'b', by: 'tap' });
		expect(nextTip({ id: 'a', by: 'tap' }, { kind: 'focus', id: 'b' })).toEqual({ id: 'b', by: 'focus' });
	});

	it('closes on Escape and on a tap elsewhere', () => {
		expect(nextTip({ id: 'a', by: 'focus' }, { kind: 'escape' })).toBeNull();
		expect(nextTip({ id: 'a', by: 'focus' }, { kind: 'away' })).toBeNull();
		expect(nextTip(null, { kind: 'escape' })).toBeNull();
		expect(nextTip(null, { kind: 'away' })).toBeNull();
	});
});
