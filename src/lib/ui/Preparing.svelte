<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PreparingState } from '$lib/preparing';
	import { t } from '$lib/strings';

	/** Reading the archive, or why the last reading failed (0.10.2). The page asks again and follows it. */
	let { state }: { state: PreparingState } = $props();

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
	<h1>{t.preparing[state].title}</h1>
	<p>{t.preparing[state].text}</p>
</main>
