<script lang="ts">
	import '@fontsource-variable/archivo/wdth.css';
	import '$lib/styles/tokens.css';
	import '$lib/styles/base.css';
	import '$lib/styles/bar.css';
	import '$lib/styles/list.css';
	import '$lib/styles/sheets.css';
	import '$lib/styles/detail.css';
	import '$lib/styles/download.css';
	import '$lib/styles/narrow.css';
	import Preparing from '$lib/ui/Preparing.svelte';
	import { t } from '$lib/strings';

	let { data, children } = $props();
</script>

<svelte:head>
	<title>{t.pageTitle}</title>
</svelte:head>

{#if data.ready}
	{@render children()}
{:else}
	<Preparing />
{/if}
