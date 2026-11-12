import { SvelteMap } from 'svelte/reactivity';
import type { OwnMember } from './own';

/** What a card is told while picking: whether it is picked, and what picks or unpicks it. */
export interface Pick {
	picked: boolean;
	ontoggle: () => void;
}

/**
 * Space on a card while picking picks or unpicks it, and does not scroll the page. Enter needs nothing: on a link it
 * is a click.
 */
export function pickKey(event: KeyboardEvent, pick: Pick | null): void {
	if (!pick || event.key !== ' ') return;
	event.preventDefault();
	if (!event.repeat) pick.ontoggle();
}

/**
 * What is picked while "Select" is on (spec of own collections, section 8.2): games and GOG collections, by id, in the
 * order they were picked. A pick that a filter hides stays picked. Nothing is remembered once picking ends.
 */
export class Picking {
	active = $state(false);

	readonly #picked = new SvelteMap<string, 'game' | 'collection'>();

	start(): void {
		this.active = true;
	}

	/** Ends picking and forgets the picks. */
	stop(): void {
		this.active = false;
		this.#picked.clear();
	}

	/** Picks the card, or unpicks it when it is picked. */
	toggle(id: string, kind: 'game' | 'collection'): void {
		if (this.#picked.has(id)) this.#picked.delete(id);
		else this.#picked.set(id, kind);
	}

	has(id: string): boolean {
		return this.#picked.has(id);
	}

	get counts(): { games: number; collections: number; n: number } {
		let games = 0;
		for (const kind of this.#picked.values()) if (kind === 'game') games++;
		return { games, collections: this.#picked.size - games, n: this.#picked.size };
	}

	/** The picks as members of an own collection: games as `{ game }`, GOG collections as `{ collection }`. */
	members(): OwnMember[] {
		return [...this.#picked].map(([id, kind]) => (kind === 'game' ? { game: id } : { collection: id }));
	}
}
