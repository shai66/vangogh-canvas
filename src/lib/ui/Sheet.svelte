<script lang="ts">
	import type { Snippet } from 'svelte';
	import { lockPage, unlockPage } from './lock';

	interface Props {
		open: boolean;
		/** Called when the visitor closes the sheet: Esc, or a click beside it. */
		onclose: () => void;
		class?: string;
		label: string;
		children: Snippet;
	}
	let { open, onclose, class: kind = '', label, children }: Props = $props();

	let dialog: HTMLDialogElement;
	let locked = false;
	/** True between closing the dialog from here and its `close` event, which comes a moment later. */
	let closedHere = false;
	/** Where the last press began. A press on the sheet that ends beside it selects text; it does not close. */
	let pressed: EventTarget | null = null;

	// The browser's own modal dialog: it keeps the focus inside, closes on Esc,
	// makes the page behind inert, and gives the focus back when it closes.
	$effect(() => {
		if (open && !dialog.open) {
			lockPage();
			locked = true;
			dialog.showModal();
			// Opening moves the focus into the sheet, which can scroll it. It starts at its top.
			dialog.scrollTop = 0;
		} else if (!open && dialog.open) {
			closedHere = true;
			dialog.close();
		}
		if (!open && locked) {
			unlockPage();
			locked = false;
		}
	});

	$effect(() => () => {
		if (locked) unlockPage();
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
	bind:this={dialog}
	class={kind}
	aria-label={label}
	oncancel={(event) => {
		// Esc. The owner decides: it closes the sheet by setting `open` to false.
		event.preventDefault();
		onclose();
	}}
	onclose={() => {
		// The event of a close made here arrives late, perhaps after the sheet was
		// opened again. Taking it for the visitor's wish would close the new one.
		if (closedHere) closedHere = false;
		else if (open) onclose();
	}}
	onpointerdown={(event) => (pressed = event.target)}
	onclick={(event) => event.target === dialog && pressed === dialog && onclose()}
>
	{#if open}{@render children()}{/if}
</dialog>
