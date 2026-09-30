<script lang="ts">
	import { page } from '$app/state';
	import { t } from '$lib/strings';
</script>

<svelte:head>
	<title>{t.pageTitle}</title>
</svelte:head>

<main class="prepare">
	<img src="/logo" alt="" />
	<h1>{page.status === 404 ? t.error.notFoundTitle : t.error.failedTitle}</h1>
	{#if page.status !== 404}<p>{t.error.failedText}</p>{/if}
	<p><a class="btn btn-primary" href="/">{t.error.back}</a></p>
</main>
