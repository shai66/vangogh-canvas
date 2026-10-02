<script lang="ts">
	import { kindCounts } from '$lib/extras';
	import { downloadUrl } from '$lib/download/start';
	import { formatSize, upperFirst } from '$lib/format';
	import { t } from '$lib/strings';
	import type { ExtraFile } from '$lib/types';
	import Icon from './Icon.svelte';
	import { extraIcon } from './icons';

	interface Props {
		gameId: string;
		extras: ExtraFile[];
		/** Ids of the files that turned out to be missing in the archive. */
		missing: string[];
		ondownload: (event: MouseEvent, file: ExtraFile) => void;
	}
	let { gameId, extras, missing, ondownload }: Props = $props();

	const LIST = 'extras-list';
	// Folded at first. A detail that is opened again is a new panel, and starts folded.
	let open = $state(false);
	const total = $derived(extras.reduce((sum, e) => sum + (Number.isFinite(e.sizeBytes) ? e.sizeBytes : 0), 0));
	const kinds = $derived(t.extras.kinds(kindCounts(extras.map((e) => e.kind))));
	/** GOG writes many names in lower case. A nameless extra is called by its kind. */
	const nameOf = (extra: ExtraFile) => upperFirst(extra.name) || t.extras.kind(extra.kind);
</script>

<div class="extras" class:is-open={open}>
	<!-- The head is one button. It keeps its height open and folded, so opening only adds rows below it. -->
	<button class="extras-head" type="button" aria-expanded={open} aria-controls={LIST} onclick={() => (open = !open)}>
		<span class="t"><Icon name="gift" />{t.extras.title}<span class="n">{t.download.summary(extras.length, formatSize(total))}</span></span>
		<span class="kinds">{kinds}</span>
		<span class="caret"><Icon name="down" /></span>
	</button>
	{#if open}
		<ul class="files" id={LIST}>
			{#each extras as extra (extra.fileId)}
				<li class="file is-extra">
					<span class="kind" title={t.extras.kind(extra.kind)}><Icon name={extraIcon(extra.kind)} /><span>{t.extras.kind(extra.kind)}</span></span>
					<span class="name">{nameOf(extra)}</span>
					<span class="size">{formatSize(extra.sizeBytes)}</span>
					<!-- A link, so it works without scripts and can be copied. With scripts the file is checked first. -->
					<a
						class="icon-btn"
						href={downloadUrl(gameId, extra.fileId)}
						download
						title={t.download.downloadFile(nameOf(extra))}
						onclick={(event) => ondownload(event, extra)}
					>
						<Icon name="download" /><span class="sr">{t.download.downloadFile(nameOf(extra))}</span>
					</a>
					{#if missing.includes(extra.fileId)}
						<span class="bad" role="alert">{t.download.fileMissing}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
