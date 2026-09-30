<script lang="ts">
	import { afterNavigate, beforeNavigate, goto, preloadData, pushState, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { nextRemembered, recall, rememberedCookie, type Remembered } from '$lib/remember';
	import { DEFAULT_STATE, parseState, toParams, type ViewState } from '$lib/search/state';
	import { t } from '$lib/strings';
	import type { Detail, ListEntry } from '$lib/types';
	import { View } from '$lib/view.svelte';
	import { detectVisitor, type Visitor } from '$lib/visitor';
	import Card from './Card.svelte';
	import CountLine from './CountLine.svelte';
	import DetailView from './Detail.svelte';
	import FilterPanel from './FilterPanel.svelte';
	import Foot from './Foot.svelte';
	import Icon from './Icon.svelte';
	import Sheet from './Sheet.svelte';
	import TopBar from './TopBar.svelte';

	interface Props {
		entries: ListEntry[];
		builtAt: string | null;
		version: string;
		timeZone: string;
		/** What the server made of the browser's name. */
		visitor: Visitor;
		remembered: Remembered;
		/** The game of the address, when the page was opened at `/game/{id}`. */
		linked?: Detail | null;
		/** True when the address names a game that is not in the library. */
		unknown?: boolean;
	}
	let { entries, builtAt, version, timeZone, visitor: guessed, remembered, linked = null, unknown = false }: Props = $props();

	const onList = () => page.url.pathname === '/';
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
		if (!onList() || page.state.detail || target === page.url.pathname + page.url.search) return Promise.resolve();
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
			// Remembered is what the visitor sets: the platform filter and the order. A search
			// does not change it, nor does a view that came from an address.
			const next = nextRemembered(recall(document.cookie), before, state);
			if (next) document.cookie = rememberedCookie(next);
		}
	);

	// What leaves the list writes its address first, when the pause has not ended yet,
	// so that the entry left behind says what the list showed.
	beforeNavigate((navigation) => {
		// A detail that is left by a navigation keeps the list under it, for the way back to it.
		// The address of its entry can be older than that list.
		if (page.state.detail && navigation.type !== 'popstate' && page.state.list !== address(view.state)) {
			replaceState('', { ...page.state, list: address(view.state) });
		}
		if (pending === undefined) return;
		clearTimeout(pending);
		pending = undefined;
		// On Back and Forward the entry has been left already.
		if (navigation.type === 'popstate' || !onList() || page.state.detail) return;
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
		} else if (page.state.detail && page.state.list) {
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
		const shown = page.state.detail !== undefined;
		if (!shown) closed();
		if (over && !shown && location.pathname === '/') {
			clearTimeout(pending);
			pending = undefined;
			follow(new URL(location.href));
		}
		over = shown;
	});

	/** A plain click opens the detail over the list, without leaving it. Anything else is a normal link. */
	async function open(event: MouseEvent, href: string) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		// One opening at a time, and none over a detail that is already open.
		if (opening || page.state.detail) return;
		opening = true;
		try {
			// The entry of the list says what the list shows before the detail goes over it.
			await write();
			const result = await preloadData(href);
			if (result.type === 'loaded' && result.status === 200 && result.data.detail) {
				if (!page.state.detail) pushState(href, { detail: result.data.detail as Detail, list: address(view.state) });
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

	function close() {
		// Opened over the list: going back closes it and the list is where it was.
		if (page.state.detail) {
			// A second press before the first has taken effect would go back out of the list.
			if (closing) return;
			closing = true;
			// Released by the navigation, and by the clock should the navigation never happen.
			closingTimer = setTimeout(closed, 1500);
			history.back();
		} else goto('/');
	}

	/** A tag is searched for in the whole library. The platform filter and the order are the visitor's settings: they stay. */
	function searchTag(tag: string) {
		goto(address({ ...DEFAULT_STATE, os: view.os, sort: view.sort, q: tag }));
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

	// The note about an unknown game goes away by itself.
	// svelte-ignore state_referenced_locally
	let note = $state(unknown);
	$effect(() => {
		if (!note) return;
		const timer = setTimeout(() => (note = false), 8000);
		return () => clearTimeout(timer);
	});
</script>

<svelte:window onkeydown={keydown} />

<svelte:head>
	<title>{detail ? t.gameTitle(detail.title) : t.pageTitle}</title>
</svelte:head>

<TopBar bind:this={bar} {view} onfilters={() => (filtersOpen = true)} />

<main>
	{#if note}
		<div class="toast" role="status"><Icon name="info" /><span>{t.notInLibrary}</span></div>
	{/if}
	<CountLine {view} />
	{#if view.matches.length > 0}
		<div class="grid">
			{#each view.shown as match (match.entry.id)}
				<Card {match} onopen={open} />
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

<Sheet open={detail !== null} onclose={close} class="detail" label={detail?.title ?? ''}>
	{#if detail}
		{#key detail.id}
			<DetailView {detail} {visitor} onclose={close} ontag={searchTag} />
		{/key}
	{/if}
</Sheet>
