import { describe, expect, it } from 'vitest';
import type { Os, RequirementSet, Requirements } from './types';
import { requirementTabs, shownRequirements } from './requirements';

const set: RequirementSet = { minimum: [{ id: 'memory', name: 'Memory', text: '4 GB RAM' }], recommended: [] };
const game = (requirements: Requirements, os: Os[] = ['windows', 'macos', 'linux']) => ({ os, downloads: {}, requirements });

describe('requirementTabs', () => {
	it('has a tab for every system of the game and every system GOG lists requirements for, in the fixed order', () => {
		expect(requirementTabs({ os: ['linux'], downloads: { macos: [] }, requirements: { windows: set } })).toEqual(['windows', 'linux']);
		expect(
			requirementTabs({ os: ['windows'], downloads: { macos: [{ fileId: 'f', name: 'G', filename: 'g.pkg', version: '', sizeText: '', sizeBytes: 0, run: true }] }, requirements: {} })
		).toEqual(['windows', 'macos']);
	});
});

describe('shownRequirements', () => {
	const both = game({ windows: set, macos: set });

	it('follows the system of the download block', () => {
		expect(shownRequirements(both, 'macos', 1, null, 'windows')).toBe('macos');
	});

	it('shows a tab chosen in the section until the download block shows another system', () => {
		const pick = { os: 'macos' as const, turn: 1 };
		expect(shownRequirements(both, 'windows', 1, pick, 'windows')).toBe('macos');
		// The block moved to Linux: the section follows it.
		expect(shownRequirements(both, 'linux', 2, pick, 'windows')).toBe('linux');
		// And back to Windows: the old pick does not come back.
		expect(shownRequirements(both, 'windows', 3, pick, 'windows')).toBe('windows');
	});

	it('follows the block to a system GOG lists none for: the section says so', () => {
		expect(shownRequirements(both, 'linux', 1, null, 'windows')).toBe('linux');
	});

	it('starts on the visitor\'s own system without a system from the block, else on the first GOG lists', () => {
		expect(shownRequirements(both, null, 0, null, 'macos')).toBe('macos');
		expect(shownRequirements(both, null, 0, null, 'linux')).toBe('windows');
		expect(shownRequirements(both, null, 0, null, 'phone')).toBe('windows');
		expect(shownRequirements(game({ macos: set }), null, 0, null, 'other')).toBe('macos');
	});

	it('ignores a pick of a system it has no tab for', () => {
		const windowsOnly = game({ windows: set }, ['windows']);
		expect(shownRequirements(windowsOnly, 'windows', 1, { os: 'linux', turn: 1 }, 'windows')).toBe('windows');
	});

	it('is null when GOG lists none', () => {
		expect(shownRequirements(game({}), 'windows', 1, null, 'windows')).toBeNull();
	});
});
