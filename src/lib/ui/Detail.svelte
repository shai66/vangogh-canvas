<script lang="ts">
	import { genreName } from '$lib/genres';
	import { t } from '$lib/strings';
	import type { Detail, Os } from '$lib/types';
	import type { Visitor } from '$lib/visitor';
	import DownloadBlock from './DownloadBlock.svelte';
	import Icon from './Icon.svelte';
	import { genreIcon } from './icons';
	import Picture from './Picture.svelte';
	import Poster from './Poster.svelte';
	import Requirements from './Requirements.svelte';
	import Screenshots from './Screenshots.svelte';

	interface Props {
		detail: Detail;
		visitor: Visitor;
		onclose: () => void;
		/** A tag was chosen: the list is searched for it. */
		ontag: (tag: string) => void;
	}
	let { detail, visitor, onclose, ontag }: Props = $props();

	const developers = $derived(detail.developers.join(', '));
	const hasMakers = $derived(developers !== '' || detail.publisher !== '');
	let backdropFailed = $state(false);
	// Without the wide artwork the poster, heavily blurred, colours the head.
	const wash = $derived(detail.poster ?? detail.banner);
	/** The system the download block shows, and how often it changed. The system requirements follow it. */
	let block = $state<{ os: Os | null; turn: number }>({ os: null, turn: 0 });
	function blockShows(os: Os | null) {
		if (os !== block.os) block = { os, turn: block.turn + 1 };
	}
	const hasRequirements = $derived(Object.keys(detail.requirements).length > 0);
</script>

<!-- svelte-ignore a11y_autofocus -->
<div class="detail-inner" tabindex="-1" autofocus>
	{#if detail.backdrop && !backdropFailed}
		<div class="backdrop">
			<Picture id={detail.backdrop} lazy={false} onfail={() => (backdropFailed = true)} />
		</div>
	{:else if wash}
		<div class="ambience"><Picture id={wash} lazy={false} /></div>
	{/if}
	<div class="detail-close-holder">
		<button class="detail-close" type="button" onclick={onclose}>
			<Icon name="close" /><span class="sr">{t.detail.close}</span>
		</button>
	</div>
	<div class="detail-head">
		<div class="detail-poster">
			<Poster title={detail.title} poster={detail.poster} banner={detail.banner} lazy={false} />
		</div>
		<div class="detail-info">
			<h1 class="detail-title">{detail.title}</h1>
			{#if hasMakers || detail.releaseYear || detail.storeUrl}
				<!-- The makers, the year the game first came out, and its page on GOG.com: "Studio, published by House, 2002 · GOG.com". -->
				<p class="detail-makers">
					{#if developers && detail.publisher && developers !== detail.publisher}
						<b>{developers}</b>, {t.detail.publishedBy} <b>{detail.publisher}</b>{#if detail.releaseYear}, <b>{detail.releaseYear}</b>{/if}
					{:else if hasMakers}
						<b>{developers || detail.publisher}</b>{#if detail.releaseYear}, <b>{detail.releaseYear}</b>{/if}
					{:else if detail.releaseYear}
						<b>{detail.releaseYear}</b>
					{/if}
					{#if detail.storeUrl}
						<!-- The dot goes with the link, so a narrow window wraps them together. -->
						<span class="store-on">{#if hasMakers || detail.releaseYear}·{' '}{/if}<a class="store" href={detail.storeUrl} target="_blank" rel="noreferrer" title={t.detail.storeTitle}>{t.detail.store}<Icon name="external" /></a></span>
					{/if}
				</p>
			{/if}
			<div class="facts">
				{#each detail.os as os (os)}
					<span><Icon name={os} />{t.osName[os]}</span>
				{/each}
				{#if detail.os.length > 0 && (detail.multiplayer || detail.coop)}<span class="sep"></span>{/if}
				{#if detail.multiplayer}<span><Icon name="multiplayer" />{t.together.multiplayer}</span>{/if}
				{#if detail.coop}<span><Icon name="coop" />{t.together.coop}</span>{/if}
			</div>
			{#if detail.genres.length > 0}
				<div class="facts">
					{#each detail.genres as genre (genre)}
						{@const icon = genreIcon(genre)}
						<span>{#if icon}<Icon name={icon} />{/if}{genreName(genre)}</span>
					{/each}
				</div>
			{/if}
			{#if detail.kind === 'orphaned-dlc'}
				<p class="relation">{t.detail.orphan(detail.requires)}</p>
			{/if}
			{#if detail.partOf.length > 0}
				<p class="relation">{t.detail.partOf} <b>{detail.partOf.join(', ')}</b></p>
			{/if}
		</div>
		<div class="dl-slot"><DownloadBlock {detail} {visitor} onsystem={blockShows} /></div>
	</div>

	<Screenshots screenshots={detail.screenshots} />

	{#if detail.description || detail.tags.length > 0 || detail.languages.length > 0 || detail.features.length > 0 || hasRequirements}
		<div class="about-grid">
			<div>
				{#if detail.description}
					<h3>{t.detail.about}</h3>
					<!-- The only text shown as HTML. The backend sanitised it while building the index. -->
					<div class="description">{@html detail.description}</div>
				{/if}
			</div>
			<aside class="side">
				{#if detail.tags.length > 0}
					<section>
						<h3>{t.detail.tags}</h3>
						<div class="chip-set">
							{#each detail.tags as tag (tag)}
								<button class="chip" type="button" title={t.detail.searchTag(tag)} onclick={() => ontag(tag)}>{tag}</button>
							{/each}
						</div>
					</section>
				{/if}
				{#if detail.languages.length > 0}
					<section>
						<h3>{t.detail.languages}</h3>
						<p class="plain">{detail.languages.join(', ')}</p>
					</section>
				{/if}
				{#if detail.features.length > 0}
					<section>
						<h3>{t.detail.features}</h3>
						<p class="plain">{detail.features.join(', ')}</p>
					</section>
				{/if}
					<Requirements {detail} follow={block.os} turn={block.turn} {visitor} />
			</aside>
		</div>
	{:else}
		<div class="detail-end"></div>
	{/if}
</div>
