/**
 * A line of the connection test, one per check as it ends, then the end. Spec 0.12.0, section 9.3.
 * The page writes each line's text; the server sends what goes into it.
 */
export type TestLine =
	| {
			step: 1 | 2 | 3 | 4 | 5;
			result: 'ok' | 'warn' | 'fail';
			/** Line 1: the address tested, as typed. */
			address?: string;
			/** Line 2, failed: the box refused the user or the password, or its SSH did not start in time. */
			login?: 'refused' | 'no-ssh';
			/** Line 3, failed: the folder that cannot be written. */
			folder?: string;
			/** Line 3, failed: the box's own reason, when it gave one. */
			reason?: string;
			/** Line 3, failed: the box has no innoextract (0.12.1). */
			noInnoextract?: true;
			/** Line 4, passed: the free bytes of `/userdata`. */
			free?: number;
			/** Line 4, passed: Batocera's version, such as "43.1". */
			version?: string;
	  }
	| { done: true; ready: boolean; mac: string | null };

/** A line of the wake test, one per step as it ends, then the end; `seconds` from the packet to the answer. Spec 0.12.0, section 9.5. */
export type WakeLine = { step: 'down' | 'waking'; result: 'ok' | 'fail' | 'busy' } | { done: true; seconds: number | null };

/** Whether the box answered at the last look; unknown before the first. Spec 0.12.0, section 4.2. */
export type BoxState = 'up' | 'down' | 'unknown';

/** Where the last look found a game: not on the box, sent by Canvas (its marker), or put there by hand. */
export type OnBox = 'no' | 'canvas' | 'hand';

/** The three steps of a send (spec 0.12.1, section 5). */
export type StepName = 'copy' | 'unpack' | 'reload';

/** Why a send stopped, with the numbers its text needs; the page writes the text (spec 0.12.0, section 3). */
export type FailReason =
	| { code: 'box-down' }
	| { code: 'box-room'; free: number; need: number }
	| { code: 'fetch' }
	| { code: 'checksum' }
	| { code: 'unpack' }
	| { code: 'unrar' }
	| { code: 'copy' }
	/** A folder Canvas did not make is where the game would go, and is never replaced. */
	| { code: 'in-the-way'; path: string }
	| { code: 'key-changed' }
	/** The box refused the saved user or password. */
	| { code: 'login' };

/** A send to Batocera as the page is told it (spec 0.12.0, sections 3.1 and 3.3). */
export interface JobView {
	id: string;
	state: 'waiting' | 'running' | 'failed' | 'done';
	/** The jobs before this one in the queue, the one running included. */
	ahead: number;
	step: StepName;
	stepNumber: number;
	steps: 3;
	/** The whole job, from 0 to 1, each step weighted by what it takes for the game. */
	overall: number;
	/** What the step has done of its bytes: copied, or unpacked. */
	bytesDone: number;
	bytesAll: number;
	/** Null until the job has measured something, and while it waits for the box. */
	minutesLeft: number | null;
	/** Whether Canvas woke the box for this job, and whether it answers yet. */
	waking: 'no' | 'waking' | 'awake';
	/** Step 1 waits for Batocera before its copy begins: no bytes and no minutes, and the bar holds still. */
	waitingForBox: boolean;
	reason: FailReason | null;
	/** When the job ended, sent or failed, as an ISO time. */
	endedAt: string | null;
	/** Sent while a game ran on the TV: Batocera's list is reloaded once it is closed. */
	listLater: boolean;
}

/**
 * What became of "Play on the TV" (spec 0.12.0, section 5): waking the box first, started, another game
 * running, no screen, the game no longer on the box, the box not answering, or a start that did not happen.
 */
export type PlayView =
	| { state: 'waking' }
	| { state: 'started' }
	| { state: 'running'; name: string }
	| { state: 'no-screen' }
	| { state: 'gone' }
	| { state: 'box-down' }
	| { state: 'not-started' };

/** The answer of a play, which the route of section 11 turns into its status and body. */
export type PlayAnswer = PlayView;

/** A game's Batocera state, the answer of `GET /api/batocera/games/<id>`. Spec 0.12.0, sections 4.2 and 11. */
export interface GameOnBox {
	/** True when a send can start: section 2.1, and the game not put there by hand (section 3.4). */
	can: boolean;
	system: 'windows' | 'dos';
	/** The bytes of the files to send: the Windows installer files of the game and of its DLC. */
	size: number;
	onBox: OnBox;
	/** The version and the time of the send that Canvas's marker on the box records. */
	version: string | null;
	sentAt: string | null;
	/** On the box by Canvas, and vangogh's installer files are not those sent. */
	newer: boolean;
	/** Marked "Doesn't run on Batocera" (section 7.6). */
	marked: boolean;
	/** The send waiting or running, else the last one's result until the game's next send (section 3.1). */
	job: JobView | null;
	/** The seconds left before Batocera shuts down, for the game of the send that started it (section 6.2). */
	countdown: number | null;
	/** The last play's result for this game, for 10 minutes (section 5). */
	play: PlayView | null;
	box: BoxState;
	/** When the last look was made, whether the box answered or not. */
	checkedAt: string | null;
}
