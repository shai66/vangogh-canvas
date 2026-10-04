<script lang="ts">
	import { afterNavigate, beforeNavigate, goto, preloadData, pushState, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { gamesOf } from '$lib/collections';
	import { nextRemembered, recall, rememberedCookie, type Remembered } from '$lib/remember';
	import { DEFAULT_STATE, parseState, toParams, type ViewState } from '$lib/search/state';
	import { t } from '$lib/strings';
	import type { Collection, Detail, Glance, ListEntry } from '$lib/types';
	import { View } from '$lib/view.svelte';
	import { detectVisitor, type Visitor } from '$lib/visitor';
	import Card from './Card.svelte';
	import CollectionCard from './CollectionCard.svelte';
	import CollectionView from './CollectionView.svelte';
	import CountLine from './CountLine.svelte';
	import DetailView from './Detail.svelte';
	import FilterPanel from './FilterPanel.svelte';
	import Foot from './Foot.svelte';
	import GlanceView from './GlanceView.svelte';
	import Icon from './Icon.svelte';
	import Sheet from './Sheet.svelte';
	import TopBar from './TopBar.svelte';

	interface Props {
		entries: ListEntry[];
		/** The collections of the library. */
		collections: Collection[];
		/** The library at a glance, worked out by the server from the index. */
		glance: Glance | null;
		builtAt: string | null;
		version: string;
		timeZone: string;
		/** What the server made of the browser's name. */
		visitor: Visitor;
		remembered: Remembered;
		/** The game of the address, when the page was opened at `/game/{id}`. */
		linked?: Detail | null;
		/** The collection of the address, when the page was opened at `/collection/{id}`. */
		linkedCollection?: Collection | null;
		/** True when the page was opened at `/glance`. */
		linkedGlance?: boolean;
		/** Set when the address names a game or a collection that is not in the library. */
		unknown?: 'game' | 'collection' | null;
	}
	let {
		entries,
		collections,
		glance,
		builtAt,
		version,
		timeZone,
		visitor: guessed,
		remembered,
		linked = null,
		linkedCollection = null,
		linkedGlance = false,
		unknown = null
	}: Props = $props();

	const onList = () => page.url.pathname === '/';
	/** True while a detail, a collection's sheet or the library at a glance, opened by a click, lies over the list. */
	const covered = () => page.state.detail !== undefined || page.state.collection !== undefined || page.state.glance === true;
	const address = (state: ViewState) => {
		const params = toParams(state).toString();
		return params ? `/?${params}` : '/';
	};

	// An address with parameters wins over what the browser remembers.
	// Read once: from then on the view is changed by the visitor and by navigation.
	// In the browser the cookie is read again: the property comes from the server's
	// data, which a navigation inside the app does not load again, so it can be stale.
	// svelte-ignore state_referenced_locally
	const initial: ViewState =
		onList() && page.url.search !== ''
			? parseState(page.url.searchParams)
			: { ...DEFAULT_STATE, ...(browser ? recall(document.cookie) : remembered) };

	// The list is written into the address, so that it can be shared and survives a reload.
	// It is written with a navigation of its own, so that SvelteKit and the history entry
	// know the address too: going back to the entry then shows what it says.
	// It is written after a pause and not for every key: Safari stops a page that changes
	// its address too often.
	const PAUSE = 250;
	let pending: ReturnType<typeof setTimeout> | undefined;
	/** The address the list is writing. Its navigation is the list's own and changes nothing. */
	let writing: string | null = null;

	function write(): Promise<void> {
		clearTimeout(pending);
		pending = undefined;
		const target = address(view.state);
		if (!onList() || covered() || target === page.url.pathname + page.url.search) return Promise.resolve();
		writing = target;
		// A newer write or another navigation overtakes it: that is fine.
		return goto(target, { replaceState: true, keepFocus: true, noScroll: true }).catch(() => {});
	}

	const view = new View(
		() => entries,
		initial,
		(state, before) => {
			clearTimeout(pending);
			pending = setTimeout(write, PAUSE);
			// Remembered is what the visitor sets: the platform filter, the order and the collections toggle. A search
			// does not change it, nor does a view that came from an address.
			const next = nextRemembered(recall(document.cookie), before, state);
			if (next) document.cookie = rememberedCookie(next);
		},
		() => collections
	);

	/** The entries by id: a collection's card shows its oldest game's picture when it has none of its own. */
	const byId = $derived(new Map(entries.map((e) => [e.id, e])));

	// What leaves the list writes its address first, when the pause has not ended yet,
	// so that the entry left behind says what the list showed.
	beforeNavigate((navigation) => {
		// A detail that is left by a navigation keeps the list under it, for the way back to it.
		// The address of its entry can be older than that list.
		if (covered() && navigation.type !== 'popstate' && page.state.list !== address(view.state)) {
			replaceState('', { ...page.state, list: address(view.state) });
		}
		if (pending === undefined) return;
		clearTimeout(pending);
		pending = undefined;
		// On Back and Forward the entry has been left already.
		if (navigation.type === 'popstate' || !onList() || covered()) return;
		const to = navigation.to?.url;
		if (navigation.type === 'link' && !navigation.willUnload && to) {
			navigation.cancel();
			// A link to the address the list already has replaces its entry, as it would without the pause.
			write().then(() => goto(to, { replaceState: to.href === location.href }));
		} else if (navigation.willUnload) {
			// The page goes away before a navigation could end: the address is written in place.
			history.replaceState(history.state, '', address(view.state));
		}
	});

	afterNavigate((navigation) => {
		closed();
		const to = navigation.to?.url;
		const own = navigation.type === 'goto' && to !== undefined && to.pathname + to.search === writing;
		writing = null;
		// The view is what the list wrote, or newer than that when the visitor went on typing.
		if (own || to?.pathname !== '/') return;
		if (navigation.type === 'enter') {
			// What was remembered is now shown: say so in the address.
			if (to.search === '') write();
		} else if (covered() && page.state.list) {
			// Back to a detail: the list under it is the one the visitor last saw there.
			follow(new URL(page.state.list, location.href));
		} else {
			follow(to);
		}
	});

	/** Shows the list of an address. */
	function follow(url: URL) {
		if (url.search === '') {
			// The list without parameters is the list as remembered, however it was reached.
			view.read({ ...DEFAULT_STATE, ...recall(document.cookie) });
			write();
		} else {
			view.read(parseState(url.searchParams));
		}
	}

	// An iPad calls itself a Mac. Its touch screen tells, and only the browser knows of it.
	// svelte-ignore state_referenced_locally
	let visitor = $state(guessed);
	$effect(() => {
		visitor = detectVisitor(navigator.userAgent, navigator.maxTouchPoints);
	});

	// ---------- The game detail ----------

	const detail = $derived(page.state.detail ?? linked);
	/** The collection whose sheet is open. A game opened from it takes its place. */
	const collection = $derived.by(() => {
		if (page.state.detail) return null;
		const id = page.state.collection;
		if (id !== undefined) return collections.find((c) => c.id === id) ?? null;
		if (linkedCollection) return linkedCollection;
		// Back onto the entry of a sheet that came by its address is a shallow popstate (same navigation index as the list's
		// entry): the list's route stays mounted with an empty state, and only the address says which sheet.
		const named = /^\/collection\/([^/]+)$/.exec(page.url.pathname);
		if (!named) return null;
		let namedId: string;
		try {
			namedId = decodeURIComponent(named[1]);
		} catch {
			// A malformed % sequence in the address names no collection.
			return null;
		}
		return collections.find((c) => c.id === namedId) ?? null;
	});
	/** The collection of the open game, for its row of posters. */
	const detailCollection = $derived(detail?.collection ? (collections.find((c) => c.id === detail.collection) ?? null) : null);
	/**
	 * True while the library at a glance lies over the list: opened by a click, or by its address. Back onto the entry
	 * of a sheet that came by its address is a shallow popstate: only the address says so, as for a collection.
	 */
	const glanceOpen = $derived(
		!page.state.detail &&
			page.state.collection === undefined &&
			(page.state.glance === true || linkedGlance || page.url.pathname === '/glance')
	);

	let opening = false;
	let closing = false;
	let closingTimer: ReturnType<typeof setTimeout> | undefined;
	const closed = () => {
		closing = false;
		clearTimeout(closingTimer);
	};
	// Going back over a shallow entry is not a navigation: the detail going away is the sign.
	// The list then shows what its address says. A change made just before Forward brought
	// the detail back could not be written, and it goes; the address and the list agree.
	let over = false;
	$effect(() => {
		const shown = covered();
		if (!shown) closed();
		if (over && !shown && location.pathname === '/') {
			clearTimeout(pending);
			pending = undefined;
			follow(new URL(location.href));
		}
		over = shown;
	});

	/** A plain left click, without a modifier key: the ones a browser would not open elsewhere. */
	const isPlainClick = (event: MouseEvent): boolean =>
		event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

	/** A plain click opens the detail over the list, without leaving it. Anything else is a normal link. */
	async function open(event: MouseEvent, href: string) {
		if (!isPlainClick(event)) return;
		event.preventDefault();
		// One opening at a time, and none over a detail that is already open.
		if (opening || page.state.detail) return;
		opening = true;
		try {
			// The entry of the list says what the list shows before the detail goes over it.
			await write();
			const result = await preloadData(href);
			if (result.type === 'loaded' && result.status === 200 && result.data.detail) {
				if (!page.state.detail) {
					// From a collection's sheet the game takes the sheet's place, and closing it goes past the sheet to the list.
					const back = page.state.collection !== undefined ? 2 : collection !== null ? 0 : 1;
					pushState(href, { detail: result.data.detail as Detail, list: page.state.list ?? address(view.state), back });
				}
			} else {
				await goto(href);
			}
		} catch {
			// The network is gone: an ordinary navigation shows what the browser can.
			location.href = href;
		} finally {
			opening = false;
		}
	}

	/** A plain click on a collection's card opens its sheet over the list. What it shows is in the page already. */
	async function openCollection(event: MouseEvent, id: string) {
		if (!isPlainClick(event)) return;
		event.preventDefault();
		if (opening || covered()) return;
		opening = true;
		try {
			// The entry of the list says what the list shows before the sheet goes over it.
			await write();
			if (!covered()) pushState(`/collection/${encodeURIComponent(id)}`, { collection: id, list: address(view.state) });
		} finally {
			opening = false;
		}
	}

	/** A plain click on the count opens the library at a glance over the list. What it shows is in the page already. */
	async function openGlance(event: MouseEvent) {
		// Without the numbers there is no sheet to lay over the list: the link goes to /glance as a link does.
		if (!glance) return;
		if (!isPlainClick(event)) return;
		event.preventDefault();
		if (opening || covered()) return;
		opening = true;
		try {
			// The entry of the list says what the list shows before the sheet goes over it.
			await write();
			if (!covered()) pushState('/glance', { glance: true, list: address(view.state) });
		} finally {
			opening = false;
		}
	}

	function close() {
		// A second press before the first has taken effect would go back out of the list.
		if (closing) return;
		const back = page.state.detail ? (page.state.back ?? 1) : page.state.collection !== undefined || page.state.glance ? 1 : 0;
		if (back > 0) {
			// Opened over the list, perhaps from a collection's sheet: going back that far shows the list where it was.
			closing = true;
			// Released by the navigation, and by the clock should the navigation never happen.
			closingTimer = setTimeout(closed, 1500);
			history.go(-back);
		} else if (page.state.detail) {
			// Opened over a page that came by its address: the list takes the detail's place, and Back shows that page again.
			goto(page.state.list ?? '/', { replaceState: true });
		} else goto('/');
	}

	/** Another game of the open collection's row opens in place of this one, with its row open. */
	async function swap(event: MouseEvent, href: string) {
		if (!isPlainClick(event)) return;
		event.preventDefault();
		if (opening) return;
		opening = true;
		try {
			const result = await preloadData(href);
			if (result.type === 'loaded' && result.status === 200 && result.data.detail) {
				// It takes this game's place in the history: closing still shows the list, and Back closes it.
				const shallow = page.state.detail !== undefined;
				replaceState(href, {
					detail: result.data.detail as Detail,
					list: page.state.list ?? address(view.state),
					back: shallow ? (page.state.back ?? 1) : 0,
					shelf: true
				});
			} else {
				await goto(href);
			}
		} catch {
			// The network is gone: an ordinary navigation shows what the browser can.
			location.href = href;
		} finally {
			opening = false;
		}
	}

	/** A tag is searched for in the whole library. The platform filter, the order and the toggle are the visitor's settings: they stay. */
	function searchTag(tag: string) {
		goto(address({ ...DEFAULT_STATE, os: view.os, sort: view.sort, grouped: view.grouped, q: tag }));
	}

	// ---------- The rest of the page ----------

	let filtersOpen = $state(false);
	let bar: TopBar;

	function keydown(event: KeyboardEvent) {
		const typing = event.target instanceof HTMLElement && event.target.matches('input, textarea, select, [contenteditable]');
		if (event.key === '/' && !typing && !document.querySelector('dialog[open]') && !event.metaKey && !event.ctrlKey && !event.altKey) {
			event.preventDefault();
			bar.focusSearch();
		}
	}

	// More cards are drawn when the end of the list comes near.
	let sentinel: HTMLElement;
	$effect(() => {
		const observer = new IntersectionObserver((seen) => seen[0].isIntersecting && view.more(), { rootMargin: '900px' });
		observer.observe(sentinel);
		return () => observer.disconnect();
	});
	// A batch can be shorter than the window: the end is still in sight, so ask again.
	$effect(() => {
		view.shown.length;
		if (sentinel.getBoundingClientRect().top < window.innerHeight + 900) view.more();
	});

	// The note about an unknown game or collection goes away by itself.
	// svelte-ignore state_referenced_locally
	let note = $state(unknown);
	$effect(() => {
		if (!note) return;
		const timer = setTimeout(() => (note = null), 8000);
		return () => clearTimeout(timer);
	});
</script>

<svelte:window onkeydown={keydown} />

<svelte:head>
	<title>{detail ? t.gameTitle(detail.title) : collection ? t.collectionTitle(collection.name) : glanceOpen ? t.glanceTitle : t.pageTitle}</title>
</svelte:head>

<TopBar bind:this={bar} {view} onfilters={() => (filtersOpen = true)} />

<main>
	{#if note}
		<div class="toast" role="status"><Icon name="info" /><span>{note === 'collection' ? t.collectionNotInLibrary : t.notInLibrary}</span></div>
	{/if}
	<CountLine {view} onglance={openGlance} />
	{#if view.cards.length > 0}
		<div class="grid">
			{#each view.shown as card (card.key)}
				{#if card.kind === 'game'}
					<Card match={card} showYear={view.sort === 'year'} onopen={open} />
				{:else}
					<CollectionCard {card} oldest={byId.get(card.collection.games[0])} onopen={openCollection} />
				{/if}
			{/each}
		</div>
	{:else}
		<div class="empty">
			<h2>{t.empty.title}</h2>
			<p>{view.q.trim() ? t.empty.search(view.q.trim(), view.filterCount > 0) : t.empty.filters}</p>
			<button class="btn btn-primary" type="button" onclick={() => view.clearAll()}>{t.empty.clear}</button>
		</div>
	{/if}
	<div class="sentinel" bind:this={sentinel}></div>
</main>

<Foot {version} {builtAt} {timeZone} />

<FilterPanel open={filtersOpen} onclose={() => (filtersOpen = false)} {view} {entries} />

<!-- One sheet for a game, a collection and the library at a glance: a game opened from a collection takes its place without the sheet closing. -->
<Sheet
	open={detail !== null || collection !== null || (glanceOpen && glance !== null)}
	onclose={close}
	class="detail"
	label={detail?.title ?? collection?.name ?? (glanceOpen ? t.glance.title : '')}
	view={detail ? `game/${detail.id}` : collection ? `collection/${collection.id}` : glanceOpen ? 'glance' : ''}
>
	{#if detail}
		{#key detail.id}
			<DetailView
				{detail}
				{visitor}
				onclose={close}
				ontag={searchTag}
				collection={detailCollection}
				collectionGames={detailCollection ? gamesOf(detailCollection, entries) : []}
				shelfOpen={page.state.shelf ?? false}
				onswap={swap}
			/>
		{/key}
	{:else if collection}
		{#key collection.id}
			<CollectionView {collection} games={gamesOf(collection, entries)} onclose={close} onopen={open} />
		{/key}
	{:else if glanceOpen && glance}
		<GlanceView {glance} games={entries.length} collections={collections.length} {builtAt} {timeZone} onclose={close} />
	{/if}
</Sheet>
