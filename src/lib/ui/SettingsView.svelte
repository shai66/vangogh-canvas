<script lang="ts">
	import { tick } from 'svelte';
	import { dayWhen } from '$lib/age';
	import type { Sort } from '$lib/search/state';
	import { PREFERRED, SORTS, type Preferred, type ServerSettings, type SettingsAnswer, type SettingsBody } from '$lib/settings';
	import { SettingsSaver, sendSettings } from '$lib/settings-saver';
	import { t, THEO_URL } from '$lib/strings';
	import { ALL_OS, type Os } from '$lib/types';
	import BatoceraSettings from './BatoceraSettings.svelte';
	import type { IconName } from './icons';
	import Icon from './Icon.svelte';
	import ServerTab from './ServerTab.svelte';
	import { nextTab } from './tabs';

	interface Props {
		/** The settings as the server holds them, without the password. */
		settings: SettingsAnswer;
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
	let shown = $state<SettingsAnswer>($state.snapshot(settings));
	/** How the last change failed, when it got no answer or Canvas refused it. */
	let failure = $state<'unreachable' | 'forbidden' | null>(null);
	const notice = $derived(
		failure === 'unreachable' ? t.settings.unreachable : failure === 'forbidden' ? t.settings.refused : writable ? null : t.settings.unwritable
	);

	/** "Saved" shows for a moment after each change that was saved. */
	let savedShown = $state(false);
	/** "Not saved" shows in its place after a change that could not be saved, until a change is saved. */
	let notSaved = $state(false);
	let savedTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(savedTimer));

	const saver = new SettingsSaver((next) => sendSettings(next));

	/** What is in Batocera's password box: what was typed. The saved password stays on the server. */
	let password = $state('');
	/** A password that was typed and is not saved yet: every change carries it, until a save took it. */
	let unsaved: string | null = null;
	/** The Server settings as a change on the Server tab left them, not saved yet: every change carries them, until a save took them. */
	let unsavedServer: ServerSettings | null = null;

	/**
	 * What a change sends: the settings as shown, without what only a connection test sets, and without the marks. The
	 * Server settings only after a change on the Server tab, so that a sheet left open elsewhere does not put back what it
	 * opened with: without them, what is saved stays (spec 2026-10-21, section 8).
	 */
	function bodyOf(s: SettingsAnswer): SettingsBody {
		const { on, address, user, wake, shutdown } = s.batocera;
		const typed = unsaved === null ? {} : { password: unsaved };
		const server = unsavedServer === null ? {} : { server: unsavedServer };
		return { defaults: s.defaults, theo: s.theo, preferred: s.preferred, batocera: { on, address, user, ...typed, wake, shutdown }, ...server };
	}

	/** The number of the last press: only the result of the latest puts the chips back. */
	let presses = 0;

	/** A press: the change shows at once and is saved; the result says whether it stays. */
	async function change(next: SettingsAnswer) {
		// With Batocera switched off the press moves to Autoselect, as the server saves it (spec 0.12.0, section 9.1).
		if (!next.batocera.on && next.preferred === 'batocera') next = { ...next, preferred: 'auto' };
		shown = next;
		const press = ++presses;
		const body = bodyOf($state.snapshot(next));
		const result = await saver.save(body);
		if (result.kind === 'saved') {
			failure = null;
			notSaved = false;
			// The password this change carried is saved: its box is emptied, unless another was typed meanwhile.
			const sent = body.batocera.password;
			if (sent !== undefined && sent === unsaved) {
				unsaved = null;
				if (password === sent) password = '';
			}
			// So are the Server settings it carried, unless the Server tab changed them again meanwhile.
			if (body.server !== undefined && body.server === unsavedServer) unsavedServer = null;
			// What only the server changes comes from its answer: a new address, user or password ends "set up" (spec 0.12.0, section 9.2),
			// and the Server settings in effect.
			const { ready, hostKey, mac } = result.answer.batocera;
			shown = { ...shown, batocera: { ...shown.batocera, ready, hostKey, mac }, inEffect: result.answer.inEffect };
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
		if (press === presses) {
			shown = $state.snapshot(settings);
			// The password box goes back to what the server holds too: a saved password, which is never shown.
			unsaved = null;
			password = '';
			unsavedServer = null;
		}
		if (result.kind === 'locked') {
			onlocked(true);
			return;
		}
		notSaved = true;
		if (result.kind === 'unwritable') {
			failure = null;
			writable = false;
		} else if (result.kind === 'unreachable' || result.kind === 'forbidden') {
			failure = result.kind;
		}
	}

	const setDefaults = (part: Partial<SettingsAnswer['defaults']>) => change({ ...shown, defaults: { ...shown.defaults, ...part } });

	function setSort(sort: Sort) {
		if (shown.defaults.sort !== sort) setDefaults({ sort });
	}

	function toggleOs(os: Os) {
		const on = shown.defaults.os.includes(os);
		// In the fixed order, each once.
		setDefaults({ os: ALL_OS.filter((name) => (name === os ? !on : shown.defaults.os.includes(name))) });
	}

	/** The icon of each preferred platform's chip. */
	const preferredIcon: Record<Preferred, IconName> = { auto: 'devices', windows: 'windows', macos: 'macos', linux: 'linux', batocera: 'tv' };
	const preferredName = (p: Preferred): string =>
		p === 'auto' ? t.settings.preferredAuto : p === 'batocera' ? t.settings.preferredBatocera : t.osName[p];
	/** Batocera is set up (spec 0.12.0, section 9.4): only then can it be the preferred platform. */
	const batoceraReady = $derived(shown.batocera.on && shown.batocera.ready);

	function setPreferred(preferred: Preferred) {
		if (preferred === 'batocera' && !batoceraReady) return;
		if (shown.preferred !== preferred) change({ ...shown, preferred });
	}

	/** A control of the Server tab was changed: its values go with this change and every one after it, until saved. */
	function setServer(part: Partial<ServerSettings>) {
		unsavedServer = { ...shown.server, ...part };
		change({ ...shown, server: unsavedServer });
	}

	/** The password box was left with a new password in it: it goes with this change and every one after it, until saved. */
	function setPassword() {
		if (password === '' || password === unsaved) return;
		unsaved = password;
		change({ ...shown });
	}

	/**
	 * A connection test ended. One that passed saved the login it used, the box's key and network card, and "set up"; one
	 * that failed ended "set up". The sheet takes them as the server now holds them, so that its next change does not undo
	 * them and the games show Batocera only while it is set up (spec 0.12.0, sections 9.3 and 9.4).
	 */
	async function tested() {
		let answer: SettingsAnswer;
		try {
			const res = await fetch('/api/settings');
			if (res.status === 401) onlocked(true);
			if (!res.ok) return;
			answer = (await res.json()) as SettingsAnswer;
		} catch {
			return;
		}
		const { address, user, ready, hostKey, mac } = answer.batocera;
		shown = { ...shown, batocera: { ...shown.batocera, address, user, ready, hostKey, mac } };
		onsaved(answer);
	}

	// ---------- The tabs (spec 2026-10-21, section 3) ----------

	/** The sections of the sheet: one shows at a time. */
	type SettingsTab = 'library' | 'downloads' | 'batocera' | 'server';
	const TABS: SettingsTab[] = ['library', 'downloads', 'batocera', 'server'];
	const tabIcon: Record<SettingsTab, IconName> = { library: 'books', downloads: 'download', batocera: 'tv', server: 'hardDrives' };
	/** The sheet opens on Library each time. */
	let tab = $state<SettingsTab>('library');

	/** The sheet from its tabs down. Its top is where the tab row stands while the row is not held. */
	let body: HTMLElement;
	let row: HTMLElement;
	/** The tab row is held at the window's top while a section scrolls under it: only then is the night behind it. */
	let held = $state(false);

	/** Where the tab row starts in the sheet's scroll: scrolled that far, the row is held. */
	const rowTop = (dialog: HTMLElement) => body.getBoundingClientRect().top - dialog.getBoundingClientRect().top + dialog.scrollTop;

	// Whether the row is held follows the scroll of the sheet's dialog, which is what scrolls, and the notice of a failed
	// save, which comes and goes above the row.
	$effect(() => {
		const dialog = body.closest('dialog')!;
		const spy = () => (held = dialog.scrollTop > 0 && dialog.scrollTop >= rowTop(dialog) - 0.5);
		dialog.addEventListener('scroll', spy, { passive: true });
		// Read here so that the row is looked at again, after the page has changed, when the notice comes or goes.
		void notice;
		spy();
		return () => dialog.removeEventListener('scroll', spy);
	});

	/** A tab chosen. When the sheet was scrolled past the tabs, it goes back to just under them: the section starts at its top, and the tabs stay. */
	async function choose(next: SettingsTab) {
		if (next === tab) return;
		const dialog = body.closest('dialog')!;
		const top = rowTop(dialog);
		const past = dialog.scrollTop > top;
		tab = next;
		if (!past) return;
		await tick();
		// The sheet scrolls by whole pixels: up to the next one, so that the row is held where it was.
		dialog.scrollTop = Math.ceil(top);
	}

	/** Arrow keys, Home and End move between the tabs, as in every tab row. Tab itself leaves the row. */
	function keydown(event: KeyboardEvent) {
		const to = nextTab(event.key, TABS.length, TABS.indexOf(tab));
		if (to < 0) return;
		event.preventDefault();
		choose(TABS[to]);
		row.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
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
	<div class="settings-body" bind:this={body}>
		<div class="settings-tabs" class:is-held={held}>
			<!-- svelte-ignore a11y_interactive_supports_focus -->
			<div class="tabs" role="tablist" aria-label={t.settings.title} bind:this={row} onkeydown={keydown}>
				{#each TABS as name (name)}
					<button
						type="button"
						role="tab"
						id="settings-tab-{name}"
						aria-selected={name === tab}
						aria-controls="settings-section-{name}"
						tabindex={name === tab ? 0 : -1}
						onclick={() => choose(name)}
					>
						<Icon name={tabIcon[name]} />{t.settings.tabs[name]}
					</button>
				{/each}
			</div>
		</div>
		<!-- Every section stays in the page and only the chosen one shows: a test running in one goes on while another is chosen. -->
		<div class="settings-section">
			<div role="tabpanel" id="settings-section-library" aria-labelledby="settings-tab-library" hidden={tab !== 'library'}>
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
			</div>
			<div role="tabpanel" id="settings-section-downloads" aria-labelledby="settings-tab-downloads" hidden={tab !== 'downloads'}>
				<section class="settings-panel">
					<h2 class="section-title">{t.settings.preferred} <span>{t.settings.preferredNote}</span></h2>
					<div class="set-row">
						<span class="set-k" id="set-preferred">{t.settings.preferredRow}</span>
						<div class="chip-set" role="group" aria-labelledby="set-preferred">
							{#each PREFERRED as preferred (preferred)}
								{@const waits = preferred === 'batocera' && !batoceraReady}
								<!-- Batocera waits until it is set up; the chip can still be reached, and says so. -->
								<button
									class="chip"
									type="button"
									aria-pressed={shown.preferred === preferred}
									aria-disabled={waits ? 'true' : undefined}
									title={waits ? t.settings.preferredNotReady : undefined}
									onclick={() => setPreferred(preferred)}
								>
									<Icon name={preferredIcon[preferred]} />{preferredName(preferred)}
								</button>
							{/each}
						</div>
					</div>
					<p class="set-note">{t.settings.preferredText}</p>
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
			</div>
			<div role="tabpanel" id="settings-section-batocera" aria-labelledby="settings-tab-batocera" hidden={tab !== 'batocera'}>
				<BatoceraSettings
					batocera={shown.batocera}
					bind:password
					onchange={(part) => change({ ...shown, batocera: { ...shown.batocera, ...part } })}
					onpassword={setPassword}
					ontested={tested}
					onlocked={() => onlocked(true)}
					onrefused={() => (failure = 'forbidden')}
				/>
			</div>
			<div role="tabpanel" id="settings-section-server" aria-labelledby="settings-tab-server" hidden={tab !== 'server'}>
				<ServerTab
					chosen={tab === 'server'}
					server={shown.server}
					inEffect={shown.inEffect}
					stack={shown.stack}
					onchange={setServer}
					onlocked={() => onlocked(true)}
					onrefused={() => (failure = 'forbidden')}
				/>
			</div>
		</div>
		<div class="settings-foot">
			<!-- "Saved" and "Not saved" are always there, in one room, and only show, so nothing moves. A screen reader hears them
			     from the status beside them. -->
			<span class="saved-room" aria-hidden="true">
				<span class="saved" class:is-shown={savedShown}><Icon name="check" />{t.settings.saved}</span>
				<span class="not-saved" class:is-shown={notSaved}><Icon name="warning" />{t.settings.notSaved}</span>
			</span>
			<span class="sr" role="status">{savedShown ? t.settings.saved : notSaved ? t.settings.notSaved : ''}</span>
			<span class="settings-until">{until}</span>
			<button class="btn btn-small settings-lock" type="button" onclick={lock}><Icon name="lock" />{t.settings.lock}</button>
		</div>
	</div>
</div>
