<script lang="ts">
	import { genreName } from '$lib/genres';
	import { t } from '$lib/strings';
	import type { View } from '$lib/view.svelte';
	import Icon from './Icon.svelte';

	let { view }: { view: View } = $props();

	const chips = $derived([
		...view.os.map((os) => ({ key: `os:${os}`, label: t.osName[os], remove: () => view.toggleOs(os) })),
		...view.together.map((flag) => ({ key: `together:${flag}`, label: t.together[flag], remove: () => view.toggleTogether(flag) })),
		...view.genres.map((genre) => ({ key: `genre:${genre}`, label: genreName(genre), remove: () => view.toggleGenre(genre) }))
	]);
</script>

<div class="status">
	<!-- Read out when the list changes, politely: after the visitor stops typing. -->
	<span class="count-text" role="status">
		{#if view.narrowed}
			<strong>{view.matches.length}</strong> {t.count.ofTotal(view.total)}
		{:else}
			<strong>{view.total}</strong> {t.count.games(view.total)}
		{/if}
	</span>
	{#each chips as chip (chip.key)}
		<button class="chip active-chip" type="button" title={t.count.removeFilter(chip.label)} onclick={chip.remove}>
			{chip.label}<Icon name="close" /><span class="sr">{t.count.removeFilter(chip.label)}</span>
		</button>
	{/each}
	{#if view.narrowed}
		<button class="link-button" type="button" onclick={() => view.clearAll()}>{t.count.clearAll}</button>
	{/if}
	<div class="sort">
		<span class="by">{t.count.sorted}</span>
		<button type="button" aria-pressed={view.sort === 'title'} data-label={t.count.sortTitle} onclick={() => view.setSort('title')}>
			{t.count.sortTitle}
		</button>
		<button type="button" aria-pressed={view.sort === 'recent'} data-label={t.count.sortRecent} onclick={() => view.setSort('recent')}>
			{t.count.sortRecent}
		</button>
		<button type="button" aria-pressed={view.sort === 'year'} data-label={t.count.sortYear} onclick={() => view.setSort('year')}>
			{t.count.sortYear}
		</button>
	</div>
</div>
