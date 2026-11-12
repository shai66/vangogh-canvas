<script module lang="ts">
	import { OwnQueue } from '$lib/own-saver';

	/**
	 * Until when this browser is unlocked, as the page last learned it; undefined until it learns it. The layout's
	 * data is not loaded again by a navigation inside the app: the list of another route, drawn after an unlock or
	 * a "Lock", would start from what the server said when the page was loaded. Written in the browser only.
	 */
	let learnedUntil: string | null | undefined;
	/**
	 * The settings, and whether the server can write them, as the page last learned them: from an unlock, a save or
	 * a refused save; undefined until then. For the same reason: a list of another route would start from the
	 * settings the server drew the page with. Written in the browser only.
	 */
	let learnedSettings: { settings: SettingsAnswer; writable: boolean } | undefined;
	/**
	 * The own collections as the page last learned them; undefined until then. For the same reason: a list of another
	 * route would start from the ones the server drew the page with. Written in the browser only.
	 */
	let learnedOwn: OwnCollection[] | undefined;
	/** The changes of the own collections, one at a time in a browser, in the order they were made. */
	const queue = new OwnQueue();
</script>

<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { afterNavigate, beforeNavigate, goto, preloadData, pushState, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { gamesOf } from '$lib/collections';
	import { bandsOf, byTitle, isOwnId, resolveOwn, sameName, type OwnCollection } from '$lib/own';
	import { applyResult, failureText, type OwnRequest, type OwnResult } from '$lib/own-saver';
	import { Picking } from '$lib/picking.svelte';
	import { nextRemembered, recall, rememberedCookie, type Remembered } from '$lib/remember';
	import { DEFAULT_STATE, parseState, toParams, type ViewState } from '$lib/search/state';
	import type { SettingsAnswer, SettingsInfo } from '$lib/settings';
	import { t } from '$lib/strings';
	import type { Collection, Detail, Glance, ListEntry } from '$lib/types';
	import { View } from '$lib/view.svelte';
	import { detectVisitor, type Visitor } from '$lib/visitor';
	import AddToList from './AddToList.svelte';
	import Card from './Card.svelte';
	import CollectionCard from './CollectionCard.svelte';
	import CollectionView from './CollectionView.svelte';
	import CountLine from './CountLine.svelte';
	import DetailView from './Detail.svelte';
	import FilterPanel from './FilterPanel.svelte';
	import Foot from './Foot.svelte';
	import GlanceView from './GlanceView.svelte';
	import Icon from './Icon.svelte';
	import NewCollection from './NewCollection.svelte';
	import OwnCard from './OwnCard.svelte';
	import OwnCollectionView from './OwnCollectionView.svelte';
	import PickBar from './PickBar.svelte';
	import PinPrompt from './PinPrompt.svelte';
	import SettingsView from './SettingsView.svelte';
	import Sheet from './Sheet.svelte';
	import TopBar from './TopBar.svelte';

	interface Props {
		entries: ListEntry[];
		/** The collections of the library. */
		collections: Collection[];
		/** The own collections, as stored; none without a PIN. */
		own: OwnCollection[];
		/** The library at a glance, worked out by the server from the index. */
		glance: Glance | null;
		builtAt: string | null;
		version: string;
		timeZone: string;
		/** A newer Canvas that is released, or null. */
		update: string | null;
		/** What the server made of the browser's name. */
		visitor: Visitor;
		remembered: Remembered;
		/** The game of the address, when the page was opened at `/game/{id}`. */
		linked?: Detail | null;
		/** The collection of the address, when the page was opened at `/collection/{id}`. */
		linkedCollection?: Collection | null;
		/** The own collection of the address, as stored, when the page was opened at `/collection/h{n}`. */
		linkedOwn?: OwnCollection | null;
		/** True when the page was opened at `/glance`. */
		linkedGlance?: boolean;
		/** What the page is told of the settings: whether a PIN is set, and until when this browser is unlocked. */
		settings: SettingsInfo;
		/** How the library opens in a browser that has not chosen its own view: the defaults of the settings. */
		defaults: Remembered;
		/** True when the page was opened at `/settings`. */
		linkedSettings?: boolean;
		/** Set when the address names a game or a collection that is not in the library. */
		unknown?: 'game' | 'collection' | null;
	}
	let {
		entries,
		collections,
		own: stored,
		glance,
		builtAt,
		version,
		timeZone,
		update,
		visitor: guessed,
		remembered,
		linked = null,
		linkedCollection = null,
		linkedOwn = null,
		linkedGlance = false,
		settings,
		defaults,
		linkedSettings = false,
		unknown = null
	}: Props = $props();

	const onList = () => page.url.pathname === '/';
	/**
	 * True on an entry of the history whose collection is in no sheet: an own collection deleted, then Forward onto its
	 * entry. Nothing lies over the list there, and the note of an unknown collection shows.
	 */
	let dead = $state(false);
	/** True while a detail, a collection's sheet, the library at a glance or the settings, opened by a click, lie over the list. */
	const covered = () =>
		page.state.detail !== undefined || (page.state.collection !== undefined && !dead) || page.state.glance === true || page.state.settings === true;
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
			: { ...DEFAULT_STATE, ...(browser ? recall(document.cookie, defaults) : remembered) };

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

	/** The own collections as stored: as the page last learned them, else as the server drew the page with them. */
	// svelte-ignore state_referenced_locally
	let own = $state(learnedOwn ?? stored);
	/** The own collections against the index. */
	const shown = $derived(resolveOwn(own, entries, collections));

	const view = new View(
		() => entries,
		initial,
		(state, before) => {
			clearTimeout(pending);
			pending = setTimeout(write, PAUSE);
			// Remembered is what the visitor sets: the platform filter, the chip "Hide 18+", the order and the collections
			// toggle. A search does not change it, nor does a view that came from an address.
			const next = nextRemembered(recall(document.cookie, defaults), before, state);
			if (next) document.cookie = rememberedCookie(next);
		},
		() => collections,
		() => shown
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
			view.read({ ...DEFAULT_STATE, ...recall(document.cookie, defaults) });
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
	/** The id of the collection whose sheet is open, GOG's or an own one. A game opened from it takes its place. */
	const sheetId = $derived.by(() => {
		if (page.state.detail) return null;
		const id = page.state.collection ?? linkedCollection?.id ?? linkedOwn?.id;
		if (id !== undefined) return id;
		// Back onto the entry of a sheet that came by its address is a shallow popstate (same navigation index as the list's
		// entry): the list's route stays mounted with an empty state, and only the address says which sheet.
		const named = /^\/collection\/([^/]+)$/.exec(page.url.pathname);
		if (!named) return null;
		try {
			return decodeURIComponent(named[1]);
		} catch {
			// A malformed % sequence in the address names no collection.
			return null;
		}
	});
	/** GOG's collection whose sheet is open. */
	const collection = $derived(sheetId !== null && !isOwnId(sheetId) ? (collections.find((c) => c.id === sheetId) ?? null) : null);
	/** The own collection whose sheet is open, against the index. */
	const ownSheet = $derived(sheetId !== null && isOwnId(sheetId) ? (shown.find((o) => o.id === sheetId) ?? null) : null);
	// Worked out when an entry is reached, not when its collection goes: a sheet whose collection was just deleted is
	// closing, and says nothing.
	$effect(() => {
		const id = page.state.collection;
		untrack(() => {
			dead = id !== undefined && collection === null && ownSheet === null;
			if (dead) note = 'collection';
		});
	});
	/** The collection of the open game, for its row of posters. */
	const detailCollection = $derived(detail?.collection ? (collections.find((c) => c.id === detail.collection) ?? null) : null);
	/** The games of a collection as the chip "Hide 18+" lets them through; the open game stays in its own row. */
	const letThrough = (games: ListEntry[], keep: string | null = null) =>
		view.hide18 ? games.filter((e) => !e.adult || e.id === keep) : games;
	/** The rows of posters of the open game, one per collection that holds it: GOG's first, then the own ones, A to Z. */
	const shelves = $derived.by(() => {
		if (!detail) return [];
		const here = detail.id;
		const rows: { key: string; name: string; line: string; games: ListEntry[] }[] = [];
		if (detailCollection) {
			const games = letThrough(gamesOf(detailCollection, entries), here);
			rows.push({ key: detailCollection.id, name: detailCollection.name, line: t.collections.shelf(detailCollection.kind, games.length), games });
		}
		const holding = shown.filter((o) => o.games.some((g) => g.id === here)).sort((a, b) => byTitle(a.name, b.name));
		for (const { id, name, games: all } of holding) {
			const games = letThrough(all, here);
			rows.push({ key: id, name, line: t.own.shelf(games.length), games });
		}
		return rows;
	});
	/**
	 * True while the library at a glance lies over the list: opened by a click, or by its address. Back onto the entry
	 * of a sheet that came by its address is a shallow popstate: only the address says so, as for a collection.
	 */
	const glanceOpen = $derived(
		!page.state.detail &&
			page.state.collection === undefined &&
			(page.state.glance === true || linkedGlance || page.url.pathname === '/glance')
	);
	/** True while the settings, or the PIN prompt, lie over the list: opened by a click, or by the address, as the glance. */
	const settingsOpen = $derived(
		!page.state.detail &&
			page.state.collection === undefined &&
			!glanceOpen &&
			(page.state.settings === true || linkedSettings || page.url.pathname === '/settings')
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
		// The entry of a deleted collection is left as a sheet is.
		const away = shown || dead;
		if (over && !away && location.pathname === '/') {
			clearTimeout(pending);
			pending = undefined;
			follow(new URL(location.href));
		}
		over = away;
	});

	/** A plain left click, without a modifier key: the ones a browser would not open elsewhere. */
	const isPlainClick = (event: MouseEvent): boolean =>
		event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

	/**
	 * How many entries of the history lie between the list and what opens over the open sheet: one more than for the
	 * sheet, or 0 when the sheet came by its address; 1 when no sheet is open.
	 */
	function behind(): number {
		if (page.state.collection === undefined || dead) return collection !== null || ownSheet !== null ? 0 : 1;
		const sheet = page.state.back ?? 1;
		return sheet === 0 ? 0 : sheet + 1;
	}

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
					pushState(href, { detail: result.data.detail as Detail, list: page.state.list ?? address(view.state), back: behind() });
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

	/** A plain click on a collection's card opens its sheet over the list. */
	async function openCollection(event: MouseEvent, id: string) {
		if (!isPlainClick(event)) return;
		event.preventDefault();
		await showCollection(id);
	}

	/** Opens a collection's sheet over the list. What it shows is in the page already. */
	async function showCollection(id: string) {
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

	/**
	 * A plain click on a GOG collection's card in an own collection's sheet opens its sheet in the own one's place, as a
	 * game opened from a sheet does: closing it shows the list, and Back shows the own sheet again.
	 */
	function openFromSheet(event: MouseEvent, id: string) {
		if (!isPlainClick(event)) return;
		event.preventDefault();
		showInPlace(id);
	}

	/** Opens a collection's sheet in the open sheet's place: from an own one, also after its "Add to…" or "Create". */
	function showInPlace(id: string) {
		if (opening || page.state.detail) return;
		pushState(`/collection/${encodeURIComponent(id)}`, { collection: id, list: page.state.list ?? address(view.state), back: behind() });
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

	/** A plain click on "Settings" in the foot opens the settings, or the PIN prompt, over the list. */
	async function openSettings(event: MouseEvent) {
		if (!isPlainClick(event)) return;
		event.preventDefault();
		if (opening || covered()) return;
		opening = true;
		try {
			// The entry of the list says what the list shows before the sheet goes over it.
			await write();
			if (!covered()) pushState('/settings', { settings: true, list: address(view.state) });
		} finally {
			opening = false;
		}
	}

	function close() {
		// A second press before the first has taken effect would go back out of the list.
		if (closing) return;
		const taken = page.state.detail !== undefined || page.state.collection !== undefined;
		const back = taken ? (page.state.back ?? 1) : page.state.glance || page.state.settings ? 1 : 0;
		if (back > 0) {
			// Opened over the list, perhaps from a collection's sheet: going back that far shows the list where it was.
			closing = true;
			// Released by the navigation, and by the clock should the navigation never happen.
			closingTimer = setTimeout(closed, 1500);
			history.go(-back);
		} else if (taken) {
			// Opened over a page that came by its address: the list takes its place, and Back shows that page again.
			goto(page.state.list ?? '/', { replaceState: true });
		} else goto('/');
	}

	/** Another game of an open row opens in place of this one, with that row open. */
	async function swap(event: MouseEvent, href: string, key: string) {
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
					shelf: key
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

	/** A tag is searched for in the whole library. The platform filter, the chip "Hide 18+", the order and the toggle are the visitor's settings: they stay. */
	function searchTag(tag: string) {
		goto(address({ ...DEFAULT_STATE, os: view.os, sort: view.sort, grouped: view.grouped, hide18: view.hide18, q: tag }));
	}

	// ---------- The settings ----------

	/** Until when this browser is unlocked, as an ISO time; null while it is locked: the PIN prompt shows. */
	// svelte-ignore state_referenced_locally
	let until = $state(learnedUntil === undefined ? settings.unlockedUntil : learnedUntil);
	/** True when the settings were locked while their sheet was open: the PIN prompt says so. */
	let lockedAgain = $state(false);
	/** The settings as the server holds them, without the password: from the layout while this browser is unlocked, or from an answer; null until then. */
	// svelte-ignore state_referenced_locally
	let current = $state<SettingsAnswer | null>(learnedSettings?.settings ?? settings.answer);
	// svelte-ignore state_referenced_locally
	let writable = $state(learnedSettings?.writable ?? settings.writable);
	/** True from "Lock" until the sheet has closed: the PIN prompt does not take its place on the way. */
	let locking = $state(false);
	$effect(() => {
		if (!settingsOpen) locking = false;
	});

	/** What the server holds, and whether it can write it, as an answer told it or a refused change showed it. */
	function learn(next: SettingsAnswer, canWrite: boolean) {
		const held = $state.snapshot(next);
		current = held;
		writable = canWrite;
		learnedSettings = { settings: held, writable: canWrite };
	}

	function unlocked(answer: SettingsAnswer) {
		learn(answer, answer.writable);
		until = learnedUntil = answer.unlockedUntil;
		lockedAgain = false;
		ownLocked = false;
	}

	function locked(again: boolean) {
		until = learnedUntil = null;
		lockedAgain = again;
		if (!again) {
			locking = true;
			close();
		}
	}

	// ---------- Own collections: picking and saving ----------

	/**
	 * True while the PIN prompt lies over the page because a change of the own collections found this browser locked
	 * (spec of own collections, section 13): after the right PIN the person is back where they were.
	 */
	let ownLocked = $state(false);
	/** The PIN prompt is closed. Over the page after a save, it goes and the browser stays locked; at /settings, the sheet closes. */
	function closePin() {
		if (ownLocked) ownLocked = false;
		else close();
	}

	/**
	 * True while "Select" is in the bar: a PIN is set and this browser is unlocked (spec of own collections, section
	 * 8.1), or a save found it locked and picking waits for the PIN.
	 */
	const selectable = $derived(settings.enabled && (until !== null || ownLocked));
	const picking = new Picking();
	// Locked while picking ("Lock", or the PIN prompt of a save closed without the PIN): Select leaves the bar, and
	// picking ends with it.
	$effect(() => {
		if (!selectable) picking.stop();
	});

	/** True while the list "Add to…" is open, and while the dialog "New collection" is. */
	let addOpen = $state(false);
	let naming = $state(false);
	/** Why the last save from the bar, or from the dialog, failed: its red line. */
	let pickError = $state<string | null>(null);
	let namingError = $state<string | null>(null);
	// However picking ends, the list, the dialog and the red lines go with it.
	$effect(() => {
		if (picking.active) return;
		addOpen = false;
		naming = false;
		pickError = namingError = null;
	});

	/** Picks or unpicks a card. What is picked has changed: the bar says what it is again. */
	function toggle(id: string, kind: 'game' | 'collection') {
		picking.toggle(id, kind);
		pickError = null;
	}

	/** The own collections that the picks can go into, for "Add to…". */
	const choices = $derived(
		shown.map((o) => ({ id: o.id, name: o.name, games: letThrough(o.games).length, bands: bandsOf(o, view.hide18) }))
	);
	/** The own collections that the members of the open own sheet can go into: the others. */
	const others = $derived(choices.filter((c) => c.id !== ownSheet?.id));
	/** The picture of what is picked, for the dialog "New collection". */
	const pickedBands = () => bandsOf(resolveOwn([{ id: '', name: '', members: picking.members() }], entries, collections)[0], view.hide18);
	const taken = (name: string) => own.some((c) => sameName(c.name, name));

	/**
	 * Sends a change of the own collections, after the ones before it, and applies the answer to the page's copy. A
	 * browser found locked brings the PIN prompt over the page; nothing is sent again by itself. From the settings sheet
	 * (`overPage` false) it does not: the sheet gives way to the prompt itself, as for a change of the settings. A
	 * collection that is gone when it is deleted counts as deleted.
	 */
	async function saveOwn(request: OwnRequest, overPage = true): Promise<OwnResult> {
		const answer = await queue.run(request);
		const result: OwnResult = request.kind === 'delete' && answer.kind === 'gone' ? { kind: 'saved', collection: null } : answer;
		const before = $state.snapshot(own);
		const next = applyResult(before, request, result);
		if (next !== before) own = learnedOwn = next;
		if (result.kind === 'locked' && overPage) {
			until = learnedUntil = null;
			ownLocked = true;
		}
		return result;
	}

	/** True while "Add to…" or "Create" is being saved: another click waits for it. */
	let saving = false;

	/** After a save from picking: picking ends and the collection's sheet opens, so what changed is seen even with Collections off. */
	async function showSaved(id: string) {
		picking.stop();
		await tick();
		await showCollection(id);
	}

	/** "Add to…": the picks go into that collection; those already in it stay as they are. */
	async function addTo(id: string) {
		addOpen = false;
		if (saving) return;
		saving = true;
		pickError = null;
		try {
			const result = await saveOwn({ kind: 'change', id, body: { add: picking.members() } });
			if (result.kind === 'saved') await showSaved(id);
			else if (picking.active) pickError = failureText(result);
		} finally {
			saving = false;
		}
	}

	function startNaming() {
		addOpen = false;
		namingError = null;
		naming = true;
	}

	/** "Create": a collection of the picks, named so. */
	async function create(name: string) {
		if (saving) return;
		saving = true;
		namingError = null;
		try {
			const result = await saveOwn({ kind: 'create', body: { name, members: picking.members() } });
			if (result.kind === 'saved' && result.collection) {
				// The dialog closes first: the focus it gives back then goes on into the sheet.
				naming = false;
				await tick();
				await showSaved(result.collection.id);
			} else if (naming) namingError = failureText(result);
			// The dialog was closed meanwhile: the bar says why.
			else if (picking.active) pickError = failureText(result);
		} finally {
			saving = false;
		}
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
		// Esc ends picking, unless it closes a sheet or empties the search box.
		if (event.key === 'Escape' && picking.active && !event.defaultPrevented && !document.querySelector('dialog[open]')) picking.stop();
	}

	/** From the search box to the first card: it has the focus and its ring. False when the list is empty. */
	let grid = $state<HTMLElement | null>(null);
	function toResults(): boolean {
		const first = grid?.querySelector<HTMLElement>('.card');
		first?.focus();
		return first !== undefined && first !== null;
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
	<title>{detail ? t.gameTitle(detail.title) : collection ? t.collectionTitle(collection.name) : ownSheet ? t.collectionTitle(ownSheet.name) : glanceOpen ? t.glanceTitle : settingsOpen ? t.settingsTitle : t.pageTitle}</title>
</svelte:head>

<TopBar bind:this={bar} {view} onfilters={() => (filtersOpen = true)} onresults={toResults} {selectable} {picking} />

<main>
	{#if note}
		<div class="toast" role="status"><Icon name="info" /><span>{note === 'collection' ? t.collectionNotInLibrary : t.notInLibrary}</span></div>
	{/if}
	<CountLine {view} onglance={openGlance} />
	{#if view.cards.length > 0}
		<div class="grid" class:has-pick-room={selectable} bind:this={grid}>
			{#each view.shown as card (card.key)}
				{#if card.kind === 'game'}
					{@const id = card.entry.id}
					<Card match={card} onopen={open} pick={picking.active ? { picked: picking.has(id), ontoggle: () => toggle(id, 'game') } : null} />
				{:else if card.kind === 'collection'}
					{@const id = card.collection.id}
					<CollectionCard
						{card}
						oldest={byId.get(card.collection.games[0])}
						onopen={openCollection}
						pick={picking.active ? { picked: picking.has(id), ontoggle: () => toggle(id, 'collection') } : null}
					/>
				{:else}
					<OwnCard {card} bands={bandsOf(card.own, view.hide18)} onopen={openCollection} faded={picking.active} />
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

{#if picking.active}
	<PickBar counts={picking.counts} error={pickError} onaddto={() => (addOpen = !addOpen)} onnew={startNaming} oncancel={() => picking.stop()} {addOpen}>
		<AddToList count={picking.counts.n} {choices} onchoose={addTo} onnew={startNaming} onclose={() => (addOpen = false)} />
	</PickBar>
	<!-- The dialog "New collection": a small sheet of its own, in the look of the PIN prompt. -->
	<Sheet open={naming} onclose={() => (naming = false)} class="pin new-coll" label={t.own.newCollection}>
		<NewCollection
			bands={pickedBands()}
			what={t.own.picks(picking.counts.games, picking.counts.collections)}
			{taken}
			error={namingError}
			oncreate={create}
			onclose={() => (naming = false)}
		/>
	</Sheet>
{/if}

<Foot {version} {builtAt} {timeZone} {update} settings={settings.enabled ? 'on' : 'off'} onsettings={openSettings} />

<FilterPanel open={filtersOpen} onclose={() => (filtersOpen = false)} {view} {entries} />

<!-- One sheet for a game, a collection, the library at a glance and the settings: a game opened from a collection takes its place without the sheet closing. -->
<Sheet
	open={detail !== null || collection !== null || ownSheet !== null || (glanceOpen && glance !== null) || (settingsOpen && until !== null && current !== null)}
	onclose={close}
	class="detail"
	label={detail?.title ?? collection?.name ?? ownSheet?.name ?? (glanceOpen ? t.glance.title : settingsOpen ? t.settings.title : '')}
	view={detail ? `game/${detail.id}` : collection ? `collection/${collection.id}` : ownSheet ? `collection/${ownSheet.id}` : glanceOpen ? 'glance' : settingsOpen ? 'settings' : ''}
>
	{#if detail}
		{#key detail.id}
			<DetailView
				{detail}
				{visitor}
				onclose={close}
				ontag={searchTag}
				{shelves}
				openShelf={page.state.shelf ?? null}
				onswap={swap}
				theo={current?.theo ?? settings.theo}
				batocera={{
					ready: current ? current.batocera.on && current.batocera.ready : settings.batocera.ready,
					preferred: current?.preferred ?? settings.preferred,
					unlocked: until !== null && Date.parse(until) > Date.now(),
					wakeOn: current?.batocera.wake ?? settings.batocera.wake,
					marked: (current?.notRunning ?? settings.notRunning).includes(detail.id)
				}}
				{timeZone}
			/>
		{/key}
	{:else if collection}
		{#key collection.id}
			<CollectionView {collection} games={letThrough(gamesOf(collection, entries))} onclose={close} onopen={open} />
		{/key}
	{:else if ownSheet}
		{#key ownSheet.id}
			<OwnCollectionView
				own={ownSheet}
				hide18={view.hide18}
				onclose={close}
				onopen={open}
				onopencollection={openFromSheet}
				unlocked={selectable}
				{others}
				save={saveOwn}
				onshow={showInPlace}
			/>
		{/key}
	{:else if glanceOpen && glance}
		<GlanceView {glance} games={entries.length} collections={collections.length} {builtAt} {timeZone} onclose={close} />
	{:else if settingsOpen && until !== null && current !== null}
		{@const held = current}
		<SettingsView
			settings={held}
			unlockedUntil={until}
			bind:writable={() => writable, (canWrite) => learn(held, canWrite)}
			{timeZone}
			onsaved={(answer) => learn(answer, answer.writable)}
			onlocked={locked}
			onclose={close}
			own={choices}
			saveOwn={(request) => saveOwn(request, false)}
		/>
	{/if}
</Sheet>

<!-- The PIN prompt: a small sheet of its own, at /settings while this browser is locked, and over the page when a
     change of the own collections found it locked. -->
<Sheet open={(settingsOpen && until === null && !locking) || ownLocked} onclose={closePin} class="pin" label={t.pin.title}>
	<PinPrompt again={lockedAgain || ownLocked} onunlocked={unlocked} onclose={closePin} />
</Sheet>
