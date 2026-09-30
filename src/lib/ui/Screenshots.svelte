<script lang="ts">
	import { t } from '$lib/strings';
	import Icon from './Icon.svelte';
	import Picture from './Picture.svelte';
	import Sheet from './Sheet.svelte';

	let { screenshots }: { screenshots: string[] } = $props();

	// A screenshot that cannot be shown is left out.
	let failed = $state<string[]>([]);
	const shots = $derived(screenshots.filter((id) => !failed.includes(id)));

	let strip = $state<HTMLElement>();
	let atStart = $state(true);
	let atEnd = $state(false);
	function measure() {
		if (!strip) return;
		atStart = strip.scrollLeft < 8;
		atEnd = strip.scrollLeft + strip.clientWidth > strip.scrollWidth - 8;
	}
	$effect(() => {
		shots;
		measure();
	});
	function move(direction: number) {
		strip?.scrollBy({ left: direction * strip.clientWidth * 0.8, behavior: 'smooth' });
	}

	/** The screenshot in the larger view, or null. */
	let large = $state<number | null>(null);
	const step = (by: number) => {
		if (large !== null && shots.length > 0) large = (large + by + shots.length) % shots.length;
	};
</script>

{#if shots.length > 0}
	<div class="shots-wrap">
		<h2 class="section-title">{t.detail.screenshots} <span>{shots.length}</span></h2>
		<button class="shots-arrow prev" type="button" disabled={atStart} onclick={() => move(-1)}>
			<Icon name="left" /><span class="sr">{t.detail.earlier}</span>
		</button>
		<div class="shots" bind:this={strip} onscroll={measure}>
			{#each shots as id, position (id)}
				<button class="shot" type="button" onclick={() => (large = position)}>
					<Picture {id} onfail={() => (failed = [...failed, id])} onshow={measure} />
					<span class="sr">{t.detail.larger(position + 1)}</span>
				</button>
			{/each}
		</div>
		<button class="shots-arrow next" type="button" disabled={atEnd} onclick={() => move(1)}>
			<Icon name="right" /><span class="sr">{t.detail.more}</span>
		</button>
	</div>

	<Sheet open={large !== null && large < shots.length} onclose={() => (large = null)} class="lightbox" label={t.detail.screenshots}>
		{#if large !== null}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="lightbox-inner"
				onkeydown={(event) => {
					if (event.key === 'ArrowLeft') step(-1);
					if (event.key === 'ArrowRight') step(1);
				}}
			>
				<button class="detail-close" type="button" onclick={() => (large = null)}>
					<Icon name="close" /><span class="sr">{t.detail.close}</span>
				</button>
				{#if shots.length > 1}
					<button class="shots-arrow prev" type="button" onclick={() => step(-1)}>
						<Icon name="left" /><span class="sr">{t.detail.previous}</span>
					</button>
				{/if}
				<Picture id={shots[large]} lazy={false} />
				{#if shots.length > 1}
					<!-- svelte-ignore a11y_autofocus -->
					<button class="shots-arrow next" type="button" autofocus onclick={() => step(1)}>
						<Icon name="right" /><span class="sr">{t.detail.next}</span>
					</button>
				{/if}
				<div class="where" role="status">{t.detail.position(large + 1, shots.length)}</div>
			</div>
		{/if}
	</Sheet>
{/if}
