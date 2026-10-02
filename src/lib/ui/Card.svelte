<script lang="ts">
	import { kindCounts } from '$lib/extras';
	import { genreName } from '$lib/genres';
	import type { Match } from '$lib/search/query';
	import { t } from '$lib/strings';
	import Icon from './Icon.svelte';
	import Poster from './Poster.svelte';
	import WarnSign from './WarnSign.svelte';

	interface Props {
		match: Match;
		/** True while the list is sorted by release year: the year leads the genre line. */
		showYear?: boolean;
		/** Called for a click. The card is a link and works without it. */
		onopen?: (event: MouseEvent, href: string) => void;
	}
	let { match, showYear = false, onopen }: Props = $props();

	const entry = $derived(match.entry);
	const missing = $derived(entry.complete && !entry.hasFiles);
	const href = $derived(`/game/${encodeURIComponent(entry.id)}`);
	const reason = $derived.by(() => {
		const r = match.reason;
		if (!r) return null;
		return t.card.reason[r.field](r.field === 'genre' ? genreName(r.value) : r.value);
	});

	let title: HTMLElement;
	const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	/** A title that does not fit runs slowly to its end and back while the card is pointed at or focused. */
	function run() {
		const over = title.scrollWidth - title.clientWidth;
		if (over <= 0 || still() || title.classList.contains('is-running')) return;
		title.style.setProperty('--run', `${-over - 4}px`);
		title.style.setProperty('--run-time', `${Math.max(5, over / 14 + 4)}s`);
		title.classList.add('is-running');
	}
	function rest() {
		title.classList.remove('is-running');
	}
</script>

<a
	class="card"
	{href}
	onclick={(event) => onopen?.(event, href)}
	onmouseenter={run}
	onmouseleave={rest}
	onfocus={run}
	onblur={rest}
>
	<div class="poster">
		<Poster title={entry.title} poster={entry.poster} banner={entry.banner} />
		{#if missing}
			<span class="badge-warn" title={t.card.filesMissingLong}><WarnSign /></span>
		{/if}
		{#if entry.kind === 'orphaned-dlc'}
			<span class="badge-note">{t.card.orphan}</span>
		{/if}
	</div>
	<div class="card-text">
		<h3 class="card-title" bind:this={title}><span>{entry.title}</span></h3>
		<div class="card-meta">
			{#if missing}
				<span class="missing"><Icon name="warning" />{t.card.filesMissing}</span>
			{:else}
				<span class="group os">
					{#each entry.os as os (os)}
						<span title={t.osName[os]}><Icon name={os} /><span class="sr">{t.osName[os]}</span></span>
					{/each}
				</span>
			{/if}
			{#if entry.dlc.length > 0}
				<span class="dlc" title={entry.dlc.join(', ')}>{t.card.dlc(entry.dlc.length)}</span>
			{/if}
			{#if entry.extraKinds.length > 0}
				<!-- The extras: a gift and the number, in the look of the DLC pill. -->
				<span class="dlc xtr" title={t.extras.pill(t.extras.kinds(kindCounts(entry.extraKinds)))}>
					<Icon name="gift" /><span aria-hidden="true">{entry.extraKinds.length}</span><span class="sr">{t.extras.count(entry.extraKinds.length)}</span>
				</span>
			{/if}
			<span class="group people">
				{#if entry.coop}
					<span title={t.together.coop}><Icon name="coop" /><span class="sr">{t.together.coop}</span></span>
				{/if}
				{#if entry.multiplayer}
					<span title={t.together.multiplayer}><Icon name="multiplayer" /><span class="sr">{t.together.multiplayer}</span></span>
				{/if}
			</span>
		</div>
		{#if reason}
			<div class="card-reason" title={reason}>{reason}</div>
		{:else}
			<div class="card-genres" title={entry.genres.map(genreName).join(', ')}>
				{#if showYear && entry.releaseYear}<span class="year">{entry.releaseYear}</span>{/if}{#each entry.genres as genre (genre)}<span>{genreName(genre)}</span>{/each}
			</div>
		{/if}
	</div>
</a>
