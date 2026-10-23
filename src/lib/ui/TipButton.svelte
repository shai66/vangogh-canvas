<script lang="ts">
	import Icon from './Icon.svelte';
	import type { IconName } from './icons';
	import { nextTip, tips, type TipEvent } from './tip.svelte';

	interface Props {
		icon: IconName;
		/** The button's name for a screen reader. */
		label: string;
		/** The words of the tooltip. */
		tip: string;
		/** The edge of the icon the tooltip starts from: its left (the TV) or its right (the "i", the flag). */
		side: 'left' | 'right';
		/** A class of the button's own look, as the flag's once marked. */
		look?: string;
		/** A press that acts (the flag): its tooltip only shows while pointed at or focused, and names the button. */
		onpress?: () => void;
	}
	let { icon, label, tip, side, look, onpress }: Props = $props();

	const id = $props.id();
	const open = $derived(tips.open?.id === id);
	let below = $state(false);
	let wrap = $state<HTMLElement>();
	let button = $state<HTMLButtonElement>();
	let text = $state<HTMLElement>();

	function send(event: TipEvent) {
		tips.open = nextTip(tips.open, event);
	}

	function pointer(event: PointerEvent, kind: 'enter' | 'leave') {
		// A finger's tap is a click; only a mouse points.
		if (event.pointerType === 'mouse') send({ kind, id });
	}

	// While it is open a click anywhere else closes it, and Esc closes it and leaves the detail open: the detail is a
	// <dialog>, which takes Esc as "close me", so its `cancel` is stopped here on its way down, as the switch's menu does.
	$effect(() => {
		if (!open || !button || !text) return;
		// Below its icon when the window has no room for it above.
		below = button.getBoundingClientRect().top < text.offsetHeight + 12;
		const away = (event: MouseEvent) => {
			if (!(event.target instanceof Node) || !wrap?.contains(event.target)) send({ kind: 'away' });
		};
		const keydown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			send({ kind: 'escape' });
		};
		const cancel = (event: Event) => {
			event.preventDefault();
			event.stopPropagation();
			send({ kind: 'escape' });
		};
		document.addEventListener('click', away, true);
		document.addEventListener('keydown', keydown, true);
		document.addEventListener('cancel', cancel, true);
		return () => {
			document.removeEventListener('click', away, true);
			document.removeEventListener('keydown', keydown, true);
			document.removeEventListener('cancel', cancel, true);
		};
	});

	// A button that goes while its tooltip is open closes it.
	$effect(() => () => {
		if (tips.open?.id === id) tips.open = null;
	});
</script>

<!-- Pointing is for a mouse alone: the keyboard has the button's focus, a finger its tap. The tooltip is inside, so
     it stays while the pointer is over it. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
	class="tip"
	class:is-open={open}
	class:is-left={side === 'left'}
	class:is-below={below}
	bind:this={wrap}
	onpointerenter={(event) => pointer(event, 'enter')}
	onpointerleave={(event) => pointer(event, 'leave')}
>
	<button
		bind:this={button}
		type="button"
		class={['tip-btn', look]}
		aria-label={label}
		aria-describedby={onpress ? undefined : id}
		onfocus={() => button?.matches(':focus-visible') && send({ kind: 'focus', id })}
		onblur={() => send({ kind: 'blur', id })}
		onclick={() => (onpress ? onpress() : send({ kind: 'tap', id }))}
	>
		<Icon name={icon} />
	</button>
	<!-- The flag's tooltip says its name again: a screen reader reads it once. -->
	<span class="tip-text" {id} role={onpress ? undefined : 'tooltip'} aria-hidden={onpress ? 'true' : undefined} bind:this={text}
		>{tip}</span
	>
</span>
