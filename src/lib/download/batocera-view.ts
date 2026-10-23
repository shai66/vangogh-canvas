import { dayWhen } from '$lib/age';
import type { GameOnBox, PlayView } from '$lib/batocera';
import { formatSize } from '$lib/format';
import { t } from '$lib/strings';
import type { IconName } from '$lib/ui/icons';

/** The TV at the line's left (spec 5.1), or the sign `prohibit` in its place for a marked game on a locked phone (row 32). */
export type BatoceraTv = { look: 'dim' | 'yellow' | 'faint'; tip: string } | 'prohibit';

/** The line beside the main button, or under it on a phone (spec 3 and 5.4). */
export interface BatoceraLine {
	tv: BatoceraTv;
	bold: string;
	/** True while a send is fresh: the yellow check after the bold words. */
	check: boolean;
	plain: string;
	/** The words of the "i"; null where it has none. */
	info: string | null;
	/** The flag at the line's end; null in a locked browser, during a send and for a game not on the box. */
	flag: 'mark' | 'unmark' | null;
	/** A send's bar: the whole send from 0 to 1 and its value text; null outside a send under way. */
	bar: { overall: number; text: string } | null;
	/** The two lines as one sentence for the line's live region (spec 7), a send's numbers left out. */
	spoken: string;
}

export type NoteAct = 'keep' | 'force' | 'cancel' | 'update' | 'retry';

/** The one note under the button (spec 4 and 5.3): N1 to N7. */
export interface BatoceraNote {
	id: 'countdown' | 'newer' | 'running' | 'no-screen' | 'not-started' | 'box-down' | 'gone' | 'failed';
	kind: 'plain' | 'bad';
	icon: IconName;
	bold: string;
	/** '' for N6. */
	plain: string;
	/** N7's own "i": the reason in full, then what is left on the box; null for the others. */
	info: string | null;
	acts: { label: string; act: NoteAct; primary: boolean }[];
	/** True while this page's Play waits for its answer: the buttons wait too (rows 18 and 19). */
	busy: boolean;
}

export interface BatoceraView {
	main: 'send' | 'stop' | 'play' | 'starting' | null;
	primary: boolean;
	disabled: boolean;
	menu: { text: string; on: boolean; disabled: boolean };
	line: BatoceraLine;
	note: BatoceraNote | null;
}

export interface BatoceraOptions {
	/** True while the settings are unlocked in this browser: the mark can be set. */
	unlocked: boolean;
	/** True while Canvas wakes Batocera for a send. */
	wakeOn: boolean;
	/** What became of Play on the TV, as this page shows it (`BatoceraWatch.shownPlay`). */
	play: PlayView | null;
	/** This page's Play waits for the box's answer: pressed as "Play on the TV", or as "Close it and play". */
	starting?: 'play' | 'close' | null;
	/** The send ended as sent less than ten minutes ago (`justSent` of `plan.ts`). */
	justSent: boolean;
	/** This page pressed "Keep it on" since the last send. */
	keptOn?: boolean;
	/** vangogh's version of the Windows installer. */
	version?: string;
	/** The time zone the day of a send is written in. */
	timeZone?: string;
	/** True while the main button is on Batocera, as it always is on a phone: N2 to N6 show only then. */
	picked: boolean;
}

/** The main button's icon by what it does: Stop is a stop in a circle (spec 6.1). */
export const MAIN_ICON: Record<NonNullable<BatoceraView['main']>, IconName> = { send: 'tv', stop: 'stopCircle', play: 'play', starting: 'spinner' };

/** The day of a send, "20 October", or null when the time is not one. */
function dayOf(sentAt: string | null, timeZone: string): string | null {
	const at = sentAt ? new Date(sentAt) : null;
	return at && !Number.isNaN(at.getTime()) ? dayWhen(at, timeZone) : null;
}

/** The whole send in per cent, held from 0 to 100 and rounded down, so "100 %" shows only once all of it is done. */
export const percentOf = (overall: number): number => Math.min(100, Math.max(0, Math.floor(overall * 100)));

/** The line's two lines as one sentence: each ends with a full stop unless it ends with its own mark. */
function spoken(...parts: string[]): string {
	return parts
		.filter((part) => part !== '')
		.map((part) => (/[.…?]$/.test(part) ? part : `${part}.`))
		.join(' ');
}

/** The TV's state (section 5.1), the first that applies; `there` while the game counts as on the box. */
function tvOf(game: GameOnBox, there: boolean, o: BatoceraOptions): BatoceraTv {
	const b = t.batocera;
	const job = game.job;
	const on = { look: 'dim', tip: b.tvOn } as const;
	const woken = { look: 'dim', tip: b.tvWoken } as const;
	const off = { look: 'faint', tip: b.downTitle } as const;
	// The box's state of the last look.
	const look = (): BatoceraTv => {
		switch (game.box) {
			case 'up':
				return on;
			case 'down':
				return o.wakeOn ? { look: 'faint', tip: there ? b.tvOffPlay : b.offWakes } : off;
			case 'unknown':
				return { look: 'faint', tip: b.tvUnknown };
		}
	};
	if (game.marked && !o.unlocked) return 'prohibit';
	if (job?.state === 'running') return job.waking === 'waking' ? { look: 'yellow', tip: b.tvWaking } : job.waking === 'awake' ? woken : on;
	if (job?.state === 'waiting') return look();
	if (o.starting) return on;
	switch (o.play?.state) {
		case 'waking':
			return { look: 'yellow', tip: b.tvWakingPlay };
		case 'started':
		case 'running':
		case 'no-screen':
		case 'not-started':
			return on;
		case 'box-down':
			return off;
		case 'gone':
			return look();
	}
	if (game.countdown !== null) return job?.state === 'failed' ? { look: 'dim', tip: b.tvCounting(b.clock(game.countdown)) } : woken;
	if (o.keptOn) return { look: 'dim', tip: b.keptOn };
	if (o.justSent && job?.state === 'done') return job.waking === 'awake' ? woken : on;
	return look();
}

/**
 * The one note, the first that applies (section 4): this page's Play, then a failed send, then the countdown, then
 * a newer version. N2 to N6 only while the button is on Batocera.
 */
function noteOf(game: GameOnBox, there: boolean, o: BatoceraOptions): BatoceraNote | null {
	const b = t.batocera;
	const job = game.job;
	const note = (
		id: BatoceraNote['id'],
		kind: BatoceraNote['kind'],
		icon: IconName,
		bold: string,
		plain: string,
		acts: BatoceraNote['acts'] = [],
		info: string | null = null
	): BatoceraNote => ({ id, kind, icon, bold, plain, info, acts, busy: !!o.starting });
	// A marked game has no note (row 30): the line says why, and "Try again" never sends a game marked as not running.
	if (game.marked) return null;
	// A send under way has no note, an update of a newer version too (rows 5 to 10): the line says it all.
	if (job?.state === 'waiting' || job?.state === 'running') return null;
	// Play's waking and started are said in the line.
	if (o.picked) {
		switch (o.play?.state) {
			case 'running':
				return note('running', 'plain', 'controller', b.runningTitle, b.runningText, [
					{ label: b.force, act: 'force', primary: true },
					{ label: b.cancel, act: 'cancel', primary: false }
				]);
			case 'no-screen':
				return note('no-screen', 'bad', 'monitor', b.noScreenTitle, b.noScreenPlain);
			case 'not-started':
				return note('not-started', 'bad', 'warning', b.notStartedTitle, b.notStartedPlain);
			case 'box-down':
				return note('box-down', 'bad', 'warning', b.downTitle, b.downText);
			case 'gone':
				return note('gone', 'bad', 'warning', b.goneTitle, '');
		}
	}
	const keep = { label: b.keepOn, act: 'keep', primary: false } as const;
	// Canvas may have woken the box for a send that failed: its countdown can be stopped from here too.
	if (job?.state === 'failed') {
		// A failed update left the older version on the box.
		const { bold, plain } = b.failedNote(job.reason, there);
		const acts = [{ label: b.retry, act: 'retry', primary: false } as const, ...(game.countdown === null ? [] : [keep])];
		return note('failed', 'bad', 'warning', bold, plain, acts, b.failedInfo(job.reason, there));
	}
	if (game.countdown !== null) return note('countdown', 'plain', 'power', b.shutsDown(b.clock(game.countdown)), b.wokeForSend, [keep]);
	if (o.picked && there && game.onBox === 'canvas' && game.newer && !game.marked) {
		return note('newer', 'plain', 'update', b.newerTitle, b.savesStay, [{ label: b.update, act: 'update', primary: false }]);
	}
	return null;
}

/**
 * What a game's detail shows of Batocera for its state, direction B, "the line holds the state" (spec 2026-10-21,
 * table 5.4): the main button, the row of the menu, the line and the one note. A send under way comes first, so it
 * can always be stopped; then the mark, then where the game is. A Play that found the game gone takes it as not
 * there, whatever the last look said.
 */
export function batoceraView(game: GameOnBox, o: BatoceraOptions): BatoceraView {
	const b = t.batocera;
	const job = game.job;
	const there = game.onBox !== 'no' && o.play?.state !== 'gone';
	const note = noteOf(game, there, o);
	const tv = tvOf(game, there, o);
	// `numbers` while the plain line is a send's numbers, which the live region leaves out. While "Close it and
	// play" asks in yellow, the main button is quiet (section 6).
	const view = (button: Omit<BatoceraView, 'line' | 'note'>, line: Omit<BatoceraLine, 'tv' | 'spoken'>, numbers = false): BatoceraView => ({
		...button,
		primary: button.primary && note?.id !== 'running',
		line: { tv, ...line, spoken: spoken(line.bold, numbers ? '' : line.plain) },
		note
	});
	if (job?.state === 'waiting' || job?.state === 'running') {
		const waiting = job.state === 'waiting';
		const button = { main: 'stop', primary: false, disabled: false, menu: { text: waiting ? b.menu.waiting : b.menu.sending, on: false, disabled: false } } as const;
		const sending = { check: false, info: b.closeThis, flag: null };
		if (job.state === 'waiting') return view(button, { ...sending, bold: b.waiting, plain: b.ahead(job.ahead), bar: null });
		const percent = percentOf(job.overall);
		// Step 4, the reload, takes about a second: no minutes.
		const minutes = job.step === 'reload' ? null : job.minutesLeft;
		const bar = { overall: job.overall, text: b.barText(percent, minutes) };
		// While the send waits for Batocera, the plain line says the box's state.
		if (job.waitingForBox) return view(button, { ...sending, bold: b.waitingStep(job.stepNumber), plain: b.box[job.waking], bar });
		return view(button, { ...sending, bold: b.step(job.step, job.stepNumber), plain: b.numbers(percent, minutes), bar }, true);
	}
	if (game.marked) {
		return view(
			{ main: o.unlocked ? 'send' : null, primary: false, disabled: true, menu: { text: b.menu.marked, on: false, disabled: !o.unlocked } },
			{ bold: b.marked, check: false, plain: o.unlocked ? b.hidden : b.markedNote, info: null, flag: o.unlocked ? 'unmark' : null, bar: null }
		);
	}
	if (there) {
		// Fresh: sent less than ten minutes ago, or its countdown runs.
		const fresh = job?.state === 'done' && (o.justSent || game.countdown !== null);
		const version = game.version ? `${b.versionOf(game.version)} ` : '';
		const box = game.version ?? '';
		const archive = o.version ?? '';
		const info = fresh
			? `${version}${job?.listLater ? b.listLater : b.inList(game.system)}`
			: game.onBox === 'hand'
				? `${b.handInfo} ${b.hint}`
				: game.newer
					? `${box && archive && box !== archive ? b.newer(box, archive) : b.newerFiles} ${b.hint}`
					: `${version}${b.hint}`;
		const play = o.play?.state;
		const plain =
			o.starting === 'close'
				? b.closingLine
				: o.starting
					? b.startingLine
					: play === 'waking'
						? b.wakingLine
						: play === 'started'
							? b.startedLine
							: game.onBox === 'hand'
								? b.byHand
								: b.sentDay(dayOf(game.sentAt, o.timeZone ?? 'UTC'));
		// While Play waits for the box's answer, the button waits too: grey, turning and disabled.
		return view(
			{
				main: o.starting ? 'starting' : 'play',
				primary: !o.starting,
				disabled: !!o.starting,
				menu: { text: game.onBox === 'canvas' && game.newer ? b.menu.newer : b.menu.on, on: true, disabled: false }
			},
			{ bold: b.onBox, check: fresh, plain, info, flag: o.unlocked ? 'mark' : null, bar: null }
		);
	}
	const size = formatSize(game.size);
	const down = game.box === 'down';
	return view(
		{ main: 'send', primary: true, disabled: false, menu: { text: down ? (o.wakeOn ? b.menu.offWakes : b.menu.off) : b.menu.no, on: false, disabled: false } },
		{
			bold: game.system === 'dos' ? b.dosGame(size) : b.windowsVersion(size),
			check: false,
			plain: job?.state === 'failed' ? b.failedTitle : down && !o.wakeOn ? b.turnOn : b.notYet,
			info: b.notThere,
			flag: null,
			bar: null
		}
	);
}

/** What the line's live region was last told: the line as one sentence, and whether the button was on Batocera with the server's answer. */
export interface Heard {
	sentence: string;
	on: boolean;
}

/**
 * What the line's live region says now (spec 7): the new sentence while the button stays on Batocera, else null.
 * Nothing at the first draw, and nothing when the button only moves to or from Batocera: its new name is read where
 * the focus is. A send's numbers are not in the sentence, so a new percentage is not said.
 */
export function lineAnnouncement(last: Heard | null, now: Heard): string | null {
	return last?.on && now.on && last.sentence !== now.sentence ? now.sentence : null;
}
