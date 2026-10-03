<script lang="ts">
	import type { Collection, ListEntry } from '$lib/types';
	import Picture from './Picture.svelte';
	import Poster from './Poster.svelte';

	interface Props {
		collection: Collection;
		/** Its oldest game in the list. Its picture stands in for a series, which has none, and for a pack poster the archive lacks. */
		oldest: ListEntry | undefined;
		/** False for the one picture that is on screen as soon as it is drawn. */
		lazy?: boolean;
	}
	let { collection, oldest, lazy = true }: Props = $props();

	let failed = $state(false);
</script>

{#if collection.poster && !failed}
	<Picture id={collection.poster} {lazy} onfail={() => (failed = true)} />
{:else if oldest}
	<Poster title={oldest.title} poster={oldest.poster} banner={oldest.banner} {lazy} />
{:else}
	<div class="poster-plain">{collection.name}</div>
{/if}
