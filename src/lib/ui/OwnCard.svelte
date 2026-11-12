<script lang="ts">
	import { systemsOf, yearSpan } from '$lib/collections';
	import type { Band } from '$lib/own';
	import type { OwnCard } from '$lib/search/cards';
	import { t } from '$lib/strings';
	import Icon from './Icon.svelte';
	import OwnPicture from './OwnPicture.svelte';
	import { restTitle, runTitle } from './title-run';

	interface Props {
		card: OwnCard;
		/** The strips of its picture. */
		bands: Band[];
		/** Called for a click, with the collection's id. The card is a link and works without it. */
		onopen?: (event: MouseEvent, id: string) => void;
		/** True while picking: an own collection cannot go inside another, so the card is faded and a click does nothing (spec of own collections, section 8.2). */
		faded: boolean;
	}
	let { card, bands, onopen, faded }: Props = $props();

	const own = $derived(card.own);
	const href = $derived(`/collection/${encodeURIComponent(own.id)}`);
	const years = $derived(yearSpan(card.games));
	const reason = $derived(card.found ? t.card.reason.dlc(card.found.title) : null);

	let title: HTMLElement;
	const run = () => runTitle(title);
	const rest = () => restTitle(title);
</script>

<!-- A GOG collection's card (CollectionCard.svelte), with its picture made of its members. -->
<a
	class="card is-collection is-own"
	class:is-faded={faded}
	{href}
	aria-disabled={faded || undefined}
	onclick={(event) => (faded ? event.preventDefault() : onopen?.(event, own.id))}
	onmouseenter={run}
	onmouseleave={rest}
	onfocus={run}
	onblur={rest}
>
	<div class="poster"><OwnPicture {bands} /></div>
	<div class="card-text">
		<h3 class="card-title" bind:this={title}><span>{own.name}</span></h3>
		<div class="card-meta">
			<span class="group os">
				{#each systemsOf(card.games) as os (os)}
					<span title={t.osName[os]}><Icon name={os} /><span class="sr">{t.osName[os]}</span></span>
				{/each}
			</span>
			<span class="dlc coll-pill" title={t.own.pill(card.games.map((g) => g.title))}>
				<Icon name="stack" /><span aria-hidden="true">{card.games.length}</span><span class="sr">{t.collections.games(card.games.length)}</span>
			</span>
		</div>
		{#if reason}
			<div class="card-reason" title={reason}>{reason}</div>
		{:else}
			<div class="card-genres"><span class="kind">{t.own.kind}</span>{#if years}<span class="years">{years}</span>{/if}</div>
		{/if}
	</div>
</a>
