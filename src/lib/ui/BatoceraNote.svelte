<script lang="ts">
	import type { BatoceraNote, NoteAct } from '$lib/download/batocera-view';
	import { t } from '$lib/strings';
	import Icon from './Icon.svelte';
	import TipButton from './TipButton.svelte';

	interface Props {
		note: BatoceraNote;
		onact: (act: NoteAct) => void;
	}
	let { note, onact }: Props = $props();
</script>

<!-- The note of Batocera under the main button (spec 2026-10-21, section 4): one shape and one height per size, whatever
     its text and buttons. Its words are said once by the download block's live regions, so the text is not read here. -->
<div class="notice bato-note" class:notice-bad={note.kind === 'bad'}>
	<span class="bato-icon"><Icon name={note.icon} /></span>
	<p class="bato-note-text" aria-hidden="true"><strong>{note.bold}</strong> {note.plain}</p>
	{#if note.info || note.acts.length > 0}
		<div class="bato-acts">
			<!-- N7's own "i" leads the buttons, so the text keeps its width: it holds the reason in full. -->
			{#if note.info}
				<TipButton icon="info" label={t.batocera.moreName} tip={note.info} side="right" />
			{/if}
			<!-- While this page's Play waits for its answer, the buttons wait too (rows 18 and 19). -->
			{#each note.acts as a (a.act)}
				<button class="btn btn-small" class:btn-primary={a.primary} type="button" disabled={note.busy} onclick={() => onact(a.act)}>{a.label}</button>
			{/each}
		</div>
	{/if}
</div>
