import { ALL_OS, type Detail, type Os } from './types';
import type { Visitor } from './visitor';

type Shown = Pick<Detail, 'os' | 'downloads' | 'requirements'>;

/** The systems the section has a tab for: those of the game, and those GOG lists requirements for. */
export function requirementTabs(detail: Shown): Os[] {
	return ALL_OS.filter(
		(os) => detail.requirements[os] !== undefined || detail.os.includes(os) || (detail.downloads[os]?.length ?? 0) > 0
	);
}

/** A tab the visitor chose in the section, and which change of the download block's system it was chosen after. */
export interface RequirementPick {
	os: Os;
	turn: number;
}

/**
 * The system the section shows, or null when GOG lists requirements for none. `follow` is the
 * system the download block shows, and `turn` counts how often it changed. A tab chosen in the
 * section holds until the next change; then the section follows the block again. Without a
 * system from the block: the visitor's own when GOG lists it, otherwise the first GOG lists.
 */
export function shownRequirements(
	detail: Shown,
	follow: Os | null,
	turn: number,
	pick: RequirementPick | null,
	visitor: Visitor
): Os | null {
	const listed = ALL_OS.filter((os) => detail.requirements[os] !== undefined);
	if (listed.length === 0) return null;
	const tabs = requirementTabs(detail);
	if (pick !== null && pick.turn === turn && tabs.includes(pick.os)) return pick.os;
	if (follow !== null && tabs.includes(follow)) return follow;
	const own = ALL_OS.find((os) => os === visitor);
	return own !== undefined && detail.requirements[own] !== undefined ? own : listed[0];
}
