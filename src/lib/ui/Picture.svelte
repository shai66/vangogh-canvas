<script lang="ts">
	interface Props {
		/** An image id of the index. */
		id: string;
		class?: string;
		/** False for a picture that is on screen as soon as it is drawn. */
		lazy?: boolean;
		/** Called when the picture cannot be shown. */
		onfail?: () => void;
		/** Called when the picture is there. */
		onshow?: () => void;
	}
	let { id, class: kind = '', lazy = true, onfail, onshow }: Props = $props();

	let node: HTMLImageElement;

	// Lets the picture fade in when it has loaded, and reports one that cannot
	// be shown. A picture drawn by the server may have loaded, or failed, before
	// the page came alive: its events are gone by then, so its state is read.
	//
	// Svelte's `onload` and `onerror` attributes, and its actions, make the
	// server write a small script into each picture for that case. The content
	// security policy forbids such scripts, so the events are listened to here.
	$effect(() => {
		id;
		const shown = () => {
			node.classList.remove('is-waiting');
			onshow?.();
		};
		const failed = () => onfail?.();
		if (!node.complete) node.classList.add('is-waiting');
		else if (node.naturalWidth === 0) failed();
		else shown();
		node.addEventListener('load', shown);
		node.addEventListener('error', failed);
		return () => {
			node.removeEventListener('load', shown);
			node.removeEventListener('error', failed);
		};
	});
</script>

<img bind:this={node} class={kind} src="/img/{id}" alt="" loading={lazy ? 'lazy' : 'eager'} decoding="async" />
