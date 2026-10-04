<script lang="ts">
	import { builtTime, builtWhen } from '$lib/age';
	import { formatSize } from '$lib/format';
	import { genreName } from '$lib/genres';
	import { t } from '$lib/strings';
	import { ALL_OS, type Glance } from '$lib/types';
	import Icon from './Icon.svelte';
	import { genreIcon, type IconName } from './icons';

	interface Props {
		glance: Glance;
		/** The number of list entries, as the count line counts them. */
		games: number;
		/** The number of collections. */
		collections: number;
		builtAt: string | null;
		/** The time zone Canvas writes times in. */
		timeZone: string;
		onclose: () => void;
	}
	let { glance, games, collections, builtAt, timeZone, onclose }: Props = $props();

	const built = $derived(builtTime(builtAt));
	const head = $derived(t.glance.head(games, collections, built ? builtWhen(built, timeZone) : null));
	const total = $derived(ALL_OS.reduce((sum, os) => sum + glance.bytes[os], 0) + glance.extrasBytes);
	const tallest = $derived(Math.max(1, ...glance.decades.map(([, n]) => n)));

	/** A bar's length in per cent of `of`. A number that is not 0 shows at least a sliver. */
	const share = (n: number, of: number): number => (n > 0 && of > 0 ? Math.max(1.5, (n / of) * 100) : 0);
	/** A column's height in per cent of the tallest. A number that is not 0 shows at least a sliver. */
	const rise = (n: number): number => (n > 0 ? Math.max(1.5, (n / tallest) * 100) : 0);
</script>

<!-- One row of a panel: its name, a bar against the whole and its value. The bar is decoration: the words say it all. -->
{#snippet row(icon: IconName | null, name: string, value: string, length: number, title: string)}
	<li {title}>
		<span class="k">{#if icon}<Icon name={icon} />{/if}{name}</span>
		<span class="track" aria-hidden="true"><span class="fill" style:width="{length}%"></span></span>
		<span class="v">{value}</span>
	</li>
{/snippet}

<!-- svelte-ignore a11y_autofocus -->
<div class="detail-inner glance-inner" tabindex="-1" autofocus>
	<!-- Canvas's night: a faint sky and a fainter star at the top, as a game's artwork colours its sheet. -->
	<div class="ambience glance-night"></div>
	<div class="detail-close-holder">
		<button class="detail-close" type="button" onclick={onclose}>
			<Icon name="close" /><span class="sr">{t.detail.close}</span>
		</button>
	</div>
	<div class="glance-head">
		<h1 class="detail-title">{t.glance.title}</h1>
		<p class="detail-makers">{#each head as part, i (i)}{part.plain}{#if part.bold}<b>{part.bold}</b>{/if}{/each}</p>
	</div>
	<div class="glance-grid">
		<div class="glance-col">
			<section class="glance-panel glance-space">
				<h2 class="section-title">{t.glance.space}</h2>
				<p class="glance-hero"><span>{t.glance.about}</span> {formatSize(total)}</p>
				<p class="glance-note">{t.glance.spaceNote}</p>
				<ul class="glance-bars">
					{#each ALL_OS as os (os)}
						{@render row(os, t.osName[os], formatSize(glance.bytes[os]), share(glance.bytes[os], total), t.glance.sizeRow(t.osName[os], formatSize(glance.bytes[os])))}
					{/each}
					{@render row('gift', t.glance.extras, formatSize(glance.extrasBytes), share(glance.extrasBytes, total), t.glance.extrasRow(formatSize(glance.extrasBytes)))}
				</ul>
			</section>
			<section class="glance-panel glance-systems">
				<h2 class="section-title">{t.glance.systems} <span>{t.glance.systemsNote}</span></h2>
				<ul class="glance-bars">
					{#each ALL_OS as os (os)}
						{@render row(os, t.osName[os], String(glance.systems[os]), share(glance.systems[os], games), t.glance.systemRow(glance.systems[os], games, t.osName[os]))}
					{/each}
				</ul>
			</section>
		</div>
		<div class="glance-col">
			<section class="glance-panel glance-decades">
				<h2 class="section-title">{t.glance.decades} <span>{t.glance.decadesNote(glance.noYear)}</span></h2>
				{#if glance.decades.length > 0}
					<ul class="glance-cols">
						{#each glance.decades as [decade, n] (decade)}
							<li title={t.glance.decadeRow(n, decade)}>
								<span class="plot"><span class="v">{n}</span><span class="col" style:height="{rise(n)}%"></span></span>
								<span class="lbl">{t.glance.decade(decade)}</span>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="glance-none">{t.glance.noYears}</p>
				{/if}
			</section>
			<section class="glance-panel glance-genres">
				<h2 class="section-title">
					{t.glance.genres}
					{#if glance.genres.length > 0}<span>{t.glance.genresNote(glance.genres.length)}</span>{/if}
				</h2>
				{#if glance.genres.length > 0}
					<ul class="glance-bars">
						{#each glance.genres as [genre, n] (genre)}
							{@render row(genreIcon(genre), genreName(genre), String(n), share(n, games), t.glance.genreRow(n, games, genreName(genre)))}
						{/each}
					</ul>
				{:else}
					<p class="glance-none">{t.glance.noGenres}</p>
				{/if}
			</section>
		</div>
	</div>
</div>
