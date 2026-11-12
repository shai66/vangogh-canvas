<script lang="ts">
	import { tick } from 'svelte';
	import { byTitle, OWN_NAME_MAX, ownName, sameName, type Band } from '$lib/own';
	import type { OwnRequest, OwnResult } from '$lib/own-saver';
	import { t } from '$lib/strings';
	import Icon from './Icon.svelte';
	import OwnPicture from './OwnPicture.svelte';

	interface Props {
		/** The own collections, with the number of their games and the strips of their pictures. */
		own: { id: string; name: string; games: number; bands: Band[] }[];
		/** Sends a change of the own collections. What failed, the settings sheet says. */
		save: (request: OwnRequest) => Promise<OwnResult>;
		/** A change was saved: "Saved" in the sheet's foot. */
		onsaved: () => void;
	}
	let { own, save, onsaved }: Props = $props();

	const rows = $derived([...own].sort((a, b) => byTitle(a.name, b.name)));

	/** The row being renamed, or asked about before a delete. Its other rows are at rest. */
	let editing = $state.raw<{ id: string; mode: 'rename' | 'ask' } | null>(null);
	/** The name's field of the row being renamed. */
	let draft = $state('');
	const typed = $derived(ownName(draft));
	/** Why the typed name cannot be saved, or null: in a red line under the field, with a red edge. */
	const refusal = $derived.by(() => {
		if (editing?.mode !== 'rename') return null;
		if (typed === null) return t.own.nameEmpty;
		const id = editing.id;
		return own.some((o) => o.id !== id && sameName(o.name, typed)) ? t.own.taken : null;
	});

	let list = $state<HTMLElement | null>(null);
	let empty = $state<HTMLElement | null>(null);

	/** The shown state of a row, once it is seen. */
	async function stateOf(id: string): Promise<Element | null> {
		await tick();
		return list?.querySelector(`[data-id="${id}"] .own-row-state.on`) ?? null;
	}

	/** Puts the focus on the first or the last button of a row's shown state, so that it is not lost with the button pressed. */
	async function focusRow(id: string, last = false) {
		const buttons = (await stateOf(id))?.querySelectorAll<HTMLButtonElement>('button');
		(last ? buttons?.[buttons.length - 1] : buttons?.[0])?.focus();
	}

	/** A row went: the focus goes to the row now in its place, or the one before, else to "No collections yet.". */
	async function focusAt(index: number) {
		await tick();
		const next = rows[index] ?? rows[index - 1];
		if (next) focusRow(next.id, true);
		else empty?.focus();
	}

	async function startRename(id: string, name: string) {
		draft = name;
		editing = { id, mode: 'rename' };
		const field = (await stateOf(id))?.querySelector<HTMLInputElement>('input');
		field?.focus();
		field?.select();
	}

	/** Cancel, and Esc in the field: the name stays as it was. */
	function cancel() {
		const id = editing?.id;
		editing = null;
		if (id) focusRow(id);
	}

	/** The row whose change is on its way: another press of it does nothing until the answer has come. */
	let sending: string | null = null;

	/** Save, and Enter in the field. A name not changed is not sent. */
	async function saveName() {
		const at = editing;
		const name = typed;
		if (at?.mode !== 'rename' || name === null || refusal !== null || sending === at.id) return;
		const id = at.id;
		const index = rows.findIndex((r) => r.id === id);
		if (name === rows[index]?.name) return cancel();
		sending = id;
		const result = await save({ kind: 'change', id, body: { name } });
		sending = null;
		if (result.kind === 'saved') onsaved();
		// The person went on meanwhile: this row's answer does not take the focus.
		if (editing !== at) return;
		if (result.kind === 'saved') {
			editing = null;
			focusRow(id);
		} else if (result.kind === 'gone') {
			// Another browser deleted it: the page's copy has dropped it.
			editing = null;
			focusAt(index);
		}
		// Anything else leaves the row as it is, with the typed name: the sheet says why.
	}

	function ask(id: string) {
		editing = { id, mode: 'ask' };
		// "Keep", not "Delete": Enter does not delete.
		focusRow(id, true);
	}

	function keep() {
		const id = editing?.id;
		editing = null;
		if (id) focusRow(id, true);
	}

	/** "Delete": the collection goes, and its games stay in the library. */
	async function remove() {
		const at = editing;
		if (at?.mode !== 'ask' || sending === at.id) return;
		const id = at.id;
		const index = rows.findIndex((r) => r.id === id);
		sending = id;
		const result = await save({ kind: 'delete', id });
		sending = null;
		if (result.kind === 'saved') onsaved();
		if (editing !== at) return;
		editing = null;
		if (result.kind === 'saved') focusAt(index);
		else focusRow(id, true);
	}
</script>

<!-- The panel "Your collections" (spec of own collections, section 10): every own collection A to Z, to rename or delete. -->
<section class="settings-panel">
	<h2 class="section-title">{t.own.panel} <span>{t.own.panelNote(rows.length)}</span></h2>
	{#if rows.length > 0}
		<ul class="own-rows" bind:this={list}>
			{#each rows as row (row.id)}
				{@const renaming = editing?.id === row.id && editing.mode === 'rename'}
				{@const asking = editing?.id === row.id && editing.mode === 'ask'}
				<li class="own-row" data-id={row.id}>
					<span class="addto-thumb"><OwnPicture bands={row.bands} small /></span>
					<!-- The row's three states lie in one place and one is seen, so the row is as high as the highest at every width. -->
					<div class="own-row-states">
						<div class="own-row-state" class:on={!renaming && !asking} inert={renaming || asking}>
							<span class="own-row-what">
								<span class="own-row-name">{row.name}</span>
								<span class="own-row-n">{t.collections.games(row.games)}</span>
							</span>
							<button class="btn btn-small" type="button" onclick={() => startRename(row.id, row.name)}><Icon name="pencil" />{t.own.rename}</button>
							<button class="btn btn-small" type="button" onclick={() => ask(row.id)}><Icon name="trash" />{t.own.delete}</button>
						</div>
						<div class="own-row-state is-renaming" class:on={renaming} inert={!renaming}>
							<div class="own-row-fieldbox">
								<input
									class="own-row-field"
									type="text"
									value={renaming ? draft : row.name}
									maxlength={OWN_NAME_MAX}
									autocomplete="off"
									aria-label={t.own.name}
									aria-invalid={renaming && refusal !== null}
									aria-describedby="own-why-{row.id}"
									oninput={(event) => (draft = event.currentTarget.value)}
									onkeydown={(event) => {
										if (event.isComposing) return;
										if (event.key === 'Enter') {
											event.preventDefault();
											saveName();
										} else if (event.key === 'Escape') {
											// Not the sheet's Esc: the sheet stays open.
											event.preventDefault();
											cancel();
										}
									}}
								/>
								<!-- A refused name says why under the field, read out as it changes. The line has the room of the longer
								     reason all the time, so a reason moves nothing and the row keeps its height. -->
								<span class="own-row-why stack">
									<span aria-hidden="true">{t.own.taken}</span>
									<span aria-hidden="true">{t.own.nameEmpty}</span>
									<span class="on" id="own-why-{row.id}" aria-live="polite">{renaming ? (refusal ?? '') : ''}</span>
								</span>
							</div>
							<button class="btn btn-small btn-primary" type="button" disabled={!renaming || refusal !== null} onclick={saveName}>{t.own.save}</button>
							<button class="btn btn-small" type="button" onclick={cancel}>{t.own.cancel}</button>
						</div>
						<div class="own-row-state is-confirm" class:on={asking} inert={!asking}>
							<span class="own-row-name">{t.own.deleteAsk(row.name)}</span>
							<button class="btn btn-small own-danger" type="button" onclick={remove}><Icon name="trash" />{t.own.delete}</button>
							<button class="btn btn-small" type="button" onclick={keep}>{t.own.keep}</button>
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="own-empty" tabindex="-1" bind:this={empty}>{t.own.none}</p>
	{/if}
	<p class="set-note">{t.own.panelHint}</p>
</section>
