<script lang="ts">
	import type { Band } from '$lib/own';
	import Icon from './Icon.svelte';
	import Picture from './Picture.svelte';

	interface Props {
		/** The strips, as `bandsOf` gives them. */
		bands: Band[];
		/** True for the small pictures, which have no room for the badge. */
		small?: boolean;
		/** False for the one picture that is on screen as soon as it is drawn. */
		lazy?: boolean;
	}
	let { bands, small = false, lazy = true }: Props = $props();

	/** The images that could not be shown: a band then shows the next it has. */
	let failed = $state<Record<string, true>>({});
	const imageOf = (band: Band): string | null => [band.banner, band.poster].find((id) => id !== null && !failed[id]) ?? null;
</script>

<!-- An own collection's picture (spec of own collections, section 7): one band per member, which fill the frame it is
     in. It shows what the card's words say, so it is not read out. -->
<div class="own-strips" aria-hidden="true">
	{#each bands as band}
		{@const image = imageOf(band)}
		<div class="own-strip" class:is-nested={band.nested !== null}>
			{#if image}
				<Picture id={image} {lazy} onfail={() => (failed[image] = true)} />
			{:else}
				<div class="poster-plain">{band.title}</div>
			{/if}
			{#if band.nested !== null && !small}
				<span class="own-strip-badge"><Icon name="stack" /><span>{band.nested}</span></span>
			{/if}
		</div>
	{/each}
</div>
