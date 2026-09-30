<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { t } from '$lib/strings';

	// Asks again every few seconds until the library is there.
	$effect(() => {
		const timer = setInterval(() => invalidateAll(), 4000);
		return () => clearInterval(timer);
	});
</script>

<svelte:head>
	<!-- Without scripts the page still refreshes itself. -->
	<noscript><meta http-equiv="refresh" content="10" /></noscript>
</svelte:head>

<main class="prepare">
	<img src="/logo" alt="" />
	<h1>{t.preparing.title}</h1>
	<p>{t.preparing.text}</p>
</main>
