import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Spec 0.9.1, section 7.2: one curve for every eased motion, which does not overshoot.
const dir = new URL('./', import.meta.url);
const sheets = readdirSync(dir)
	.filter((name) => name.endsWith('.css'))
	.map((name) => [name, readFileSync(new URL(name, dir), 'utf8')] as const);

describe('the motion of the page', () => {
	it('has one curve, in the tokens', () => {
		for (const [name, css] of sheets) {
			const curves = css.match(/cubic-bezier\([^)]*\)/g) ?? [];
			expect(curves, name).toEqual(name === 'tokens.css' ? ['cubic-bezier(0.2, 0.8, 0.2, 1)'] : []);
		}
		expect(sheets.find(([name]) => name === 'tokens.css')?.[1]).toContain('--ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);');
	});

	it('eases every transition and animation with it; only the running title is linear', () => {
		for (const [name, css] of sheets) {
			for (const line of css.split('\n').filter((l) => /^\s*(transition|animation):/.test(l))) {
				if (/:\s*none;/.test(line)) continue;
				expect(line.includes('var(--ease-out)') || line.includes('title-run'), `${name}: ${line.trim()}`).toBe(true);
			}
		}
	});

	it('lets the number on Filters grow from 60 %, so that it settles without springing', () => {
		const bar = sheets.find(([name]) => name === 'bar.css')![1];
		expect(bar).toMatch(/@keyframes count-in \{\s*from \{\s*scale: 0\.6;/);
	});
});
