<script lang="ts">
	import type { Target } from '$lib/download/plan';
	import { t } from '$lib/strings';
	import type { Os } from '$lib/types';
	import Icon from './Icon.svelte';

	interface Props {
		/** The systems to choose from: those the game itself has files for. */
		systems: Os[];
		/** What the main button is for now: a system, or Batocera. */
		target: Target;
		/** The visitor's own system, which the menu marks. Null when it is none of these. */
		own: Os | null;
		/** What a system holds: "3 files, 7.5 GB". */
		summary: (os: Os) => string;
		/** True while the main button is yellow: the arrow is part of the same shape. */
		primary: boolean;
		/** The system whose row carries the sign of a note, and whether GOG itself says it. Null when there is no note. */
		flag: { os: Os; sure: boolean } | null;
		/** The row of Batocera after the systems, with its state; null while Batocera is not shown (spec 0.12.0, section 7.1). */
		batocera: { text: string; on: boolean; disabled: boolean } | null;
		onpick: (target: Target) => void;
	}
	let { systems, target, own, summary, primary, flag, batocera, onpick }: Props = $props();

	const name = $derived(batocera ? t.download.anotherOrBatocera : t.download.another);
	/** Every state the row of Batocera can say, in one place, so that the menu keeps its width while it changes. */
	const states = Object.values(t.batocera.menu);

	let open = $state(false);
	let arrow: HTMLButtonElement;
	let menu = $state<HTMLElement>();

	function close(refocus: boolean) {
		open = false;
		if (refocus) arrow.focus();
	}

	function pick(to: Target) {
		onpick(to);
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
	title={name}
	onclick={() => (open = !open)}
	onkeydown={keydown}
>
	<Icon name="down" /><span class="sr">{name}</span>
</button>
{#if open}
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div class="menu" role="menu" aria-label={name} bind:this={menu} onkeydown={keydown}>
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
		{#if batocera}
			{@const off = batocera.disabled}
			<div class="menu-sep" role="separator"></div>
			<!-- A row that cannot be picked stays in the keys' way, as a menu's disabled item does. -->
			<button
				type="button"
				role="menuitemradio"
				aria-checked={target === 'batocera'}
				aria-disabled={off || undefined}
				tabindex="-1"
				onclick={() => off || pick('batocera')}
			>
				<Icon name="tv" />
				<span class="name">{t.batocera.name}</span>
				<span class="n stack" class:is-on={batocera.on}>
					{#each states as text (text)}
						<span class:on={text === batocera.text} aria-hidden={text !== batocera.text}>{text}</span>
					{/each}
				</span>
				<span class="check"><Icon name="check" /></span>
			</button>
		{/if}
	</div>
{/if}
