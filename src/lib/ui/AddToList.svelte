<script lang="ts">
	import { byTitle, type Band } from '$lib/own';
	import { t } from '$lib/strings';
	import Icon from './Icon.svelte';
	import OwnPicture from './OwnPicture.svelte';

	interface Props {
		/** How many are picked. */
		count: number;
		/** The own collections the picks can go into. */
		choices: { id: string; name: string; games: number; bands: Band[] }[];
		onchoose: (id: string) => void;
		onnew: () => void;
		/** Esc, or a click beside the list. */
		onclose: () => void;
	}
	let { count, choices, onchoose, onnew, onclose }: Props = $props();

	const sorted = $derived([...choices].sort((a, b) => byTitle(a.name, b.name)));

	let pop: HTMLElement;
	/** The button that opened the list. */
	let opener: Element | null = null;

	/** The list closes: the focus, when it was in the list, goes back to the button that opened it. */
	function back() {
		if (pop.contains(document.activeElement) && opener instanceof HTMLElement) opener.focus();
	}

	/** The room above the button, to 12 px under the window's top, less the 10 px between the list and its button: in a
	 *  sheet that fits the window the bar stands under the cards, high up, and a list above the sheet's top could not be
	 *  scrolled to. */
	function fit() {
		const wrap = pop.parentElement ?? pop;
		pop.style.setProperty('--addto-room', `${wrap.getBoundingClientRect().top - 12 - 10}px`);
	}

	$effect(() => {
		opener = document.activeElement;
		fit();
		// Before the page's own keys, which would end picking on Esc.
		const key = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			back();
			onclose();
		};
		// A click beside it only closes it: it does not reach what it was on, a card, Cancel or Select, so the picks stay.
		// The button it hangs from, in the same parent, opens and closes it itself.
		const click = (event: MouseEvent) => {
			if (event.target instanceof Node && (pop.parentElement ?? pop).contains(event.target)) return;
			// A card is a link: its address is not followed either.
			event.preventDefault();
			event.stopPropagation();
			onclose();
		};
		window.addEventListener('keydown', key, true);
		window.addEventListener('click', click, true);
		window.addEventListener('resize', fit);
		return () => {
			window.removeEventListener('keydown', key, true);
			window.removeEventListener('click', click, true);
			window.removeEventListener('resize', fit);
		};
	});
</script>

<!-- "Add to…" (spec of own collections, section 8.3): above its button, every own collection A to Z with its small
     picture, its name and its number of games, then "New collection…". -->
<div class="addto-pop" role="group" aria-label={t.own.addHead(count)} bind:this={pop}>
	<p class="addto-head" aria-hidden="true">{t.own.addHead(count)}</p>
	{#each sorted as choice (choice.id)}
		<button
			class="addto-row"
			type="button"
			onclick={() => {
				back();
				onchoose(choice.id);
			}}
		>
			<span class="addto-thumb"><OwnPicture bands={choice.bands} small /></span>
			<span class="addto-name">{choice.name}</span>
			<span class="addto-count" aria-hidden="true">{choice.games}</span><span class="sr">{t.collections.games(choice.games)}</span>
		</button>
	{/each}
	<button
		class="addto-row addto-new"
		type="button"
		onclick={() => {
			back();
			onnew();
		}}
	>
		<span class="addto-plus"><Icon name="plus" /></span><span class="addto-name">{t.own.addNew}</span>
	</button>
</div>
