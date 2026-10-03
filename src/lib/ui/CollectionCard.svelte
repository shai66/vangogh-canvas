<script lang="ts">
	import { systemsOf, yearSpan } from '$lib/collections';
	import type { CollectionCard } from '$lib/search/cards';
	import { t } from '$lib/strings';
	import type { ListEntry } from '$lib/types';
	import CollectionPoster from './CollectionPoster.svelte';
	import Icon from './Icon.svelte';
	import { restTitle, runTitle } from './title-run';

	interface Props {
		card: CollectionCard;
		/** The collection's oldest game in the list, for its picture. */
		oldest: ListEntry | undefined;
		/** Called for a click, with the collection's id. The card is a link and works without it. */
		onopen?: (event: MouseEvent, id: string) => void;
	}
	let { card, oldest, onopen }: Props = $props();

	const collection = $derived(card.collection);
	const href = $derived(`/collection/${encodeURIComponent(collection.id)}`);
	const years = $derived(yearSpan(card.games));
	const reason = $derived(card.found ? t.card.reason.dlc(card.found.title) : null);

	let title: HTMLElement;
	const run = () => runTitle(title);
	const rest = () => restTitle(title);
</script>

<a
	class="card is-collection"
	{href}
	onclick={(event) => onopen?.(event, collection.id)}
	onmouseenter={run}
	onmouseleave={rest}
	onfocus={run}
	onblur={rest}
>
	<div class="poster"><CollectionPoster {collection} {oldest} /></div>
	<div class="card-text">
		<h3 class="card-title" bind:this={title}><span>{collection.name}</span></h3>
		<div class="card-meta">
			<span class="group os">
				{#each systemsOf(card.games) as os (os)}
					<span title={t.osName[os]}><Icon name={os} /><span class="sr">{t.osName[os]}</span></span>
				{/each}
			</span>
			<!-- Where a game has its co-op and multiplayer marks: the stack and the number of the games it stands for. -->
			<span class="dlc coll-pill" title={t.collections.pill(collection.kind, card.games.map((g) => g.title))}>
				<Icon name="stack" /><span aria-hidden="true">{card.games.length}</span><span class="sr">{t.collections.games(card.games.length)}</span>
			</span>
		</div>
		{#if reason}
			<div class="card-reason" title={reason}>{reason}</div>
		{:else}
			<div class="card-genres"><span class="kind">{t.collections.kind[collection.kind]}</span>{#if years}<span class="years">{years}</span>{/if}</div>
		{/if}
	</div>
</a>
