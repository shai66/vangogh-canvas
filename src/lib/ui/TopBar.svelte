<script lang="ts">
	import { t } from '$lib/strings';
	import { ALL_OS } from '$lib/types';
	import type { View } from '$lib/view.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		view: View;
		onfilters: () => void;
	}
	let { view, onfilters }: Props = $props();

	let input: HTMLInputElement;

	/** `/` moves to the search box from anywhere on the page. */
	export function focusSearch() {
		input.focus();
	}
</script>

<header class="bar">
	<a class="brand" href="/" aria-label={t.bar.home}>
		<img src="/logo" alt="" />
		<span>{t.name}<span class="by">{t.nameSuffix}</span></span>
	</a>
	<div class="search" class:has-text={view.q !== ''}>
		<span class="ic-lead"><Icon name="search" /></span>
		<input
			bind:this={input}
			type="search"
			value={view.q}
			oninput={(event) => view.setQuery(event.currentTarget.value)}
			onkeydown={(event) => {
				// Esc clears the box. The browser's own handling of Esc differs between browsers.
				if (event.key === 'Escape' && view.q !== '') {
					event.preventDefault();
					view.setQuery('');
				}
			}}
			placeholder={t.bar.searchPlaceholder}
			aria-label={t.bar.searchLabel}
			autocomplete="off"
			spellcheck="false"
			maxlength="200"
		/>
		<span class="key" aria-hidden="true">/</span>
		<button
			class="clear"
			type="button"
			title={t.bar.clearSearch}
			onclick={() => {
				view.setQuery('');
				input.focus();
			}}
		>
			<Icon name="close" /><span class="sr">{t.bar.clearSearch}</span>
		</button>
	</div>
	<div class="bar-spacer"></div>
	<div class="os-toggle" role="group" aria-label={t.bar.platforms}>
		{#each ALL_OS as os (os)}
			<button type="button" aria-pressed={view.os.includes(os)} title={t.bar.onlyFor(os)} onclick={() => view.toggleOs(os)}>
				<Icon name={os} /><span class="lbl">{t.osName[os]}</span>
			</button>
		{/each}
	</div>
	<button
		class="filter-button"
		class:is-active={view.filterCount > 0}
		type="button"
		aria-label={view.filterCount > 0 ? t.bar.filtersOn(view.filterCount) : t.bar.filters}
		onclick={onfilters}
	>
		<Icon name="filter" /><span class="label">{t.bar.filters}</span>
		{#if view.filterCount > 0}<span class="count" aria-hidden="true">{view.filterCount}</span>{/if}
	</button>
</header>
