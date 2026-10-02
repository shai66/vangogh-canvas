<script lang="ts">
	import { formatSize } from '$lib/format';
	import {
		blockKind,
		buttonForTab,
		buttonSystems,
		buttonTarget,
		dlcFor,
		firstTab,
		isPrimary,
		macNote,
		notePlace,
		runFile,
		sharedVersion,
		systemsOf,
		totalBytes,
		visibleFiles
	} from '$lib/download/plan';
	import { browserStarter, downloadUrl, startDownloads, type Starter } from '$lib/download/start';
	import { t } from '$lib/strings';
	import type { Detail, FileEntry, Os } from '$lib/types';
	import type { Visitor } from '$lib/visitor';
	import Extras from './Extras.svelte';
	import FileList from './FileList.svelte';
	import Icon from './Icon.svelte';
	import MacCaution from './MacCaution.svelte';
	import PlatformSwitch from './PlatformSwitch.svelte';
	import PlatformTabs from './PlatformTabs.svelte';

	interface Props {
		detail: Detail;
		visitor: Visitor;
		/** Told the system the file list shows, whenever it changes. The system requirements follow it. */
		onsystem?: (os: Os | null) => void;
		/** Tests hand in their own. */
		starter?: Starter;
	}
	let { detail, visitor, onsystem, starter = browserStarter }: Props = $props();

	const PANEL = 'files-panel';

	const kind = $derived(blockKind(detail, visitor));
	const systems = $derived(systemsOf(detail));
	let chosen = $state<Os | null>(null);
	const tab = $derived(chosen && systems.includes(chosen) ? chosen : firstTab(detail, visitor));
	const files = $derived(tab ? (detail.downloads[tab] ?? []) : []);
	$effect(() => {
		onsystem?.(tab);
	});

	// The main button downloads for the visitor's own system, until another is picked with
	// the switch or with a tab of the file list: the two follow each other. The pick lives here
	// and nowhere else: a detail that is opened again is a new block, and starts on the
	// visitor's own system.
	const offered = $derived(buttonSystems(detail));
	let picked = $state<Os | null>(null);
	const target = $derived(buttonTarget(detail, visitor, picked));
	const filesOf = (os: Os) => detail.downloads[os] ?? [];
	const summaryOf = (os: Os) => t.download.summary(filesOf(os).length, formatSize(totalBytes(filesOf(os))));
	const dlc = $derived(tab ? dlcFor(detail, tab) : []);
	const counts = $derived(Object.fromEntries(systems.map((os) => [os, detail.downloads[os]?.length ?? 0])));
	const version = $derived(sharedVersion(files));
	// What is known against the macOS installer, and where it is said: under the button
	// while the button is on macOS, otherwise with the macOS files.
	const note = $derived(macNote(detail));
	const noteAt = $derived(notePlace(note, target, tab));

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
		if (busy || !target) return;
		const system = target;
		const count = await start(filesOf(system));
		if (count > 0) {
			started = { ...started, [system]: count };
			last = system;
		}
	}

	/** The switch: the button turns to the system, and the file list with it. */
	function pick(os: Os) {
		picked = os;
		chosen = os;
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

	const primary = $derived(isPrimary(kind, visitor, target, target !== null && started[target] !== undefined, note));
	// Everything the button can say. All of it is drawn and one is seen, so the button is as
	// wide as its longest label and keeps that width.
	const labels = $derived([...offered.map((os) => t.download.button(os)), t.download.again]);
	const label = $derived(
		target === null ? '' : started[target] === undefined ? t.download.button(target) : t.download.again
	);
	const lastFiles = $derived(last ? filesOf(last) : []);
	const run = $derived(runFile(lastFiles));
</script>

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
			<div class="notice">
				<Icon name="desktop" />
				<div><strong>{t.download.phoneTitle}</strong><br />{t.download.phoneText}</div>
			</div>
			{#if !showFiles}
				<button class="btn btn-small" type="button" onclick={() => (showFiles = true)}>{t.download.showFiles}</button>
			{/if}
		{:else if kind === 'dlc-only'}
			<div class="notice">
				<Icon name="info" />
				<div><strong>{t.download.dlcOnlyTitle}</strong><br />{t.download.dlcOnlyText}</div>
			</div>
		{:else}
			{#if kind !== 'mine'}
				<div class="notice">
					<Icon name={kind === 'not-mine' ? (visitor as Os) : 'info'} />
					<div><strong>{t.download.notForTitle(visitor)}</strong><br />{t.download.notForText(offered)}</div>
				</div>
			{/if}
			{#if target}
				<div class="dl-main">
					<div class="split">
						<button class="btn btn-large" class:btn-primary={primary} type="button" disabled={busy} onclick={main}>
							<Icon name="download" />
							<span class="stack">
								{#each labels as text (text)}
									<span class:on={text === label} aria-hidden={text !== label}>{text}</span>
								{/each}
							</span>
						</button>
						{#if offered.length > 1}
							<PlatformSwitch
								systems={offered}
								{target}
								own={kind === 'mine' ? (visitor as Os) : null}
								summary={summaryOf}
								{primary}
								flag={note ? { os: 'macos', sure: note.kind === 'gog' } : null}
								onpick={pick}
							/>
						{/if}
					</div>
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
					{#if note}
						<!-- Its room is kept while the button is on another system: choosing a system moves nothing. -->
						<MacCaution {note} off={noteAt !== 'button'} />
					{/if}
				</div>
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

	{#if detail.extras.length > 0}
		<!-- Extras belong to no system: a panel of their own, which a phone sees too. -->
		<Extras gameId={detail.id} extras={detail.extras} {missing} ondownload={one} />
	{/if}
</div>
