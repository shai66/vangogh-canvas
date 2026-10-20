<script lang="ts">
	import { ageInDays, builtTime, builtWhen, isStale } from '$lib/age';
	import { releaseUrl, SOURCE_URL, t, VANGOGH_URL } from '$lib/strings';
	import Icon from './Icon.svelte';

	interface Props {
		version: string;
		/** When the index was built, as an ISO time, or null. */
		builtAt: string | null;
		/** The time zone the time is written in: the one Canvas is set to. */
		timeZone: string;
		/** A newer Canvas that is released, or null. */
		update: string | null;
		/** 'on' while a PIN is set: "Settings" is a link. 'off': a button whose tooltip says how to set one. */
		settings: 'on' | 'off';
		/** A click on the link "Settings": opens the settings over the list. The link works without it. */
		onsettings: (event: MouseEvent) => void;
	}
	let { version, builtAt, timeZone, update, settings, onsettings }: Props = $props();

	const built = $derived(builtTime(builtAt));
	// The server and the browser write the time the same way, in the same zone.
	const when = $derived(built ? builtWhen(built, timeZone) : null);

	// Without a PIN the tooltip shows while the button is pointed at or has the focus, and a tap toggles it:
	// a phone has no pointing. Esc and a click anywhere else hide it.
	let tipOpen = $state(false);
	let wrap = $state<HTMLElement>();
	let button = $state<HTMLButtonElement>();

	function hideTip() {
		tipOpen = false;
		button?.blur();
	}

	function toggleTip(event: MouseEvent) {
		tipOpen = !tipOpen;
		// A tap that hides it leaves no focus behind to keep it shown. A key keeps the focus where it is.
		if (!tipOpen && event.detail > 0) button?.blur();
	}

	$effect(() => {
		if (!tipOpen) return;
		const away = (event: MouseEvent) => {
			if (!(event.target instanceof Node) || !wrap?.contains(event.target)) hideTip();
		};
		document.addEventListener('click', away, true);
		return () => document.removeEventListener('click', away, true);
	});

	function keydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && wrap && (tipOpen || wrap.contains(document.activeElement))) hideTip();
	}
</script>

<svelte:window onkeydown={keydown} />

<footer class="foot">
	<span class="mark"><img src="/logo" alt="" />{t.foot.version(version)}</span>
	{#if update}
		<a class="newer" href={releaseUrl(update)} target="_blank" rel="noreferrer" title={t.foot.updateTitle(update)}>
			<span class="dot" aria-hidden="true"></span>{t.foot.update}<Icon name="external" />
		</a>
	{/if}
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
	<span class="links">
		{#if settings === 'on'}
			<a class="settings-link" href="/settings" onclick={onsettings}><Icon name="gear" />{t.foot.settings}</a>
		{:else}
			<span class="settings-wrap" class:is-open={tipOpen} bind:this={wrap}>
				<button bind:this={button} type="button" class="settings-link" aria-describedby="settings-tip" onclick={toggleTip}>
					<Icon name="gear" />{t.foot.settings}
				</button>
				<span class="settings-tip" role="tooltip" id="settings-tip"
					>{t.foot.settingsOff.before}<code>{t.foot.settingsOff.code}</code>{t.foot.settingsOff.after}</span
				>
			</span>
		{/if}
		<a href={SOURCE_URL} target="_blank" rel="noreferrer"><Icon name="github" />{t.foot.source}</a>
	</span>
</footer>
