<script lang="ts">
	import Picture from './Picture.svelte';

	interface Props {
		title: string;
		poster: string | null;
		banner: string | null;
		/** False for the one picture that is on screen as soon as it is drawn. */
		lazy?: boolean;
	}
	let { title, poster, banner, lazy = true }: Props = $props();

	let posterFailed = $state(false);
	let bannerFailed = $state(false);
</script>

{#if poster && !posterFailed}
	<Picture id={poster} {lazy} onfail={() => (posterFailed = true)} />
{:else if banner && !bannerFailed}
	<!-- No portrait poster: the wide image stands in. It fills the frame blurred, and lies on it whole. -->
	<div class="poster-wide">
		<Picture id={banner} class="fill" {lazy} />
		<Picture id={banner} class="whole" {lazy} onfail={() => (bannerFailed = true)} />
	</div>
{:else}
	<div class="poster-plain">{title}</div>
{/if}
