<script lang="ts">
	import type { Snippet } from 'svelte';
	import { t } from '$lib/strings';
	import Icon from './Icon.svelte';

	interface Props {
		/** What is picked: games, GOG collections, and both together. */
		counts: { games: number; collections: number; n: number };
		/** Why the last save failed, in a red line; null when it did not. */
		error: string | null;
		onaddto: () => void;
		onnew: () => void;
		oncancel: () => void;
		/** True while the list "Add to…" is open. */
		addOpen: boolean;
		/** The list "Add to…", above its button; drawn while `addOpen`. */
		children?: Snippet;
	}
	let { counts, error, onaddto, onnew, oncancel, addOpen, children }: Props = $props();
</script>

<!-- The bar at the foot of the window while picking (spec of own collections, section 8.2). It lies over the page and
     takes no room. -->
<div class="pickbar" role="region" aria-label={t.own.selected(counts.n)}>
	<div class="pickbar-inner">
		<div class="pickbar-count" aria-live="polite">
			<strong>{t.own.selected(counts.n)}</strong>
			{#if error}
				<span class="pickbar-error">{error}</span>
			{:else}
				<span class="pickbar-what">{t.own.picks(counts.games, counts.collections)}</span>
			{/if}
		</div>
		<div class="pickbar-actions">
			<div class="addto-wrap">
				<button class="btn" type="button" aria-expanded={addOpen} disabled={counts.n === 0} onclick={onaddto}>{t.own.addTo}</button>
				{#if addOpen}{@render children?.()}{/if}
			</div>
			<button class="btn btn-primary" type="button" disabled={counts.n === 0} onclick={onnew}><Icon name="plus" />{t.own.newCollection}</button>
			<button class="link-button" type="button" onclick={oncancel}>{t.own.cancel}</button>
		</div>
	</div>
</div>
