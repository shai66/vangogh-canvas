<script lang="ts">
	import type { GameOnBox } from '$lib/batocera';
	import { BatoceraWatch } from '$lib/batocera-watch.svelte';
	import { batoceraView, lineAnnouncement, MAIN_ICON, percentOf, type Heard, type NoteAct } from '$lib/download/batocera-view';
	import { formatSize } from '$lib/format';
	import {
		blockKind,
		buttonForTab,
		buttonSystems,
		buttonTarget,
		dlcFor,
		firstTab,
		goesToBatocera,
		isPrimary,
		justSent,
		macNote,
		missingFor,
		notePlace,
		runFile,
		sharedVersion,
		systemsOf,
		theoShown,
		totalBytes,
		visibleFiles,
		type Target
	} from '$lib/download/plan';
	import { browserStarter, downloadUrl, startDownloads, type Starter } from '$lib/download/start';
	import type { Preferred } from '$lib/settings';
	import { t } from '$lib/strings';
	import type { Detail, FileEntry, Os } from '$lib/types';
	import type { Visitor } from '$lib/visitor';
	import BatoceraNoteView from './BatoceraNote.svelte';
	import Extras from './Extras.svelte';
	import FileList from './FileList.svelte';
	import Icon from './Icon.svelte';
	import MacCaution from './MacCaution.svelte';
	import PlatformSwitch from './PlatformSwitch.svelte';
	import PlatformTabs from './PlatformTabs.svelte';
	import TheoPanel from './TheoPanel.svelte';
	import TipButton from './TipButton.svelte';

	interface Props {
		detail: Detail;
		visitor: Visitor;
		/** Told the system the file list shows, whenever it changes. The system requirements follow it. */
		onsystem?: (os: Os | null) => void;
		/** Tests hand in their own. */
		starter?: Starter;
		/** True while the settings switch the theo command on. */
		theo?: boolean;
		/**
		 * What the settings say of Batocera and the preferred platform for this browser (0.12.0): whether Batocera is
		 * set up, the platform the button starts on, whether the settings are unlocked here, whether Canvas wakes the
		 * box, and whether the game is marked "Doesn't run on Batocera" as the page was drawn.
		 */
		batocera?: { ready: boolean; preferred: Preferred; unlocked: boolean; wakeOn: boolean; marked: boolean } | null;
		/** The time zone the day of a send to Batocera is written in. */
		timeZone?: string;
	}
	let { detail, visitor, onsystem, starter = browserStarter, theo = false, batocera = null, timeZone = 'UTC' }: Props = $props();

	const PANEL = 'files-panel';

	const kind = $derived(blockKind(detail, visitor));
	/** The platform the note "Not available for …" names: the preferred one, when the game does not have it (2026-10-21). */
	const notFor = $derived(missingFor(detail, visitor, batocera?.preferred ?? 'auto', !!batocera?.ready, batocera?.marked ?? false));
	const systems = $derived(systemsOf(detail));
	let chosen = $state<Os | null>(null);

	// ---------- Batocera (spec 0.12.0, section 7) ----------

	/** True while the detail shows Batocera: it is set up, and the game can go there, the mark apart (section 7.1). */
	const shown = $derived(!!batocera?.ready && goesToBatocera(detail) && kind !== 'unread' && kind !== 'no-files');
	/** The game's state on the box, asked of the server while the detail is open (section 7.7). */
	const watch = $derived(shown ? new BatoceraWatch(detail.id) : null);
	$effect(() => {
		if (!watch) return;
		watch.start();
		return () => watch.stop();
	});
	/** The bytes a send takes: the Windows files of the game and of its DLC. */
	const sendBytes = $derived(totalBytes([...(detail.downloads.windows ?? []), ...detail.dlc.flatMap((d) => d.downloads.windows ?? [])]));
	/** Until the server's first answer: the last state the page was told, else "Not there yet" (section 7.7). */
	const game = $derived<GameOnBox>(
		watch?.game ?? {
			can: true,
			system: detail.dos ? 'dos' : 'windows',
			size: sendBytes,
			onBox: 'no',
			version: null,
			sentAt: null,
			newer: false,
			marked: batocera?.marked ?? false,
			job: null,
			countdown: null,
			play: null,
			box: 'unknown',
			checkedAt: null
		}
	);
	const unlocked = $derived(batocera?.unlocked ?? false);
	/** Batocera can be the button's in this browser: a marked game only where the settings are unlocked (section 7.6). */
	const forThis = $derived(shown && (!game.marked || unlocked));

	// The main button downloads for the visitor's own system, until another is picked with
	// the switch or with a tab of the file list: the two follow each other. The pick lives here
	// and nowhere else: a detail that is opened again is a new block, and starts on the
	// visitor's own system.
	const offered = $derived(buttonSystems(detail));
	let picked = $state<Target | null>(null);
	const target = $derived(buttonTarget(detail, visitor, picked, batocera?.preferred ?? 'auto', forThis, game.marked));
	/** The system the button downloads for; null while it is on Batocera. */
	const system = $derived(target === 'batocera' ? null : target);
	const tab = $derived(chosen && systems.includes(chosen) ? chosen : firstTab(detail, visitor, batocera?.preferred ?? 'auto', target === 'batocera'));
	const files = $derived(tab ? (detail.downloads[tab] ?? []) : []);
	$effect(() => {
		onsystem?.(tab);
	});
	const filesOf = (os: Os) => detail.downloads[os] ?? [];
	const summaryOf = (os: Os) => t.download.summary(filesOf(os).length, formatSize(totalBytes(filesOf(os))));
	const dlc = $derived(tab ? dlcFor(detail, tab) : []);
	const counts = $derived(Object.fromEntries(systems.map((os) => [os, detail.downloads[os]?.length ?? 0])));
	const version = $derived(sharedVersion(files));
	// What is known against the macOS installer, and where it is said: under the button
	// while the button is on macOS, otherwise with the macOS files.
	const note = $derived(macNote(detail));
	const noteAt = $derived(notePlace(note, system, tab));

	let expanded = $state(false);
	let showFiles = $state(false);
	/** How many downloads the main button started, for each system it was pressed for. */
	let started = $state<Partial<Record<Os, number>>>({});
	/** The system it was pressed for last. The note names its file, whatever is picked now. */
	let last = $state<Os | null>(null);
	let busy = $state(false);
	let unreachable = $state(false);
	let missing = $state<string[]>([]);

	async function start(list: Pick<FileEntry, 'fileId'>[]): Promise<number> {
		busy = true;
		unreachable = false;
		try {
			const result = await startDownloads(detail.id, list, starter);
			unreachable = result.unreachable;
			missing = [...new Set([...missing, ...result.missing])];
			return result.started.length;
		} finally {
			busy = false;
		}
	}

	async function main() {
		if (target === 'batocera') return batoceraMain();
		if (busy || !system) return;
		const os = system;
		const count = await start(filesOf(os));
		if (count > 0) {
			started = { ...started, [os]: count };
			last = os;
		}
	}

	/** The switch: the button turns to the system, and the file list with it. Batocera sends the Windows files: the list turns to them (2026-10-22). */
	function pick(to: Target) {
		picked = to;
		chosen = to === 'batocera' ? 'windows' : to;
		expanded = false;
	}

	/** A tab of the file list: the list turns, and the button with it, unless only a DLC has files there. */
	function choose(os: Os) {
		chosen = os;
		picked = buttonForTab(detail, os) ?? picked;
		expanded = false;
	}

	/** One file: asked first, so that a missing file is said and not a broken download. */
	async function one(event: MouseEvent, file: Pick<FileEntry, 'fileId'>) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		// While other files are being started the link downloads the file itself, unasked.
		if (busy) return;
		event.preventDefault();
		await start([file]);
	}

	/** What Batocera shows: the button, the line, the menu's row and the note (spec 2026-10-21, table 5.4). */
	const bato = $derived.by(() => {
		if (!watch) return null;
		const o = {
			unlocked,
			wakeOn: batocera?.wakeOn ?? false,
			play: watch.shownPlay,
			starting: watch.starting,
			justSent: justSent(game.job, watch.serverNow),
			keptOn: watch.keptOn,
			version: detail.downloads.windows?.[0]?.version ?? '',
			timeZone,
			// Some notes show only while the button is on Batocera, as it always is on a phone.
			picked: kind === 'phone' || target === 'batocera'
		};
		const left = watch.left;
		return { view: batoceraView(left === null ? game : { ...game, countdown: left }, o) };
	});
	const batoceraNote = $derived(bato?.view.note ?? null);
	const BATOCERA_LABELS = { send: t.batocera.send, stop: t.batocera.stop, play: t.batocera.play, starting: t.batocera.starting } as const;
	/** While Play waits for the box's answer the button waits too, only marked disabled: it keeps the focus a press gave it (spec 7). */
	const starting = $derived(target === 'batocera' && bato?.view.main === 'starting');
	/** The line holds Batocera's state while the button is on Batocera, as it always is on a phone; else the system's text. */
	const onLine = $derived(target === 'batocera' || kind === 'phone');
	/** On a computer, a game in several files keeps the room of the system's three lines in every state (spec 3.1). */
	const tall = $derived(kind !== 'phone' && offered.some((os) => filesOf(os).length > 1));

	/** The line's live region (spec 7): a new state is said, not a send's new numbers, nor the first draw. */
	let said = $state('');
	let heard: Heard | null = null;
	$effect(() => {
		if (!bato || !watch) return;
		const now = { sentence: bato.view.line.spoken, on: target === 'batocera' && watch.answered };
		const line = lineAnnouncement(heard, now);
		if (line !== null) said = line;
		heard = now;
	});

	/**
	 * The note's two live regions (spec 7): a note is said once, when it comes or changes, a plain one politely and a
	 * bad one at once, with the countdown's clock as it came; the other region is emptied, and both when it goes.
	 */
	let noteStatus = $state('');
	let noteAlert = $state('');
	let noteHeard: string | null = null;
	$effect(() => {
		const shown = batoceraNote;
		if ((shown?.id ?? null) === noteHeard) return;
		noteHeard = shown?.id ?? null;
		const words = shown ? [shown.bold, shown.plain].filter((part) => part !== '').join(' ') : '';
		noteStatus = shown?.kind === 'plain' ? words : '';
		noteAlert = shown?.kind === 'bad' ? words : '';
	});

	function batoceraMain() {
		const does = bato?.view.main;
		if (does === 'send') void watch?.send();
		else if (does === 'stop') void watch?.stopJob();
		else if (does === 'play') void watch?.playNow(false);
	}

	/**
	 * The flag, "Doesn't run? Mark it" and "Take the mark back". The line with it shows only while the button is on
	 * Batocera, by a pick or by the preferred platform, which a marked game does not start on: the pick keeps it there (7.6).
	 */
	function markFromLine(mark: 'mark' | 'unmark') {
		picked = 'batocera';
		void watch?.mark(mark === 'mark');
	}

	function act(what: NoteAct) {
		if (!watch) return;
		if (what === 'keep') void watch.keepOn();
		else if (what === 'force') void watch.playNow(true);
		else if (what === 'cancel') watch.play = null;
		// "Update on Batocera" and "Try again" are a send.
		else void watch.send();
	}

	const primary = $derived(
		target === 'batocera'
			? !!bato?.view.primary
			: isPrimary(kind, visitor, system, system !== null && started[system] !== undefined, note)
	);
	// Everything the button can say. All of it is drawn and one is seen, so the button is as
	// wide as its longest label and keeps that width. A phone downloads nothing: Batocera's only.
	const labels = $derived([
		...(kind === 'phone' ? [] : [...offered.map((os) => t.download.button(os)), t.download.again]),
		...(shown ? Object.values(BATOCERA_LABELS) : [])
	]);
	const label = $derived(
		target === null
			? ''
			: target === 'batocera'
				? BATOCERA_LABELS[bato?.view.main ?? 'send']
				: started[target] === undefined
					? t.download.button(target)
					: t.download.again
	);
	const lastFiles = $derived(last ? filesOf(last) : []);
	const run = $derived(runFile(lastFiles));
</script>

<!-- The main button, its switch, and the line beside it; under them the note of Batocera. On a phone the button is Batocera's
     alone, and on a locked phone whose game is marked the line stands where the button would. -->
{#snippet mainRow()}
	<div class="dl-main">
		{#if target}
			<div class="split">
				<button
					class="btn btn-large"
					class:btn-primary={primary}
					class:bato-off={target === 'batocera' && bato?.view.disabled && !starting}
					type="button"
					disabled={target === 'batocera' ? !starting && (bato?.view.disabled ?? true) : busy}
					aria-disabled={starting ? 'true' : undefined}
					onclick={main}
				>
					<!-- The icon turns while Play waits for the box's answer. -->
					<span class="bato-icon" class:is-turning={starting}
						><Icon name={target === 'batocera' ? MAIN_ICON[bato?.view.main ?? 'send'] : 'download'} /></span
					>
					<span class="stack">
						{#each labels as text (text)}
							<span class:on={text === label} aria-hidden={text !== label}>{text}</span>
						{/each}
					</span>
				</button>
				{#if kind !== 'phone' && target && offered.length + (bato ? 1 : 0) > 1}
					<PlatformSwitch
						systems={offered}
						{target}
						own={kind === 'mine' ? (visitor as Os) : null}
						summary={summaryOf}
						{primary}
						flag={note ? { os: 'macos', sure: note.kind === 'gog' } : null}
						batocera={bato?.view.menu ?? null}
						onpick={pick}
					/>
				{/if}
			</div>
		{/if}
		{#if bato}
			{@const line = bato.view.line}
			<!-- The line's room (spec 2026-10-21, section 3): one size whatever the state, the lock or the system the button is
			     on, so nothing moves. On a system it holds the system's text, as before; on Batocera the game's state. -->
			<div class="about bato-line" class:is-tall={tall} class:has-flag={onLine && line.flag !== null} class:is-system={!onLine}>
				{#if !onLine}
					{#if system}
						{@const list = filesOf(system)}
						<span class="bato-system">
							<strong>{summaryOf(system)}</strong>
							{#if list.length > 1}
								{t.download.eachOnItsOwn}
							{:else if list[0]?.version}
								{t.download.version(list[0].version)}
							{/if}
						</span>
					{/if}
				{:else}
					<span class="bato-line-row">
						{#if line.tv === 'prohibit'}
							<!-- Not read out: the words say it. -->
							<span class="bato-prohibit" aria-hidden="true"><Icon name="prohibit" /></span>
						{:else}
							<span class="bato-tv"><TipButton icon="tv" label={t.batocera.tvName} tip={line.tv.tip} side="left" look="is-{line.tv.look}" /></span>
						{/if}
						<span class="bato-line-text">
							<strong class="bato-bold"
								>{line.bold}{#if line.check}<span class="bato-check" aria-hidden="true"><Icon name="check" /></span>{/if}</strong
							>
							<span class="bato-plain">{line.plain}</span>
						</span>
						{#if line.tv !== 'prohibit'}
							<!-- The flag's slot, then the "i"'s: one without its icon keeps its room, so the other never moves. -->
							<span class="bato-slots">
								<span class="bato-slot">
									{#if line.flag}
										{@const words = line.flag === 'mark' ? t.batocera.markIt : t.batocera.unmark}
										<TipButton
											icon={line.flag === 'mark' ? 'flag' : 'flagFill'}
											label={words}
											tip={words}
											side="right"
											look={line.flag === 'mark' ? undefined : 'is-marked'}
											onpress={() => line.flag && markFromLine(line.flag)}
										/>
									{/if}
								</span>
								<span class="bato-slot">
									{#if line.info}
										<TipButton icon="info" label={t.batocera.moreName} tip={line.info} side="right" />
									{/if}
								</span>
							</span>
						{/if}
					</span>
					{#if line.bar}
						<span
							class="bato-line-bar"
							role="progressbar"
							aria-label={line.bold}
							aria-valuemin={0}
							aria-valuemax={100}
							aria-valuenow={percentOf(line.bar.overall)}
							aria-valuetext={line.bar.text}
						>
							<span style:width="{Math.round(Math.min(1, Math.max(0, line.bar.overall)) * 1000) / 10}%"></span>
						</span>
					{/if}
				{/if}
				<span class="sr bato-said" aria-live="polite">{said}</span>
			</div>
			<!-- The note's words, said here once: there before any note comes, so that its coming is heard. -->
			<p class="sr bato-note-said" role="status">{noteStatus}</p>
			<p class="sr bato-note-said" role="alert">{noteAlert}</p>
		{:else}
			<!-- One text per system, in the same place, so that choosing a system moves nothing. -->
			<div class="about stack">
				{#each offered as os (os)}
					{@const list = filesOf(os)}
					<span class:on={os === target} aria-hidden={os !== target}>
						<strong>{summaryOf(os)}</strong>
						{#if list.length > 1}
							{t.download.eachOnItsOwn}
						{:else if list[0]?.version}
							{t.download.version(list[0].version)}
						{/if}
					</span>
				{/each}
			</div>
		{/if}
		{#if note && kind !== 'phone'}
			<!-- Its room is kept while the button is on another system: choosing a system moves nothing. -->
			<MacCaution {note} off={noteAt !== 'button'} />
		{/if}
	</div>
	{#if batoceraNote}
		<BatoceraNoteView note={batoceraNote} onact={act} />
	{/if}
{/snippet}

<div class="dl">
	<div class="dl-top">
		{#if kind === 'unread'}
			<div class="notice">
				<Icon name="info" />
				<div><strong>{t.download.unreadTitle}</strong><br />{t.download.unreadText}</div>
			</div>
		{:else if kind === 'no-files'}
			<div class="notice notice-bad">
				<Icon name="warning" />
				<div><strong>{t.download.noFilesTitle}</strong><br />{t.download.noFilesText}</div>
			</div>
		{:else if kind === 'phone'}
			{#if shown}
				{@render mainRow()}
			{/if}
			{#if shown}
				<!-- One quiet line under Batocera's: the link shows the files, and goes. -->
				<p class="caution dl-note bato-quiet">
					<Icon name="desktop" />
					<span
						>{t.download.phoneTitle}
						{#if !showFiles}<button class="link-button" type="button" onclick={() => (showFiles = true)}>{t.download.showFiles}</button>{/if}</span
					>
				</p>
			{:else}
				<div class="notice">
					<Icon name="desktop" />
					<div><strong>{t.download.phoneTitle}</strong><br />{t.download.phoneText}</div>
				</div>
				{#if !showFiles}
					<button class="btn btn-small" type="button" onclick={() => (showFiles = true)}>{t.download.showFiles}</button>
				{/if}
			{/if}
		{:else if kind === 'dlc-only'}
			<div class="notice">
				<Icon name="info" />
				<div><strong>{t.download.dlcOnlyTitle}</strong><br />{t.download.dlcOnlyText}</div>
			</div>
		{:else}
			{#if notFor}
				<div class="notice">
					<Icon name={notFor === 'batocera' ? 'tv' : notFor === 'other' ? 'info' : notFor} />
					<div><strong>{t.download.notForTitle(notFor)}</strong><br />{notFor === 'batocera' ? t.download.notForBatoceraText : t.download.notForText(offered)}</div>
				</div>
			{/if}
			{#if target}
				{@render mainRow()}
				{#if last && run}
					{@const count = started[last] ?? 0}
					<div class="notice notice-done" role="status">
						<Icon name="check" />
						<div>
							<strong>{t.download.started(count)}</strong><br />
							{t.download.whenFinished(count)}
							{t.download.runBefore[last]} <code>{run.filename}</code>{t.download.runAfter[last]}
							{#if lastFiles.length > 1}
								{t.download.keepTogether}<br />{t.download.nothingHappens}
							{/if}
						</div>
					</div>
				{/if}
			{/if}
		{/if}
		{#if unreachable}
			<div class="notice notice-bad" role="alert">
				<Icon name="warning" />
				<div><strong>{t.download.unreachableTitle}</strong> {t.download.unreachableText}</div>
			</div>
		{/if}
	</div>

	{#if tab && kind !== 'unread' && kind !== 'no-files' && (kind !== 'phone' || showFiles)}
		<div class="dl-list">
			<PlatformTabs
				{systems}
				{counts}
				{tab}
				panel={PANEL}
				note={version ? t.download.version(version) : null}
				onselect={choose}
			/>
			<div id={PANEL} role="tabpanel" aria-labelledby="{PANEL}-tab-{tab}">
				{#if files.length > 0}
					<FileList
						gameId={detail.id}
						files={visibleFiles(files, expanded)}
						inParts={files.length > 1}
						sharedVersion={version !== null}
						{missing}
						ondownload={one}
					/>
					{#if visibleFiles(files, expanded).length < files.length}
						<button class="btn btn-small files-more" type="button" onclick={() => (expanded = true)}>
							{t.download.showAll(files.length)}
						</button>
					{/if}
				{/if}
				{#if note && noteAt === 'list'}
					<MacCaution {note} inList />
				{/if}
				{#if detail.downloadLanguage}
					<p class="dl-note">{t.download.language(detail.downloadLanguage)}</p>
				{/if}
				{#if dlc.length > 0}
					<div class="dlc-block">
						<div class="dlc-head">
							<div>
								<h3>{t.download.dlcTitle}</h3>
								<p>{t.download.dlcText(target !== null)}</p>
							</div>
							{#if dlc.length > 1}
								<button class="btn btn-small" type="button" disabled={busy} onclick={() => start(dlc.flatMap((d) => d.files))}>
									<Icon name="download" />{t.download.dlcAll}
								</button>
							{/if}
						</div>
						<ul class="files">
							{#each dlc as item (item.files[0].fileId)}
								<li class="file">
									<span class="name">{item.title}</span>
									<span class="fn">{item.files.length === 1 ? item.files[0].filename : t.download.files(item.files.length)}</span>
									<span class="ver"></span>
									<span class="size">{formatSize(totalBytes(item.files))}</span>
									{#if item.files.length === 1}
										<a
											class="icon-btn"
											href={downloadUrl(detail.id, item.files[0].fileId)}
											download
											title={t.download.downloadFile(item.title)}
											onclick={(event) => one(event, item.files[0])}
										>
											<Icon name="download" /><span class="sr">{t.download.downloadFile(item.title)}</span>
										</a>
									{:else}
										<button class="icon-btn" type="button" title={t.download.downloadFile(item.title)} disabled={busy} onclick={() => start(item.files)}>
											<Icon name="download" /><span class="sr">{t.download.downloadFile(item.title)}</span>
										</button>
									{/if}
									{#if item.files.some((file) => missing.includes(file.fileId))}
										<span class="bad" role="alert">{t.download.fileMissing}</span>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	{#if theoShown(theo, kind, detail.downloadLanguage)}
		<!-- Between the files and the extras, for a game with files at a computer (0.11.0). -->
		<TheoPanel id={detail.id} />
	{/if}

	{#if detail.extras.length > 0}
		<!-- Extras belong to no system: a panel of their own, which a phone sees too. -->
		<Extras gameId={detail.id} extras={detail.extras} {missing} ondownload={one} />
	{/if}
</div>
