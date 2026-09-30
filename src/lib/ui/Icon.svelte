<script lang="ts">
	import { ICONS, type IconName } from './icons';

	let { name }: { name: IconName } = $props();
</script>

<!-- The markup comes from the icon package, never from GOG or from the visitor. -->
<svg class="ic" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">{@html ICONS[name]}</svg>
