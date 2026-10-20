<script lang="ts">
	import { dayWhen } from '$lib/age';
	import type { Sort } from '$lib/search/state';
	import { SORTS, type Settings, type SettingsAnswer } from '$lib/settings';
	import { SettingsSaver, sendSettings } from '$lib/settings-saver';
	import { t, THEO_URL } from '$lib/strings';
	import { ALL_OS, type Os } from '$lib/types';
	import Icon from './Icon.svelte';

	interface Props {
		/** The settings as the server holds them. */
		settings: Settings;
		/** When this browser's unlock runs out, as an ISO time. */
		unlockedUntil: string;
		/** False while the settings folder cannot be written. A refused change sets it to false. */
		writable: boolean;
		/** The time zone Canvas writes times in. */
		timeZone: string;
		/** A change was saved: the settings as the server now holds them. */
		onsaved: (answer: SettingsAnswer) => void;
		/** The browser is locked: by "Lock" (false), or it was locked meanwhile (true). */
		onlocked: (again: boolean) => void;
		onclose: () => void;
	}
	let { settings, unlockedUntil, writable = $bindable(), timeZone, onsaved, onlocked, onclose }: Props = $props();

	const until = $derived(t.settings.until(dayWhen(new Date(unlockedUntil), timeZone)));

	/** The words of each sort order, as the count line says them. */
	const sortName: Record<Sort, string> = { title: t.count.sortTitle, recent: t.count.sortRecent, year: t.count.sortYear };

	/** What the chips and the switch show: changed at the press, and back to what the server holds when a save fails. */
	// svelte-ignore state_referenced_locally
	let shown = $state<Settings>($state.snapshot(settings));
	/** How the last change failed, when it got no answer or Canvas refused it. */
	let failure = $state<'unreachable' | 'forbidden' | null>(null);
	const notice = $derived(
		failure === 'unreachable' ? t.settings.unreachable : failure === 'forbidden' ? t.settings.refused : writable ? null : t.settings.unwritable
	);

	/** "Saved" shows for a moment after each change that was saved. */
	let savedShown = $state(false);
	let savedTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(savedTimer));

	const saver = new SettingsSaver((next) => sendSettings(next));
	/** The number of the last press: only the result of the latest puts the chips back. */
	let presses = 0;

	/** A press: the change shows at once and is saved; the result says whether it stays. */
	async function change(next: Settings) {
		shown = next;
		const press = ++presses;
		const result = await saver.save($state.snapshot(next));
		if (result.kind === 'saved') {
			failure = null;
			// Only the latest press says "Saved": the answer to an earlier one comes while a later is still under way.
			if (press === presses) {
				savedShown = true;
				clearTimeout(savedTimer);
				savedTimer = setTimeout(() => (savedShown = false), 1600);
			}
			onsaved(result.answer);
			return;
		}
		savedShown = false;
		// A later press waits for its own result.
		if (press === presses) shown = $state.snapshot(settings);
		if (result.kind === 'locked') {
			onlocked(true);
		} else if (result.kind === 'unwritable') {
			failure = null;
			writable = false;
		} else if (result.kind === 'unreachable' || result.kind === 'forbidden') {
			failure = result.kind;
		}
	}

	const setDefaults = (part: Partial<Settings['defaults']>) => change({ ...shown, defaults: { ...shown.defaults, ...part } });

	function setSort(sort: Sort) {
		if (shown.defaults.sort !== sort) setDefaults({ sort });
	}

	function toggleOs(os: Os) {
		const on = shown.defaults.os.includes(os);
		// In the fixed order, each once.
		setDefaults({ os: ALL_OS.filter((name) => (name === os ? !on : shown.defaults.os.includes(name))) });
	}

	let locking = false;

	/** "Lock": the server forgets this browser's unlock. Without its answer nothing changed, and the sheet stays. */
	async function lock() {
		if (locking) return;
		locking = true;
		let done = false;
		try {
			// A body of JSON: SvelteKit refuses a form's or a text's body from the page before Canvas reads it.
			const res = await fetch('/api/settings/lock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
			done = res.ok;
		} catch {
			// No answer: the browser is still unlocked.
		} finally {
			locking = false;
		}
		if (done) onlocked(false);
	}
</script>

<!-- svelte-ignore a11y_autofocus -->
<div class="detail-inner settings-inner" tabindex="-1" autofocus>
	<!-- Canvas's night at the top, as at the library at a glance. -->
	<div class="ambience glance-night"></div>
	<div class="detail-close-holder">
		<button class="detail-close" type="button" onclick={onclose}>
			<Icon name="close" /><span class="sr">{t.detail.close}</span>
		</button>
	</div>
	<div class="settings-head">
		<h1 class="detail-title">{t.settings.title}</h1>
		<p class="detail-makers">{t.settings.intro}</p>
	</div>
	{#if notice}
		<div class="notice notice-bad settings-notice" role="alert">
			<Icon name="warning" />
			<div>{notice}</div>
		</div>
	{/if}
	<section class="settings-panel">
		<h2 class="section-title">{t.settings.opens} <span>{t.settings.opensNote}</span></h2>
		<div class="set-row">
			<span class="set-k" id="set-sorted">{t.settings.sorted}</span>
			<div class="chip-set" role="group" aria-labelledby="set-sorted">
				{#each SORTS as sort (sort)}
					<button class="chip" type="button" aria-pressed={shown.defaults.sort === sort} onclick={() => setSort(sort)}>{sortName[sort]}</button>
				{/each}
			</div>
		</div>
		<div class="set-row">
			<span class="set-k" id="set-platforms">{t.settings.platforms}</span>
			<div class="chip-set" role="group" aria-labelledby="set-platforms">
				{#each ALL_OS as os (os)}
					<button class="chip" type="button" aria-pressed={shown.defaults.os.includes(os)} onclick={() => toggleOs(os)}>
						<Icon name={os} />{t.osName[os]}
					</button>
				{/each}
				<!-- Its room is kept while a platform is chosen, so nothing moves when it goes. -->
				<span class="set-hint" class:is-hidden={shown.defaults.os.length > 0}>{t.settings.noneChosen}</span>
			</div>
		</div>
		<div class="set-row">
			<span class="set-k" id="set-collections">{t.settings.collections}</span>
			<div class="chip-set" role="group" aria-labelledby="set-collections">
				<button class="chip" type="button" aria-pressed={shown.defaults.grouped} onclick={() => setDefaults({ grouped: !shown.defaults.grouped })}>
					<Icon name="stack" />{t.settings.showCollections}
				</button>
			</div>
		</div>
		<div class="set-row">
			<span class="set-k" id="set-age">{t.settings.age}</span>
			<div class="chip-set" role="group" aria-labelledby="set-age">
				<button class="chip" type="button" aria-pressed={shown.defaults.hide18} onclick={() => setDefaults({ hide18: !shown.defaults.hide18 })}>
					<Icon name="shield-check" />{t.filters.hide18}
				</button>
			</div>
		</div>
		<p class="set-note">{t.settings.keepsOwn}</p>
	</section>
	<section class="settings-panel">
		<h2 class="section-title">{t.settings.theo} <span>{t.settings.theoNote}</span></h2>
		<div class="set-switch-row">
			<div>
				<span class="set-switch-label" id="set-theo">{t.settings.theoSwitch}</span>
				<p class="set-switch-text">
					{t.settings.theoText}
					<a href={THEO_URL} target="_blank" rel="noreferrer">{t.settings.theoLink}<Icon name="external" /></a>
				</p>
			</div>
			<button class="switch" type="button" role="switch" aria-checked={shown.theo} aria-labelledby="set-theo" onclick={() => change({ ...shown, theo: !shown.theo })}>
				<span class="knob"></span>
			</button>
		</div>
	</section>
	<div class="settings-foot">
		<!-- "Saved" is always there and only shows, so nothing moves. A screen reader hears it from the status beside it. -->
		<span class="saved" class:is-shown={savedShown} aria-hidden="true"><Icon name="check" />{t.settings.saved}</span>
		<span class="sr" role="status">{savedShown ? t.settings.saved : ''}</span>
		<span class="settings-until">{until}</span>
		<button class="btn btn-small settings-lock" type="button" onclick={lock}><Icon name="lock" />{t.settings.lock}</button>
	</div>
</div>
