<script lang="ts">
	import Library from '$lib/ui/Library.svelte';

	let { data } = $props();
</script>

<!-- The list, with the library at a glance over it. -->
<Library
	entries={data.entries}
	collections={data.collections}
	glance={data.glance}
	builtAt={data.builtAt}
	version={data.version}
	update={data.update}
	timeZone={data.timeZone}
	visitor={data.visitor}
	remembered={data.remembered}
	linkedGlance
/>
