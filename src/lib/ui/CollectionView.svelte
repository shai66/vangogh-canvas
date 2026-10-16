<script lang="ts">
	import { systemsOf, yearSpan } from '$lib/collections';
	import { t } from '$lib/strings';
	import type { Collection, ListEntry } from '$lib/types';
	import Card from './Card.svelte';
	import CollectionPoster from './CollectionPoster.svelte';
	import Icon from './Icon.svelte';
	import Picture from './Picture.svelte';

	interface Props {
		collection: Collection;
		/** Its games in the list, oldest first. */
		games: ListEntry[];
		onclose: () => void;
		/** A game of it was clicked. The card is a link and works without it. */
		onopen: (event: MouseEvent, href: string) => void;
	}
	let { collection, games, onclose, onopen }: Props = $props();

	const oldest = $derived(games[0]);
	const years = $derived(yearSpan(games));
	// The picture, heavily blurred, colours the head, as for a game without wide artwork.
	// When the archive lacks the pack's poster, the oldest game's picture stands in, as beside it.
	let failed = $state(false);
	const wash = $derived((failed ? null : collection.poster) ?? oldest?.poster ?? oldest?.banner ?? null);
	const what = $derived(t.collections.what(collection.kind, collection.total, games.length, years));
	const joined = $derived(t.collections.joined(collection.joined));
</script>

<!-- svelte-ignore a11y_autofocus -->
<div class="detail-inner coll-inner" tabindex="-1" autofocus>
	{#if wash}
		<div class="ambience"><Picture id={wash} lazy={false} onfail={() => (failed = true)} /></div>
	{/if}
	<div class="detail-close-holder">
		<button class="detail-close" type="button" onclick={onclose}>
			<Icon name="close" /><span class="sr">{t.detail.close}</span>
		</button>
	</div>
	<!-- A page of an album: the picture on the left; beside it what the collection is, and its games where a game has its download. -->
	<div class="detail-head coll-head">
		<div class="detail-poster"><CollectionPoster {collection} {oldest} lazy={false} /></div>
		<div class="detail-info">
			<h1 class="detail-title">{collection.name}</h1>
			<p class="detail-makers">
				{#each what as part, i (i)}{part.plain}{#if part.bold}<b>{part.bold}</b>{/if}{/each}
				{#if collection.storeUrl}
					<!-- Only where the games link to the pack's page: many packs are hidden on GOG. -->
					<span class="store-on">·{' '}<a class="store" href={collection.storeUrl} target="_blank" rel="noreferrer" title={t.collections.storeTitle}>{t.detail.store}<Icon name="external" /></a></span>
				{/if}
			</p>
			{#if joined.length > 0}
				<p class="coll-joined">{#each joined as part, i (i)}{part.plain}{#if part.bold}<b>{part.bold}</b>{/if}{/each}</p>
			{/if}
			<div class="facts">
				{#each systemsOf(games) as os (os)}
					<span><Icon name={os} />{t.osName[os]}</span>
				{/each}
			</div>
		</div>
		<div class="coll-body">
			<h2 class="section-title">{t.collections.gamesTitle} <span>{t.collections.gamesNote(games.length)}</span></h2>
			<div class="grid coll-grid">
				{#each games as entry (entry.id)}
					<Card match={{ entry, reason: null }} {onopen} />
				{/each}
			</div>
		</div>
	</div>
</div>
