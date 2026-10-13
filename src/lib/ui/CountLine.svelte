<script lang="ts">
	import { genreName } from '$lib/genres';
	import { t } from '$lib/strings';
	import type { View } from '$lib/view.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		view: View;
		/** A click on the count: opens the library at a glance over the list. The count is a link and works without it. */
		onglance: (event: MouseEvent) => void;
	}
	let { view, onglance }: Props = $props();

	const chips = $derived([
		...view.os.map((os) => ({ key: `os:${os}`, label: t.osName[os], remove: () => view.toggleOs(os) })),
		...view.together.map((flag) => ({ key: `together:${flag}`, label: t.together[flag], remove: () => view.toggleTogether(flag) })),
		...(view.hide18 ? [{ key: 'hide18', label: t.filters.hide18, remove: () => view.toggleHide18() }] : []),
		...view.genres.map((genre) => ({ key: `genre:${genre}`, label: genreName(genre), remove: () => view.toggleGenre(genre) }))
	]);
	/** The count in the words the line shows. */
	const spoken = $derived(
		(view.narrowed ? `${view.games} ${t.count.ofTotal(view.total)}` : `${view.total} ${t.count.games(view.total)}`) +
			(view.grouped ? `${t.count.separator}${view.collectionCount} ${t.count.collections(view.collectionCount)}` : '')
	);
</script>

<div class="status">
	<!-- The count opens the library at a glance. Its name is what it shows and the words after it. -->
	<a class="glance-count" href="/glance" title={t.glance.open} onclick={onglance}>
		<Icon name="chartBar" />
		<span class="count-text">
			{#if view.narrowed}
				<strong>{view.games}</strong> {t.count.ofTotal(view.total)}
			{:else}
				<strong>{view.total}</strong> {t.count.games(view.total)}
			{/if}
			<!-- The collections part always keeps its room (a sizer of three digits, never seen), so switching the toggle moves nothing; its words show only while collections are shown. -->
			<span class="of-coll" aria-hidden={!view.grouped}>
				<span class="coll-real" class:is-off={!view.grouped}>{t.count.separator}<strong>{view.collectionCount}</strong> {t.count.collections(view.collectionCount)}</span>
				<span class="coll-room" aria-hidden="true">{t.count.room}</span>
			</span>
		</span>
		<span class="sr">{t.glance.inLink}</span>
	</a>
	<!-- Read out when the list changes, politely: after the visitor stops typing. A link swallows a live region, so it stands beside it. -->
	<span class="sr" role="status">{spoken}</span>
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
