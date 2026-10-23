<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { runningFor, whenRead, whenText } from '$lib/server-status';
	import { isRebuildAt, type ServerInEffect, type ServerSettings, type ServerStatus } from '$lib/settings';
	import { releaseUrl, t } from '$lib/strings';
	import { nowLine, selectedZone, zoneOptions } from '$lib/time-zones';
	import Icon from './Icon.svelte';

	interface Props {
		/** True while the Server tab is chosen: the panel "This Canvas" is read when it is. */
		chosen: boolean;
		/** The Server settings as the sheet shows them: as stored, each null until it is changed here. */
		server: ServerSettings;
		/** The Server settings in effect, as the server last answered them. */
		inEffect: ServerInEffect;
		/** The stack's own: its zone stays in the list, so the way back to it is one choice. */
		stack: ServerInEffect;
		/** A control of this tab was changed. */
		onchange: (part: Partial<ServerSettings>) => void;
		/** The browser was locked meanwhile. */
		onlocked: () => void;
		/** Canvas refused "Read now": from another site. */
		onrefused: () => void;
	}
	let { chosen, server, inEffect, stack, onchange, onlocked, onrefused }: Props = $props();

	const f = t.settings.facts;
	/** The room of a value the server has not said yet: a line of nothing, so the rows keep their size when it comes. */
	const NOTHING = '\u00a0';
	/** How often the sheet asks whether a read of the library has ended. */
	const POLL_MS = 500;

	// ---------- This Canvas (spec 2026-10-21, section 4) ----------

	/** What the server said when it was last asked; null until then. */
	let status = $state<ServerStatus | null>(null);
	/** When it was asked: "today" and "2 hours" are of that moment. The panel is not kept live. */
	let readAt = $state(new Date());
	/** True while a read of the library runs, started here or found running: the sheet waits for it. */
	let reading = $state(false);
	let waiting = false;
	/** The pause between two questions while a read runs. */
	let pause: ReturnType<typeof setTimeout> | undefined;
	/** The sheet has closed: nothing more is asked, and nothing is told. */
	let gone = false;
	$effect(() => () => {
		gone = true;
		clearTimeout(pause);
	});

	/** What the server says now; null without an answer. */
	async function ask(): Promise<ServerStatus | null> {
		try {
			const res = await fetch('/api/settings/status');
			if (res.status === 401 && !gone) onlocked();
			if (!res.ok) return null;
			return (await res.json()) as ServerStatus;
		} catch {
			return null;
		}
	}

	/** Asks, and shows what the server says. */
	async function show(): Promise<ServerStatus | null> {
		const next = await ask();
		if (next && !gone) {
			readAt = new Date();
			status = next;
		}
		return next;
	}

	/** Waits until the read under way has ended, then shows the panel again and reads the list behind the sheet again. */
	async function waitForRead() {
		if (waiting) return;
		waiting = true;
		reading = true;
		try {
			for (;;) {
				await new Promise((resolve) => (pause = setTimeout(resolve, POLL_MS)));
				const now = await ask();
				// No answer, or locked meanwhile: there is nothing to wait for.
				if (now === null || gone) return;
				if (!now.library.rebuild.running) break;
			}
			await show();
		} finally {
			waiting = false;
			reading = false;
		}
		if (!gone) await invalidateAll();
	}

	/** The tab is chosen: the panel is read, and a read already under way is waited for as a 409 is (spec, section 8). */
	async function look() {
		const next = await show();
		if (next?.library.rebuild.running && !gone) await waitForRead();
	}

	$effect(() => {
		if (chosen) void look();
	});

	/** "Read now": Canvas reads the library again, as `POST /api/rebuild` does. A read that already runs is waited for. */
	async function readNow() {
		if (reading) return;
		reading = true;
		let answer = 0;
		try {
			// A body of JSON: SvelteKit refuses a form's or a text's body from the page before Canvas reads it.
			const res = await fetch('/api/rebuild', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
			answer = res.status;
		} catch {
			// No answer: nothing was started.
		}
		if (gone) return;
		// 202: started; 409: another read runs.
		if (answer === 202 || answer === 409) return waitForRead();
		reading = false;
		if (answer === 403) onrefused();
	}

	const update = $derived(status?.update);

	// ---------- Server (section 5) ----------

	/** The values the controls show: the sheet's, else the stack's. */
	const rebuildAt = $derived(server.rebuildAt ?? inEffect.rebuildAt);
	const timeZone = $derived(server.timeZone ?? inEffect.timeZone);
	const versionCheck = $derived(server.versionCheck ?? inEffect.versionCheck);

	/** The words of the rows, once the server has answered; null for a part it leaves empty. */
	const rows = $derived.by(() => {
		if (!status) return null;
		const s = status;
		const when = (iso: string) => whenText(iso, s.timeZone, readAt);
		return {
			version: s.version,
			versionMore: s.update === null ? f.checkOff : s.update.checkedAt ? f.checked(when(s.update.checkedAt)) : null,
			running: f.since(when(s.startedAt)),
			runningMore: runningFor(s.startedAt, readAt),
			vangogh: s.vangogh.url,
			library: f.games(s.library.games, s.library.collections),
			// The next read as the time box has it, so it follows a change at once.
			libraryMore: f.read(s.library.builtAt ? whenRead(s.library.builtAt, s.timeZone, readAt) : null, rebuildAt),
			batocera: s.batocera === 'off' ? f.batoceraOff : s.batocera === 'ready' ? f.batoceraSetUp : f.batoceraNotSetUp,
			batoceraMore: f.jobs(s.jobs)
		};
	});

	/** What is in the time box. A change put back comes into it; otherwise what is typed stays. */
	// svelte-ignore state_referenced_locally
	let rebuildBox = $state(rebuildAt);
	// svelte-ignore state_referenced_locally
	let took = rebuildAt;
	$effect.pre(() => {
		if (rebuildAt !== took) rebuildBox = took = rebuildAt;
	});
	/** A time box that holds no time: it is not saved, and waits to be mended. */
	let invalid = $state(false);

	/** The time box changed: saved if it holds a new time. */
	function commitRebuild() {
		invalid = !isRebuildAt(rebuildBox);
		if (!invalid && rebuildBox !== rebuildAt) onchange({ rebuildAt: rebuildBox });
	}

	/** The offsets and "now" are worked out when the sheet shows them (section 5.1). */
	const now = new Date();
	const zones = $derived(zoneOptions(inEffect.timeZone, now, [stack.timeZone]));
	const zoneShown = $derived(selectedZone(timeZone, now.getUTCFullYear()));
	const zoneNow = $derived.by(() => {
		const { summer, offset } = nowLine(timeZone, now);
		return t.settings.zoneNow(summer, offset);
	});

	function setZone(zone: string) {
		if (zone !== zoneShown) onchange({ timeZone: zone });
	}
</script>

{#snippet from(name: string)}
	<span class="set-from">{t.settings.from.before}<code>{name}</code>{t.settings.from.after}</span>
{/snippet}

<!-- A fact's words, on one line: what does not fit ends in an ellipsis, and the title says all of it. -->
{#snippet words(text: string | null)}
	<span class="set-text" title={text ?? undefined}>{text ?? NOTHING}</span>
{/snippet}
{#snippet more(text: string | null, title: string | null = text)}
	<span class="set-faint" title={title ?? undefined}>{text ?? NOTHING}</span>
{/snippet}

<section class="settings-panel">
	<h2 class="section-title">{f.title} <span>{f.note}</span></h2>
	<!-- The rows are there before the server has answered, each with a line of room, and each stays one line, so nothing
	     moves when it answers. -->
	<dl class="set-facts">
		<dt>{f.version}</dt>
		<dd>
			<span class="set-line">
				<span class="set-value">
					{@render words(rows?.version ?? null)}
					{#if update?.newer}
						<a class="set-pill is-new" href={releaseUrl(update.newer)} target="_blank" rel="noreferrer" title={t.foot.updateTitle(update.newer)}
							>{f.isOut(update.newer)}</a
						>
					{:else if update?.latest}
						<span class="set-pill is-ok">{f.upToDate}</span>
					{/if}
				</span>
				{@render more(rows?.versionMore ?? null)}
			</span>
		</dd>
		<dt>{f.running}</dt>
		<dd>
			<span class="set-line">
				<span class="set-value">{@render words(rows?.running ?? null)}</span>
				{@render more(rows?.runningMore ?? null)}
			</span>
		</dd>
		<dt>{f.vangogh}</dt>
		<dd>
			<span class="set-line">
				<span class="set-value">
					{@render words(rows?.vangogh ?? null)}
					{#if status?.vangogh.login === 'ok'}
						<span class="set-pill is-ok">{f.signedIn}</span>
					{:else if status?.vangogh.login === 'rejected'}
						<span class="set-pill is-bad">{f.loginRefused}</span>
					{/if}
				</span>
			</span>
		</dd>
		<dt>{f.library}</dt>
		<dd>
			<span class="set-line">
				<span class="set-value">{@render words(rows?.library ?? null)}</span>
				{#if reading}
					{@render more(f.reading)}
				{:else if status?.library.rebuild.lastResult === 'failed'}
					<!-- The reason is the title. -->
					{@render more(f.readFailed, status.library.rebuild.lastError)}
				{:else}
					{@render more(rows?.libraryMore ?? null)}
				{/if}
			</span>
			<!-- Both of its words lie in one place and one is seen, so it keeps its width while it reads. -->
			<button class="btn btn-small set-read-now" type="button" aria-busy={reading ? 'true' : undefined} onclick={readNow}>
				<span class="bato-icon" class:is-turning={reading}><Icon name="update" /></span>
				<span class="stack">
					<span class:on={!reading}>{f.readNow}</span>
					<span class:on={reading}>{f.readingNow}</span>
				</span>
			</button>
		</dd>
		<dt>{f.batocera}</dt>
		<dd>
			<span class="set-line">
				<span class="set-value">{@render words(rows?.batocera ?? null)}</span>
				{@render more(rows?.batoceraMore ?? null)}
			</span>
		</dd>
	</dl>
</section>
<section class="settings-panel">
	<h2 class="section-title">{t.settings.server} <span>{t.settings.serverNote}</span></h2>
	<div class="set-row">
		<label class="set-k" for="set-rebuild">{t.settings.rebuild}</label>
		<div class="set-field">
			<!-- Saved when it changes, as Batocera's boxes are. -->
			<input
				class="set-input"
				id="set-rebuild"
				type="time"
				required
				aria-invalid={invalid ? 'true' : undefined}
				bind:value={rebuildBox}
				oninput={() => (invalid = false)}
				onchange={commitRebuild}
			/>
			<span class="set-hint">{t.settings.rebuildText} {@render from(t.settings.fromName.rebuild)}</span>
		</div>
	</div>
	<div class="set-row">
		<label class="set-k" for="set-zone">{t.settings.zone}</label>
		<div class="set-field">
			<select class="set-input" id="set-zone" bind:value={() => zoneShown, setZone}>
				{#each zones as zone (zone.value)}
					<option value={zone.value}>{zone.label}</option>
				{/each}
			</select>
			<span class="set-hint">{zoneNow} {t.settings.zoneText} {@render from(t.settings.fromName.zone)}</span>
		</div>
	</div>
	<div class="set-switch-row">
		<div>
			<span class="set-switch-label" id="set-updates">{t.settings.updates}</span>
			<p class="set-switch-text">{t.settings.updatesText} {@render from(t.settings.fromName.updates)}</p>
		</div>
		<button class="switch" type="button" role="switch" aria-checked={versionCheck} aria-labelledby="set-updates" onclick={() => onchange({ versionCheck: !versionCheck })}>
			<span class="knob"></span>
		</button>
	</div>
</section>
