<script lang="ts">
	import { ICONS } from './icons';
</script>

<!-- The triangle has its mark cut out. On artwork the cut-out needs a light ground, so one lies under it. -->
<svg viewBox="0 0 256 256" aria-hidden="true">
	<path d="M128 78 204 204H52Z" fill="var(--starlight)" />
	<g fill="var(--danger)">{@html ICONS.warning}</g>
</svg>
