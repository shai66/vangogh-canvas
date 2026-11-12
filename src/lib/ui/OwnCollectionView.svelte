<script lang="ts">
	import { tick } from 'svelte';
	import { systemsOf, yearSpan } from '$lib/collections';
	import { bandsOf, OWN_NAME_MAX, ownName, sameMember, sameName, type Band, type OwnMember, type ShownMember, type ShownOwn } from '$lib/own';
	import { failureText, type OwnRequest, type OwnResult } from '$lib/own-saver';
	import { Picking } from '$lib/picking.svelte';
	import { t } from '$lib/strings';
	import type { ListEntry } from '$lib/types';
	import AddToList from './AddToList.svelte';
	import Card from './Card.svelte';
	import CollectionCard from './CollectionCard.svelte';
	import Icon from './Icon.svelte';
	import NewCollection from './NewCollection.svelte';
	import OwnPicture from './OwnPicture.svelte';
	import Picture from './Picture.svelte';
	import Sheet from './Sheet.svelte';

	interface Props {
		own: ShownOwn;
		/** True while the chip "Hide 18+" is on: the games for adults are left out, and members left without games. */
		hide18: boolean;
		onclose: () => void;
		/** A game of it was clicked. The card is a link and works without it. */
		onopen: (event: MouseEvent, href: string) => void;
		/** One of GOG's collections in it was clicked, with its id. The card is a link and works without it. */
		onopencollection: (event: MouseEvent, id: string) => void;
		/** True while this browser may change the own collections: the row with "Edit" shows. */
		unlocked: boolean;
		/** The other own collections, for "Add to…". */
		others: { id: string; name: string; games: number; bands: Band[] }[];
		/** Sends a change of the own collections, after the ones before it, and applies the answer to the page's copy. */
		save: (request: OwnRequest) => Promise<OwnResult>;
		/** Opens that own collection's sheet in this one's place: after "Add to…" and "Create". */
		onshow: (id: string) => void;
	}
	let { own, hide18, onclose, onopen, onopencollection, unlocked, others, save, onshow }: Props = $props();

	const passes = (entry: ListEntry) => !(hide18 && entry.adult);
	/** Its members as the chip lets them through, oldest first: a GOG collection with its games that pass. */
	const members = $derived(
		own.members.flatMap((member): ShownMember[] => {
			if (member.kind === 'game') return passes(member.entry) ? [member] : [];
			const games = member.games.filter(passes);
			return games.length > 0 ? [{ ...member, games }] : [];
		})
	);
	const games = $derived(own.games.filter(passes));
	const what = $derived(t.own.what(games.length, yearSpan(games)));
	const note = $derived(
		t.own.membersNote(
			members.filter((m) => m.kind === 'game').length,
			members.flatMap((m) => (m.kind === 'collection' ? [m.collection.kind] : []))
		)
	);
	// The oldest member's game, heavily blurred, colours the head, as for a GOG collection.
	const first = $derived(members[0]);
	const oldest = $derived(first === undefined ? undefined : first.kind === 'game' ? first.entry : first.games[0]);
	const wash = $derived(oldest?.poster ?? oldest?.banner ?? null);

	/** A member's card is picked by this: a game's id, a GOG collection's id. */
	const keyOf = (member: ShownMember) => (member.kind === 'game' ? member.entry.id : member.collection.id);

	// ---------- Editing (spec of own collections, section 9.2) ----------

	/** True while the sheet is edited: the name is a field, the cards have the circles of picking, the bar is at the foot. */
	let editing = $state(false);
	/** True while the row asks before a delete. */
	let asking = $state(false);
	/** The cards picked while editing. */
	const picks = new Picking();
	const n = $derived(picks.counts.n);
	/** The name's field. */
	let draft = $state('');
	/** Why the name was refused: in red under the field. */
	let nameError = $state<string | null>(null);
	/** Why the last change failed: a red notice under the head. */
	let failure = $state<string | null>(null);
	/** True while the list "Add to…" is open, and while the dialog "New collection" is. */
	let addOpen = $state(false);
	let naming = $state(false);
	/** Why the last "Create" failed: under the dialog's field. */
	let namingError = $state<string | null>(null);

	let inner: HTMLElement;
	let row = $state<HTMLElement | null>(null);

	/** A button of the row's state once it is seen, so that the focus is not lost with the button that was pressed. */
	async function focusRow(last = false) {
		await tick();
		const buttons = row?.querySelectorAll<HTMLButtonElement>('.on button');
		(last ? buttons?.[buttons.length - 1] : buttons?.[0])?.focus();
	}

	function edit() {
		draft = own.name;
		failure = null;
		editing = true;
		focusRow();
	}

	/** Editing ends: the picks, the list, the dialog, the question and the refusal of a name go with it. */
	function stop() {
		editing = asking = addOpen = naming = false;
		nameError = null;
		picks.stop();
	}

	/** "Done", and Esc: the name is saved when it changed, and editing ends. */
	function done() {
		rename();
		stop();
		focusRow();
	}

	// Locked while editing (the PIN prompt of a save closed without the PIN): the row leaves, and editing ends with it.
	$effect(() => {
		if (!unlocked) stop();
	});

	/** Esc ends editing, unless it closes the list "Add to…" first, or belongs to a dialog over the sheet. */
	function keydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented || !editing) return;
		const sheet = inner.closest('dialog');
		if ([...document.querySelectorAll('dialog[open]')].some((open) => open !== sheet)) return;
		event.preventDefault();
		done();
	}

	/** Sends a change: what the last one said goes. */
	function send(request: OwnRequest): Promise<OwnResult> {
		failure = nameError = null;
		return save(request);
	}

	/**
	 * A change that was not saved: a browser found locked ends editing, as the PIN prompt shows over the page; anything
	 * else says why under the head. A change of this collection that finds it gone closes the sheet before this.
	 */
	function failed(result: OwnResult) {
		if (result.kind === 'locked') stop();
		else failure = failureText(result);
	}

	/** The name being saved, so that leaving the field and "Done" just after save it once. */
	let renaming: string | null = null;

	/** Saves the typed name, on Enter, on leaving the field and on "Done". An empty one gives the old name back. */
	async function rename() {
		// The collection left the page's copy (gone, or deleted): the sheet is going, and the field it takes away with it
		// is left, which calls this once more. There is nothing to save.
		if (!own) return;
		// A line break pasted into the field is a space, as a one-line field would make it.
		const name = ownName(draft.replace(/\s*[\r\n]+\s*/g, ' '));
		if (name === null) {
			draft = own.name;
			return;
		}
		if (name === own.name || name === renaming) return;
		renaming = name;
		const result = await send({ kind: 'change', id: own.id, body: { name } });
		renaming = null;
		// Another browser deleted it: the page's copy has dropped it, so nothing here reads it again, and the sheet
		// closes onto the list.
		if (result.kind === 'gone') return onclose();
		if (result.kind === 'saved') return;
		// Not saved: the old name stays.
		draft = own.name;
		if (result.kind === 'name-taken' && editing) nameError = t.own.taken;
		else failed(result);
	}

	/** "Take out": the picked members leave the collection, as the file holds them. */
	async function takeOut() {
		const remove: OwnMember[] = [];
		for (const member of own.members) {
			if (picks.has(keyOf(member)) && !remove.some((m) => sameMember(m, member.stored))) remove.push(member.stored);
		}
		const result = await send({ kind: 'change', id: own.id, body: { remove } });
		// Gone: as for a rename.
		if (result.kind === 'gone') onclose();
		else if (result.kind === 'saved') picks.stop();
		else failed(result);
	}

	/** "Add to…": the picks go into that collection too, and its sheet opens. */
	async function addTo(id: string) {
		addOpen = false;
		const result = await send({ kind: 'change', id, body: { add: picks.members() } });
		// Gone is the other collection: it says so under the head.
		if (result.kind === 'saved') onshow(id);
		else failed(result);
	}

	function startNaming() {
		addOpen = false;
		namingError = null;
		naming = true;
	}

	/** The picture of what is picked, for the dialog "New collection". */
	const pickedBands = $derived(bandsOf({ ...own, members: own.members.filter((m) => picks.has(keyOf(m))) }, hide18));
	const taken = (name: string) => sameName(name, own.name) || others.some((o) => sameName(o.name, name));

	/** True while "Create" is being saved: another press waits for it. */
	let creating = false;

	/** "Create": a collection of the picks, named so, whose sheet opens. */
	async function create(name: string) {
		if (creating) return;
		creating = true;
		namingError = null;
		try {
			const result = await send({ kind: 'create', body: { name, members: picks.members() } });
			if (result.kind === 'saved' && result.collection) {
				// The dialog closes first: the focus it gives back then goes on into the new sheet.
				naming = false;
				await tick();
				onshow(result.collection.id);
			} else if (naming && result.kind !== 'locked') namingError = failureText(result);
			else failed(result);
		} finally {
			creating = false;
		}
	}

	function ask() {
		asking = true;
		// "Keep", not "Delete": Enter does not delete.
		focusRow(true);
	}

	function keep() {
		asking = false;
		focusRow(true);
	}

	/** "Delete": the collection goes, and its sheet closes onto the list. A collection already gone is deleted too. */
	async function remove() {
		const result = await send({ kind: 'delete', id: own.id });
		if (result.kind === 'saved') onclose();
		else {
			asking = false;
			failed(result);
		}
	}
</script>

<svelte:window onkeydown={keydown} />

<!-- svelte-ignore a11y_autofocus -->
<div class="detail-inner coll-inner" tabindex="-1" autofocus bind:this={inner}>
	{#if wash}
		<div class="ambience"><Picture id={wash} lazy={false} /></div>
	{/if}
	<div class="detail-close-holder">
		<button class="detail-close" type="button" onclick={onclose}>
			<Icon name="close" /><span class="sr">{t.detail.close}</span>
		</button>
	</div>
	<!-- A GOG collection's sheet (CollectionView.svelte), with the picture made of its members and its members as the
	     cards of the list: a game as its card, a GOG collection as its collection's card. -->
	<div class="detail-head coll-head">
		<div class="detail-poster"><OwnPicture bands={bandsOf(own, hide18)} lazy={false} /></div>
		<div class="detail-info">
			<!-- Editing, the name is a field in the title's own type laid over the title, which keeps its room unseen: the
			     head keeps its height, however many lines the name takes. -->
			<div class="own-title">
				<h1 class="detail-title" class:is-hidden={editing}>{own.name}</h1>
				{#if editing}
					<textarea
						bind:value={draft}
						class="detail-title own-title-field"
						rows="1"
						maxlength={OWN_NAME_MAX}
						autocomplete="off"
						aria-label={t.own.name}
						aria-invalid={nameError !== null}
						oninput={() => (nameError = null)}
						onkeydown={(event) => {
							// A name is one line: Enter saves it, unless it ends a composed character.
							if (event.key !== 'Enter' || event.isComposing) return;
							event.preventDefault();
							rename();
						}}
						onblur={rename}
					></textarea>
				{/if}
			</div>
			<!-- A refused name says why in the room of the line under it, so that the head keeps its height. -->
			<div class="own-makers">
				<p class="detail-makers" class:is-hidden={nameError !== null}>
					{#each what as part, i (i)}{part.plain}{#if part.bold}<b>{part.bold}</b>{/if}{/each}
				</p>
				{#if nameError}
					<p class="detail-makers own-name-error" role="alert">{nameError}</p>
				{/if}
			</div>
			<div class="facts">
				{#each systemsOf(games) as os (os)}
					<span><Icon name={os} />{t.osName[os]}</span>
				{/each}
			</div>
			{#if unlocked}
				<!-- The row's three states lie in one place and one is seen, so the row is as high as the highest at every width. -->
				<div class="own-edit-row" bind:this={row}>
					<div class="own-edit-state" class:on={!editing} inert={editing}>
						<button class="btn btn-small" type="button" onclick={edit}><Icon name="pencil" />{t.own.edit}</button>
					</div>
					<div class="own-edit-state" class:on={editing && !asking} inert={!editing || asking}>
						<button class="btn btn-small btn-primary" type="button" onclick={done}><Icon name="check" />{t.own.done}</button>
						<button class="link-button own-danger-link" type="button" onclick={ask}><Icon name="trash" />{t.own.deleteCollection}</button>
					</div>
					<div class="own-edit-state" class:on={asking} inert={!asking}>
						<span class="own-confirm-text">{t.own.deleteAsk(own.name)}</span>
						<button class="btn btn-small own-danger" type="button" onclick={remove}><Icon name="trash" />{t.own.delete}</button>
						<button class="btn btn-small" type="button" onclick={keep}>{t.own.keep}</button>
					</div>
				</div>
			{/if}
		</div>
		<div class="coll-body">
			{#if failure}
				<div class="notice notice-bad own-notice" role="alert">
					<Icon name="warning" />
					<div>{failure}</div>
				</div>
			{/if}
			{#if members.length > 0}
				<h2 class="section-title">{t.own.membersTitle} <span>{note}</span></h2>
				<div class="grid coll-grid">
					{#each members as member (keyOf(member))}
						{@const key = keyOf(member)}
						{#if member.kind === 'game'}
							<Card
								match={{ entry: member.entry, reason: null }}
								{onopen}
								pick={editing ? { picked: picks.has(key), ontoggle: () => picks.toggle(key, 'game') } : null}
							/>
						{:else}
							<CollectionCard
								card={{ kind: 'collection', key: member.collection.id, collection: member.collection, games: member.games, found: null }}
								oldest={member.games[0]}
								onopen={onopencollection}
								pick={editing ? { picked: picks.has(key), ontoggle: () => picks.toggle(key, 'collection') } : null}
							/>
						{/if}
					{/each}
				</div>
			{:else}
				<h2 class="section-title">{t.own.membersTitle}</h2>
				<p class="own-empty">{t.own.empty}</p>
			{/if}
			{#if unlocked}
				<!-- Held at the bottom of the window while the sheet scrolls. While Edit is offered it keeps its room unseen, so
				     that nothing moves when editing ends at the sheet's end. -->
				<div class="take-bar" class:is-resting={!editing} inert={!editing}>
					<span class="take-n" aria-live="polite">{n > 0 ? t.own.selected(n) : t.own.takeHint}</span>
					<div class="take-actions">
						<div class="addto-wrap">
							<button class="btn btn-small" type="button" aria-expanded={addOpen} disabled={n === 0} onclick={() => (addOpen = !addOpen)}>{t.own.addTo}</button>
							{#if addOpen}
								<AddToList count={n} choices={others} onchoose={addTo} onnew={startNaming} onclose={() => (addOpen = false)} />
							{/if}
						</div>
						<button class="btn btn-small" type="button" disabled={n === 0} onclick={takeOut}>{t.own.takeOut}</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

{#if editing}
	<!-- The dialog "New collection" of picking, with the cards picked here. -->
	<Sheet open={naming} onclose={() => (naming = false)} class="pin new-coll" label={t.own.newCollection}>
		<NewCollection
			bands={pickedBands}
			what={t.own.picks(picks.counts.games, picks.counts.collections)}
			{taken}
			error={namingError}
			oncreate={create}
			onclose={() => (naming = false)}
		/>
	</Sheet>
{/if}
