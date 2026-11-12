<script lang="ts">
	import { OWN_NAME_MAX, ownName, type Band } from '$lib/own';
	import { t } from '$lib/strings';
	import Icon from './Icon.svelte';
	import OwnPicture from './OwnPicture.svelte';

	interface Props {
		/** The strips of what will go into it. */
		bands: Band[];
		/** What will go into it: "2 games and 1 GOG collection". */
		what: string;
		/** True when another own collection has that name, letter case ignored. */
		taken: (name: string) => boolean;
		/** Why the last "Create" failed, or null. */
		error: string | null;
		/** "Create", with the name trimmed. */
		oncreate: (name: string) => void;
		onclose: () => void;
	}
	let { bands, what, taken, error, oncreate, onclose }: Props = $props();

	let name = $state('');
	const valid = $derived(ownName(name));
	const isTaken = $derived(valid !== null && taken(valid));
	const line = $derived(isTaken ? t.own.taken : (error ?? ''));

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (valid !== null && !isTaken) oncreate(valid);
	}
</script>

<!-- The dialog "New collection" (spec of own collections, section 8.4), in the look of the PIN prompt: the picture of
     what is picked with the typed name under it, and a field for the name. -->
<div class="pin-inner">
	<div class="detail-close-holder">
		<button class="detail-close" type="button" onclick={onclose}>
			<Icon name="close" /><span class="sr">{t.detail.close}</span>
		</button>
	</div>
	<div class="new-preview">
		<div class="poster"><OwnPicture {bands} lazy={false} /></div>
		<div class="new-name">{name}</div>
	</div>
	<h1 class="pin-title">{t.own.newCollection}</h1>
	<p class="pin-text">{t.own.newText(what)}</p>
	<form class="pin-form" onsubmit={submit}>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			bind:value={name}
			class="pin-field name-field"
			class:is-wrong={isTaken}
			type="text"
			placeholder={t.own.name}
			maxlength={OWN_NAME_MAX}
			autocomplete="off"
			aria-label={t.own.name}
			aria-invalid={isTaken}
			autofocus
		/>
		<!-- The line keeps its height while empty, so a message moves nothing. -->
		<p class="pin-error" role="alert">{line}</p>
		<button class="btn btn-primary pin-unlock" type="submit" disabled={valid === null || isTaken}>{t.own.create}</button>
	</form>
</div>
