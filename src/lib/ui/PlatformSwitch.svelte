<script lang="ts">
	import { t } from '$lib/strings';
	import type { Os } from '$lib/types';
	import Icon from './Icon.svelte';

	interface Props {
		/** The systems to choose from: those the game itself has files for. */
		systems: Os[];
		/** The one the main button downloads for now. */
		target: Os;
		/** The visitor's own system, which the menu marks. Null when it is none of these. */
		own: Os | null;
		/** What a system holds: "3 files, 7.5 GB". */
		summary: (os: Os) => string;
		/** True while the main button is yellow: the arrow is part of the same shape. */
		primary: boolean;
		/** The system whose row carries the sign of a note, and whether GOG itself says it. Null when there is no note. */
		flag: { os: Os; sure: boolean } | null;
		onpick: (os: Os) => void;
	}
	let { systems, target, own, summary, primary, flag, onpick }: Props = $props();

	let open = $state(false);
	let arrow: HTMLButtonElement;
	let menu = $state<HTMLElement>();

	function close(refocus: boolean) {
		open = false;
		if (refocus) arrow.focus();
	}

	function pick(os: Os) {
		onpick(os);
		close(true);
	}

	// While the menu is open a click anywhere else closes it, and Esc closes it and
	// nothing more. The detail is a <dialog>, which takes Esc as "close me": its
	// `cancel` event is stopped here, on its way down, before the sheet sees it.
	$effect(() => {
		if (!open) return;
		menu?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
		const away = (event: MouseEvent) => {
			const at = event.target;
			if (!(at instanceof Node) || !(arrow.contains(at) || menu?.contains(at))) close(false);
		};
		const cancel = (event: Event) => {
			event.preventDefault();
			event.stopPropagation();
			close(true);
		};
		document.addEventListener('click', away, true);
		document.addEventListener('cancel', cancel, true);
		return () => {
			document.removeEventListener('click', away, true);
			document.removeEventListener('cancel', cancel, true);
		};
	});

	function keydown(event: KeyboardEvent) {
		if (!open) {
			// As a menu button does: down opens it.
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				open = true;
			}
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close(true);
			return;
		}
		if (event.key === 'Tab') {
			// The focus goes on from the arrow, as if the menu had not been there.
			close(true);
			return;
		}
		const items = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
		const at = items.indexOf(document.activeElement as HTMLElement);
		const to =
			event.key === 'ArrowDown' ? (at + 1) % items.length
			: event.key === 'ArrowUp' ? (Math.max(at, 0) - 1 + items.length) % items.length
			: event.key === 'Home' ? 0
			: event.key === 'End' ? items.length - 1
			: -1;
		if (to < 0) return;
		event.preventDefault();
		items[to]?.focus();
	}
</script>

<button
	bind:this={arrow}
	class="btn btn-large split-more"
	class:btn-primary={primary}
	type="button"
	aria-haspopup="menu"
	aria-expanded={open}
	title={t.download.another}
	onclick={() => (open = !open)}
	onkeydown={keydown}
>
	<Icon name="down" /><span class="sr">{t.download.another}</span>
</button>
{#if open}
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div class="menu" role="menu" aria-label={t.download.another} bind:this={menu} onkeydown={keydown}>
		{#each systems as os (os)}
			<button type="button" role="menuitemradio" aria-checked={os === target} tabindex="-1" onclick={() => pick(os)}>
				<Icon name={os} />
				<span class="name"
					>{t.osName[os]}{#if flag?.os === os}{' '}<span
							class="flag"
							class:is-sure={flag.sure}
							title={t.download.hasNotice}><Icon name={flag.sure ? 'warning' : 'info'} /><span class="sr">{t.download.hasNotice}</span></span
						>{/if}{#if os === own}{' '}<span class="here">{t.download.thisComputer}</span>{/if}</span
				>
				<span class="n">{summary(os)}</span>
				<span class="check"><Icon name="check" /></span>
			</button>
		{/each}
	</div>
{/if}
