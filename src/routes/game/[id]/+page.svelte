<script lang="ts">
	import Library from '$lib/ui/Library.svelte';

	let { data } = $props();
</script>

<!-- The list, with this game's detail over it. -->
<Library
	entries={data.entries}
	builtAt={data.builtAt}
	version={data.version}
	timeZone={data.timeZone}
	visitor={data.visitor}
	remembered={data.remembered}
	linked={data.detail}
	unknown={data.detail === null}
/>
