<script lang="ts">
	import { requirementTabs, shownRequirements, type RequirementPick } from '$lib/requirements';
	import { t } from '$lib/strings';
	import type { Detail, Os, RequirementRow } from '$lib/types';
	import type { Visitor } from '$lib/visitor';
	import Icon from './Icon.svelte';
	import { nextTab } from './tabs';

	interface Props {
		detail: Detail;
		/** The system the download block shows. */
		follow: Os | null;
		/** How often that system changed. A tab chosen here holds until the next change. */
		turn: number;
		visitor: Visitor;
	}
	let { detail, follow, turn, visitor }: Props = $props();

	const PANEL = 'requirements-panel';
	// Chosen here, and nowhere else: a detail that is opened again starts on the block's system.
	let pick = $state<RequirementPick | null>(null);
	const tabs = $derived(requirementTabs(detail));
	const shown = $derived(shownRequirements(detail, follow, turn, pick, visitor));
	const set = $derived(shown ? detail.requirements[shown] : undefined);
	let row: HTMLElement | undefined = $state();

	/** A tab here changes this section only, never the download block. */
	function choose(os: Os) {
		pick = { os, turn };
	}

	function keydown(event: KeyboardEvent) {
		if (!shown) return;
		const to = nextTab(event.key, tabs.length, tabs.indexOf(shown));
		if (to < 0) return;
		event.preventDefault();
		choose(tabs[to]);
		row?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
	}
</script>

{#snippet group(title: string, rows: RequirementRow[])}
	{#if rows.length > 0}
		<div class="req-group">
			<h4>{title}</h4>
			<dl>
				{#each rows as item, i (i)}
					<dt>{t.requirements.row(item.id, item.name)}</dt>
					<dd>{item.text}</dd>
				{/each}
			</dl>
		</div>
	{/if}
{/snippet}

<!-- The same groups without their roles: laid out unseen under the shown ones, so the section is as
     tall as its tallest system and choosing a tab moves nothing below it. -->
{#snippet sizer(rows: RequirementRow[])}
	{#if rows.length > 0}
		<div class="req-group">
			<div class="h">&nbsp;</div>
			<div class="req-rows">
				{#each rows as item, i (i)}
					<span class="k">{t.requirements.row(item.id, item.name)}</span>
					<span class="v">{item.text}</span>
				{/each}
			</div>
		</div>
	{/if}
{/snippet}

{#if shown}
	<section class="reqs">
		<h3>{t.requirements.title}</h3>
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div class="req-tabs" role="tablist" aria-label={t.requirements.tabs} bind:this={row} onkeydown={keydown}>
			{#each tabs as os (os)}
				<button
					type="button"
					role="tab"
					id="{PANEL}-tab-{os}"
					aria-selected={os === shown}
					aria-controls={PANEL}
					tabindex={os === shown ? 0 : -1}
					onclick={() => choose(os)}
				>
					<Icon name={os} />{t.osName[os]}
				</button>
			{/each}
		</div>
		<div class="req-stack">
			<div id={PANEL} role="tabpanel" aria-labelledby="{PANEL}-tab-{shown}">
				{#if set}
					{@render group(t.requirements.minimum, set.minimum)}
					{@render group(t.requirements.recommended, set.recommended)}
				{:else}
					<p class="plain">{t.requirements.none(shown)}</p>
				{/if}
			</div>
			<div class="req-sizers" aria-hidden="true" inert>
				{#each tabs as os (os)}
					{@const other = detail.requirements[os]}
					{#if other}
						<div>
							{@render sizer(other.minimum)}
							{@render sizer(other.recommended)}
						</div>
					{/if}
				{/each}
			</div>
		</div>
	</section>
{/if}
