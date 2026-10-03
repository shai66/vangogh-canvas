<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { t } from '$lib/strings';
	import type { Collection, ListEntry } from '$lib/types';
	import Icon from './Icon.svelte';
	import Poster from './Poster.svelte';
	import { Strip } from './strip.svelte';

	interface Props {
		collection: Collection;
		/** Its games in the list, oldest first. */
		games: ListEntry[];
		/** The id of the game whose detail this is. */
		here: string;
		/** True when the game was opened from the open row of its collection: the row starts open. */
		open: boolean;
		/** Another game of the row was clicked: it opens in place of this one. Its poster is a link and works without it. */
		onopen: (event: MouseEvent, href: string) => void;
	}
	let { collection, games, here, open: startsOpen, onopen }: Props = $props();

	// Once open, the row stays open: there is no folding it again.
	// svelte-ignore state_referenced_locally
	let open = $state(startsOpen);
	const strip = new Strip();
	let section: HTMLElement;

	// A row that mounts open (a game opened from the open row) starts with the marked game in view.
	// Not scrollIntoView: it can scroll the dialog too.
	onMount(() => {
		const node = strip.node;
		const here = node?.querySelector<HTMLElement>('.is-here');
		if (!node || !here) return;
		const pad = parseFloat(getComputedStyle(node).paddingLeft) || 0;
		node.scrollLeft = Math.max(0, node.scrollLeft + here.getBoundingClientRect().left - node.getBoundingClientRect().left - pad);
		strip.measure();
	});

	$effect(() => {
		if (open) strip.measure();
	});

	async function reveal() {
		open = true;
		await tick();
		section.querySelector<HTMLElement>('.shelf a')?.focus({ preventScroll: true });
	}

	const hrefOf = (game: ListEntry) => `/game/${encodeURIComponent(game.id)}`;
</script>

<section class="coll-shelf" class:is-open={open} bind:this={section}>
	<h2 class="section-title">
		{#if open}
			<span class="shelf-line">{@render line()}</span>
		{:else}
			<button class="shelf-line" type="button" aria-expanded="false" onclick={reveal}>{@render line()}</button>
		{/if}
	</h2>
	{#if open}
		<!-- The arrows of the screenshots: seven posters fit in the widest detail, and a plain mouse wheel does not scroll sideways. -->
		<div class="shelf-wrap">
			<button class="shots-arrow prev" type="button" disabled={strip.atStart} onclick={() => strip.move(-1)}>
				<Icon name="left" /><span class="sr">{t.collections.earlier}</span>
			</button>
			<div class="shelf" bind:this={strip.node} onscroll={strip.measure}>
				{#each games as game (game.id)}
					{#if game.id === here}
						<div class="card shelf-card is-here" aria-current="true">{@render poster(game, true)}</div>
					{:else}
						<a class="card shelf-card" href={hrefOf(game)} onclick={(event) => onopen(event, hrefOf(game))}>{@render poster(game, false)}</a>
					{/if}
				{/each}
			</div>
			<button class="shots-arrow next" type="button" disabled={strip.atEnd} onclick={() => strip.move(1)}>
				<Icon name="right" /><span class="sr">{t.collections.more}</span>
			</button>
		</div>
	{/if}
</section>

{#snippet line()}
	<Icon name="stack" /><b>{collection.name}</b><span>{t.collections.shelf(collection.kind, games.length)}</span><span class="caret"><Icon name="right" /></span>
{/snippet}

{#snippet poster(game: ListEntry, isHere: boolean)}
	<div class="poster"><Poster title={game.title} poster={game.poster} banner={game.banner} /></div>
	<span class="t" title={game.title}>{game.title}</span>
	<span class="y">{isHere ? t.collections.here(game.releaseYear) : (game.releaseYear ?? '')}</span>
{/snippet}
