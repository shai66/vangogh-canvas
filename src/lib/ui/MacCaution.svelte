<script lang="ts">
	import type { MacNote } from '$lib/download/plan';
	import { t } from '$lib/strings';
	import Icon from './Icon.svelte';

	interface Props {
		note: MacNote;
		/** True for the note in the file list, which is set as the other notes there. */
		inList?: boolean;
		/** True to keep the room of the note and show nothing. */
		off?: boolean;
	}
	let { note, inList = false, off = false }: Props = $props();
</script>

<!-- GOG's words are shown as text. -->
<p class="caution" class:is-sure={note.kind === 'gog'} class:dl-note={inList} class:is-off={off} aria-hidden={off}>
	<Icon name={note.kind === 'gog' ? 'warning' : 'info'} />
	<span>
		{#if note.kind === 'gog'}
			<b>{t.download.macNoticeBy}</b> {note.text}
		{:else}
			{t.download.macUnlisted}
		{/if}
	</span>
</p>
