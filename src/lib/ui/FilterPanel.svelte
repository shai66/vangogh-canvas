<script lang="ts">
	import { GENRE_GROUPS, genreName, type GenreGroup } from '$lib/genres';
	import { genreFacets } from '$lib/search/query';
	import { ALL_TOGETHER } from '$lib/search/state';
	import { t } from '$lib/strings';
	import { ALL_OS, type ListEntry } from '$lib/types';
	import type { View } from '$lib/view.svelte';
	import Icon from './Icon.svelte';
	import { genreIcon } from './icons';
	import Sheet from './Sheet.svelte';

	interface Props {
		open: boolean;
		onclose: () => void;
		view: View;
		entries: ListEntry[];
	}
	let { open, onclose, view, entries }: Props = $props();

	/** Of a long group this many are shown until the visitor asks for all. */
	const SHORT = 10;
	let all = $state(false);

	const facets = $derived(genreFacets(entries));
	const count = (test: (entry: ListEntry) => boolean) => entries.filter(test).length;

	function shownOf(group: GenreGroup) {
		const list = facets[group];
		if (all || list.length <= SHORT) return list;
		// A genre that is switched on stays in sight.
		return list.filter((facet, position) => position < SHORT || view.genres.includes(facet.genre));
	}
</script>

<Sheet {open} {onclose} class="filters" label={t.filters.title}>
	<div class="filters-head">
		<h2>{t.filters.title}</h2>
		<button class="icon-btn" type="button" title={t.filters.close} onclick={onclose}>
			<Icon name="close" /><span class="sr">{t.filters.close}</span>
		</button>
	</div>
	<!-- svelte-ignore a11y_autofocus -->
	<div class="filters-body" tabindex="-1" autofocus>
		<section>
			<h3>{t.filters.platform}</h3>
			<div class="os-cards">
				{#each ALL_OS as os (os)}
					<button type="button" aria-pressed={view.os.includes(os)} onclick={() => view.toggleOs(os)}>
						<Icon name={os} />
						<span>{t.osName[os]}<br /><span class="n">{t.filters.games(count((e) => e.os.includes(os)))}</span></span>
					</button>
				{/each}
			</div>
		</section>
		<section>
			<h3>{t.filters.together}</h3>
			<div class="chip-set">
				{#each ALL_TOGETHER as flag (flag)}
					<button class="chip" type="button" aria-pressed={view.together.includes(flag)} onclick={() => view.toggleTogether(flag)}>
						<Icon name={flag} />{t.together[flag]}<span class="n">{count((e) => e[flag])}</span>
					</button>
				{/each}
			</div>
		</section>
		{#each GENRE_GROUPS as group (group)}
			{#if facets[group].length > 0}
				<section>
					<h3>{t.filters.group[group]}</h3>
					<div class="chip-set">
						{#each shownOf(group) as facet (facet.genre)}
							{@const icon = genreIcon(facet.genre)}
							<button
								class="chip"
								type="button"
								aria-pressed={view.genres.includes(facet.genre)}
								onclick={() => view.toggleGenre(facet.genre)}
							>
								{#if icon}<Icon name={icon} />{/if}{genreName(facet.genre)}<span class="n">{facet.count}</span>
							</button>
						{/each}
						{#if !all && facets[group].length > SHORT}
							<button class="link-button" type="button" onclick={() => (all = true)}>
								{t.filters.showAll(facets[group].length)}
							</button>
						{/if}
					</div>
				</section>
			{/if}
		{/each}
	</div>
	<div class="filters-foot">
		<button class="btn" type="button" onclick={() => view.clearFilters()}>{t.filters.clear}</button>
		<button class="btn btn-primary" type="button" onclick={onclose}>{t.filters.show(view.matches.length)}</button>
	</div>
</Sheet>
