import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from './version';

describe('the version', () => {
	it('is the version of package.json, so /healthz says what the image tag says', () => {
		const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
			version: string;
		};
		expect(VERSION).toBe(pkg.version);
		expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
	});
});
