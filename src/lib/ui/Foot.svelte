<script lang="ts">
	import { ageInDays, builtTime, builtWhen, isStale } from '$lib/age';
	import { SOURCE_URL, t, VANGOGH_URL } from '$lib/strings';
	import Icon from './Icon.svelte';

	interface Props {
		version: string;
		/** When the index was built, as an ISO time, or null. */
		builtAt: string | null;
		/** The time zone the time is written in: the one Canvas is set to. */
		timeZone: string;
	}
	let { version, builtAt, timeZone }: Props = $props();

	const built = $derived(builtTime(builtAt));
	// The server and the browser write the time the same way, in the same zone.
	const when = $derived(built ? builtWhen(built, timeZone) : null);
</script>

<footer class="foot">
	<span class="mark"><img src="/logo" alt="" />{t.foot.version(version)}</span>
	{#if when}
		{#if isStale(builtAt)}
			<span class="stale"><Icon name="warning" />{t.foot.stale(ageInDays(builtAt))}</span>
		{:else}
			<span>{t.foot.updated(when)}</span>
		{/if}
	{/if}
	<span>
		{t.foot.archivedBy} <a href={VANGOGH_URL} target="_blank" rel="noreferrer">{t.foot.vangogh}</a>. {t.foot.readsApi}
	</span>
	<span class="links"><a href={SOURCE_URL} target="_blank" rel="noreferrer">{t.foot.source}</a></span>
</footer>
