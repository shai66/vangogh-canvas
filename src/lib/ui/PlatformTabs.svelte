<script lang="ts">
	import { t } from '$lib/strings';
	import type { Os } from '$lib/types';
	import Icon from './Icon.svelte';
	import { nextTab } from './tabs';

	interface Props {
		systems: Os[];
		/** How many files each system has. */
		counts: Partial<Record<Os, number>>;
		tab: Os;
		onselect: (os: Os) => void;
		/** Names the panel the tabs switch. */
		panel: string;
		/** Shown at the end of the row. */
		note: string | null;
	}
	let { systems, counts, tab, onselect, panel, note }: Props = $props();

	let row: HTMLElement;

	/** Arrow keys move between tabs, as in every tab row. Tab itself leaves the row. */
	function keydown(event: KeyboardEvent) {
		const to = nextTab(event.key, systems.length, systems.indexOf(tab));
		if (to < 0) return;
		event.preventDefault();
		onselect(systems[to]);
		row.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
	}
</script>

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="tabs" role="tablist" aria-label={t.download.platforms} bind:this={row} onkeydown={keydown}>
	{#each systems as os (os)}
		<button
			type="button"
			role="tab"
			id="{panel}-tab-{os}"
			aria-selected={os === tab}
			aria-controls={panel}
			tabindex={os === tab ? 0 : -1}
			onclick={() => onselect(os)}
		>
			<Icon name={os} />{t.osName[os]}<span class="n">{t.download.files(counts[os] ?? 0)}</span>
		</button>
	{/each}
	{#if note}<span class="tabs-note">{note}</span>{/if}
</div>
