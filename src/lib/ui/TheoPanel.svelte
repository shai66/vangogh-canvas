<script lang="ts">
	import { t, THEO_URL } from '$lib/strings';
	import { copyText } from './copy';
	import Icon from './Icon.svelte';

	interface Props {
		/** The game's id in Canvas, which is GOG's product id: the one theo takes. */
		id: string;
	}
	let { id }: Props = $props();

	const command = $derived(t.theo.command(id));
	let code = $state<HTMLElement>();
	let copied = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(copiedTimer));

	async function copy() {
		if (await copyText(command)) {
			copied = true;
			clearTimeout(copiedTimer);
			copiedTimer = setTimeout(() => (copied = false), 1600);
		} else if (code) {
			// Neither way worked: the command is selected, so Ctrl+C or Cmd+C copies it.
			const range = document.createRange();
			range.selectNodeContents(code);
			const selection = getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
		}
	}
</script>

<div class="theo-panel">
	<div>
		<div class="t"><Icon name="terminal" />{t.theo.title}</div>
		<p class="what">{t.theo.text} <a href={THEO_URL} target="_blank" rel="noreferrer">{t.theo.about}<Icon name="external" /></a></p>
	</div>
	<div class="theo-cmdbox">
		<code class="theo-cmd" bind:this={code}>{command}</code>
		<!-- Both labels are drawn and one is seen, so the button is as wide as "Copied" and keeps that width. -->
		<button class="btn btn-small theo-copy" type="button" aria-label={t.theo.copyLabel} onclick={copy}>
			<span class="stack">
				<span class:on={!copied}><Icon name="copy" />{t.theo.copy}</span>
				<span class:on={copied}><Icon name="check" />{t.theo.copied}</span>
			</span>
		</button>
	</div>
</div>
