import { NOTHING_REMEMBERED, type Remembered } from './remember';
import type { Sort } from './search/state';
import { ALL_OS, type Os } from './types';

/** What a game's main button starts on; 'auto' is the visitor's own system. Spec 0.12.0, section 8. */
export type Preferred = 'auto' | Os | 'batocera';

/** Every preferred platform, in the order they are offered. */
export const PREFERRED: readonly Preferred[] = ['auto', 'windows', 'macos', 'linux', 'batocera'];

/** The Batocera box games are sent to. Spec 0.12.0, section 10.1. */
export interface BatoceraSettings {
	on: boolean;
	/** An IPv4 address or a host name. Empty until typed. */
	address: string;
	user: string;
	/** Never sent to a browser. */
	password: string;
	/** True while the last connection test passed with this address, user and password. */
	ready: boolean;
	/** The SSH host key accepted at the last passed test, as OpenSSH's SHA256 fingerprint. */
	hostKey: string | null;
	/** Read at the last passed test, as aa:bb:cc:dd:ee:ff. */
	mac: string | null;
	wake: boolean;
	shutdown: boolean;
}

/** Batocera's own defaults, `root` and `linux`, and nothing tested yet. */
export const NO_BATOCERA: BatoceraSettings = {
	on: false,
	address: '',
	user: 'root',
	password: 'linux',
	ready: false,
	hostKey: null,
	mac: null,
	wake: false,
	shutdown: false
};

/**
 * What Canvas does on its own, as changed in the sheet. Each is null until it is changed there, and while null the
 * stack's value applies. Spec of the settings tabs, section 5.2.
 */
export interface ServerSettings {
	/** The time of the daily rebuild, as HH:MM. */
	rebuildAt: string | null;
	timeZone: string | null;
	versionCheck: boolean | null;
}

/** Nothing changed in the sheet: the stack's values apply. */
export const NO_SERVER: ServerSettings = { rebuildAt: null, timeZone: null, versionCheck: null };

/** The Server settings that apply: the sheet's, else the stack's. */
export interface ServerInEffect {
	rebuildAt: string;
	timeZone: string;
	versionCheck: boolean;
}

/** Each stored value, else the stack's. */
export function serverInEffect(stored: ServerSettings, stack: ServerInEffect): ServerInEffect {
	return {
		rebuildAt: stored.rebuildAt ?? stack.rebuildAt,
		timeZone: stored.timeZone ?? stack.timeZone,
		versionCheck: stored.versionCheck ?? stack.versionCheck
	};
}

/** What whoever holds the PIN chose for everyone at home. Spec 0.11.0, section 3, and 0.12.0, section 10.1. */
export interface Settings {
	/** How the library opens in a browser that has not chosen its own view. */
	defaults: Remembered;
	/** True when a game's detail shows the theo panel. */
	theo: boolean;
	preferred: Preferred;
	batocera: BatoceraSettings;
	/** Ids of the games marked "Doesn't run on Batocera". */
	notRunning: string[];
	server: ServerSettings;
}

export const NO_SETTINGS: Settings = {
	defaults: NOTHING_REMEMBERED,
	theo: false,
	preferred: 'auto',
	batocera: NO_BATOCERA,
	notRunning: [],
	server: NO_SERVER
};

/** What the page is told of the settings with the layout's data. */
export interface SettingsInfo {
	/** False while no PIN is set: settings are off. */
	enabled: boolean;
	theo: boolean;
	preferred: Preferred;
	/** Whether Batocera is set up (spec 0.12.0, section 9.4), and whether Canvas wakes it for a send. */
	batocera: { ready: boolean; wake: boolean };
	notRunning: string[];
	/** When this browser's unlock runs out, as an ISO time; null while it is locked. */
	unlockedUntil: string | null;
	/** False while the settings folder cannot be written. */
	writable: boolean;
	/** The settings as the settings routes answer them, so the sheet opens without a request; null while locked. */
	answer: SettingsAnswer | null;
}

/** Batocera's settings as a browser is told them: without the password. */
export type BatoceraAnswer = Omit<BatoceraSettings, 'password'> & { passwordSaved: true };

/** The answer of the settings routes while the browser is unlocked. */
export interface SettingsAnswer extends Omit<Settings, 'batocera'> {
	batocera: BatoceraAnswer;
	unlockedUntil: string;
	writable: boolean;
	/** The Server settings that apply, the stored ones or the stack's. */
	inEffect: ServerInEffect;
	/** The stack's own, so that the sheet always offers its zone. */
	stack: ServerInEffect;
}

/** What `GET /api/settings/status` answers: the facts of the panel "This Canvas". Spec of the settings tabs, section 4. */
export interface ServerStatus {
	version: string;
	/** Null while the update check is off. */
	update: { latest: string | null; newer: string | null; checkedAt: string | null } | null;
	startedAt: string;
	vangogh: { url: string; login: 'unknown' | 'ok' | 'rejected' };
	library: {
		games: number;
		collections: number;
		builtAt: string | null;
		nextAt: string;
		rebuild: { running: boolean; lastResult: 'never' | 'ok' | 'failed'; lastError: string | null };
	};
	batocera: 'off' | 'not-set-up' | 'ready';
	jobs: number;
	/** The zone the times are written in. */
	timeZone: string;
}

/**
 * The body of `PUT /api/settings`. Batocera's part has no `ready`, `hostKey` or `mac`, which only a connection test
 * sets, and a password only when one was typed. No marks: they change through their own routes. Spec 0.12.0, section 11.
 */
export interface SettingsBody {
	defaults: Remembered;
	theo: boolean;
	preferred: Preferred;
	batocera: { on: boolean; address: string; user: string; password?: string; wake: boolean; shutdown: boolean };
	/** Sent only for a change on the Server tab, and missing from an older open page: without it, what is saved stays. */
	server?: ServerSettings;
}

/** Every sort order, in the order they are offered. */
export const SORTS: readonly Sort[] = ['title', 'recent', 'year'];

function isRecord(x: unknown): x is Record<string, unknown> {
	return x !== null && typeof x === 'object' && !Array.isArray(x);
}

// The valid values of the parts of 0.12.0, for the body of a change and for the file.
export const isPreferred = (x: unknown): x is Preferred => PREFERRED.includes(x as Preferred);
export const isBoxAddress = (x: unknown): x is string => typeof x === 'string' && (x === '' || /^[A-Za-z0-9.-]{1,253}$/.test(x));
export const isBoxUser = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9._-]{1,32}$/.test(x);
export const isBoxPassword = (x: unknown): x is string => typeof x === 'string' && x.length >= 1 && x.length <= 128;
export const isHostKey = (x: unknown): x is string | null =>
	x === null || (typeof x === 'string' && /^SHA256:[A-Za-z0-9+/]{43}$/.test(x));
export const isMac = (x: unknown): x is string | null =>
	x === null || (typeof x === 'string' && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(x));
/** Game ids: digit strings. */
export const isGameIds = (x: unknown): x is string[] => Array.isArray(x) && x.every((id) => typeof id === 'string' && /^\d+$/.test(id));

// The valid values of the Server settings, for the stack, the body of a change and the file.
export const isRebuildAt = (x: unknown): x is string => typeof x === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(x);
/** A zone the runtime knows. */
export function isTimeZone(x: unknown): x is string {
	if (typeof x !== 'string') return false;
	try {
		new Intl.DateTimeFormat('en', { timeZone: x });
		return true;
	} catch {
		return false;
	}
}

/** The `server` part of the body of a change, or null when it is not valid. */
function parseServer(x: unknown): ServerSettings | null {
	if (!isRecord(x)) return null;
	const { rebuildAt, timeZone, versionCheck } = x;
	// Null is a value not changed in the sheet.
	if (rebuildAt !== null && !isRebuildAt(rebuildAt)) return null;
	if (timeZone !== null && !isTimeZone(timeZone)) return null;
	if (versionCheck !== null && typeof versionCheck !== 'boolean') return null;
	return { rebuildAt, timeZone, versionCheck };
}

/**
 * The settings in the body of `PUT /api/settings`, or null when a part is missing or not valid:
 * each part is checked as the file's are, but refused rather than mended. A platform named twice
 * is refused too. Keys it does not know are ignored, and so are `ready`, `hostKey`, `mac` and the
 * marks. A missing `server` part stays missing. Spec 0.11.0, section 7, 0.12.0, section 11, and of the settings
 * tabs, section 8.
 */
export function parseSettingsBody(body: unknown): SettingsBody | null {
	if (!isRecord(body) || !isRecord(body.defaults) || !isRecord(body.batocera)) return null;
	const { os, sort, grouped, hide18 } = body.defaults;
	const { theo, preferred } = body;
	const { on, address, user, password, wake, shutdown } = body.batocera;
	if (!Array.isArray(os) || new Set(os).size !== os.length) return null;
	if (!os.every((name) => (ALL_OS as readonly unknown[]).includes(name))) return null;
	if (!SORTS.includes(sort as Sort)) return null;
	if (typeof grouped !== 'boolean' || typeof hide18 !== 'boolean' || typeof theo !== 'boolean') return null;
	if (!isPreferred(preferred)) return null;
	if (typeof on !== 'boolean' || typeof wake !== 'boolean' || typeof shutdown !== 'boolean') return null;
	if (!isBoxAddress(address) || !isBoxUser(user)) return null;
	// No password keeps the saved one.
	if (password !== undefined && !isBoxPassword(password)) return null;
	const server = body.server === undefined ? undefined : parseServer(body.server);
	if (server === null) return null;
	return {
		// In the fixed order.
		defaults: { os: ALL_OS.filter((name) => os.includes(name)), sort: sort as Sort, grouped, hide18 },
		theo,
		preferred,
		batocera: { on, address, user, ...(password === undefined ? {} : { password }), wake, shutdown },
		...(server === undefined ? {} : { server })
	};
}

/**
 * The settings after a change: the body's, with the saved password and Server settings when the body has none, and
 * what only a connection test sets and the marks kept. A change of the address, the user or the password ends
 * "set up". Spec 0.12.0, section 9.2.
 */
export function applyBody(saved: Settings, body: SettingsBody): Settings {
	const was = saved.batocera;
	const { on, address, user, password = was.password, wake, shutdown } = body.batocera;
	const same = address === was.address && user === was.user && password === was.password;
	return {
		defaults: body.defaults,
		theo: body.theo,
		// With Batocera switched off the press moves to Autoselect (spec 0.12.0, section 9.1).
		preferred: !on && body.preferred === 'batocera' ? 'auto' : body.preferred,
		batocera: { on, address, user, password, ready: was.ready && same, hostKey: was.hostKey, mac: was.mac, wake, shutdown },
		notRunning: saved.notRunning,
		server: body.server ?? saved.server
	};
}

/** The settings as the unlocked browser is told them, with the Server settings in effect and the stack's: the password stays on the server. */
export function toAnswer(s: Settings, unlockedUntil: string, writable: boolean, inEffect: ServerInEffect, stack: ServerInEffect): SettingsAnswer {
	const { password: _, ...batocera } = s.batocera;
	return { ...s, batocera: { ...batocera, passwordSaved: true }, unlockedUntil, writable, inEffect, stack };
}

/** True when a game can show Batocera: the switch is on and the last connection test passed. Spec 0.12.0, section 9.4. */
export function batoceraReady(s: Settings): boolean {
	return s.batocera.on && s.batocera.ready;
}
