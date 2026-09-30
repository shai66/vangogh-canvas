<script lang="ts">
	import { downloadUrl } from '$lib/download/start';
	import { partLabel } from '$lib/download/plan';
	import { t } from '$lib/strings';
	import type { FileEntry } from '$lib/types';
	import Icon from './Icon.svelte';

	interface Props {
		gameId: string;
		files: FileEntry[];
		/** True when the files are parts of one game: each is named by its part. */
		inParts: boolean;
		/** True when the version stands once above the list. */
		sharedVersion: boolean;
		/** Ids of the files that turned out to be missing in the archive. */
		missing: string[];
		ondownload: (event: MouseEvent, file: FileEntry) => void;
	}
	let { gameId, files, inParts, sharedVersion, missing, ondownload }: Props = $props();
</script>

<ul class="files">
	{#each files as file (file.fileId)}
		<li class="file">
			<span class="name">
				{partLabel(file, inParts)}
				{#if file.run && inParts}
					<span class="run"><Icon name="run" />{t.download.openThis}</span>
				{/if}
			</span>
			<span class="fn" title={file.filename}>{file.filename}</span>
			<span class="ver">{!sharedVersion && file.version ? t.download.version(file.version) : ''}</span>
			<span class="size">{file.sizeText}</span>
			<!-- A link, so it works without scripts and can be copied. With scripts the file is checked first. -->
			<a
				class="icon-btn"
				href={downloadUrl(gameId, file.fileId)}
				download
				title={t.download.downloadFile(file.filename)}
				onclick={(event) => ondownload(event, file)}
			>
				<Icon name="download" /><span class="sr">{t.download.downloadFile(file.filename)}</span>
			</a>
			{#if missing.includes(file.fileId)}
				<span class="bad" role="alert">{t.download.fileMissing}</span>
			{/if}
		</li>
	{/each}
</ul>
