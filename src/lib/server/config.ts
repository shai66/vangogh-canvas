import { isRebuildAt, isTimeZone } from '../settings';
import { GITHUB_LATEST_RELEASE_URL } from './updates';

export interface Config {
	vangoghUrl: string;
	username: string;
	password: string;
	rebuildAt: string;
	timeZone: string;
	customLogo: string | null;
	cacheDir: string;
	/** False when `VERSION_CHECK` is off: Canvas does not ask GitHub for the latest release unless the settings switch the check on. */
	versionCheck: boolean;
	/**
	 * Where the latest release is asked for, also while the check is off, since the settings may switch it on.
	 * Replaced in the tests only (`VERSION_CHECK_URL`).
	 */
	versionCheckUrl: string;
	/** The PIN that unlocks the settings; null while settings are off. Never logged. */
	settingsPin: string | null;
	/** The folder of `settings.json`. */
	settingsDir: string;
	/** The SSH port of the Batocera box. Replaced in the tests only (`BATOCERA_PORT`). */
	batoceraPort: number;
	/** `host:port` the wake packet goes to instead of the broadcasts; null but in the tests (`BATOCERA_WAKE_TO`). */
	wakeTo: string | null;
	/** How long Batocera stays on after a send Canvas woke it for. Shortened in the tests only (`BATOCERA_SHUTDOWN_SECONDS`). */
	shutdownSeconds: number;
}

export class ConfigError extends Error {}

const REQUIRED = ['VANGOGH_URL', 'VANGOGH_USERNAME', 'VANGOGH_PASSWORD'] as const;

export function loadConfig(env: Record<string, string | undefined>): Config {
	const value = (name: string): string => env[name]?.trim() ?? '';

	const missing = REQUIRED.filter((name) => !value(name));
	if (missing.length > 0) {
		throw new ConfigError(`Missing required environment variable(s): ${missing.join(', ')}`);
	}

	let url: URL;
	try {
		url = new URL(value('VANGOGH_URL'));
	} catch {
		throw new ConfigError('VANGOGH_URL must be an http or https address');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new ConfigError('VANGOGH_URL must be an http or https address');
	}
	// The address is logged at start: it must hold no secret.
	if (url.username !== '' || url.password !== '') {
		throw new ConfigError('VANGOGH_URL must not contain a username or password');
	}

	const rebuildAt = value('REBUILD_AT') || '04:30';
	if (!isRebuildAt(rebuildAt)) {
		throw new ConfigError('REBUILD_AT must be a time as HH:MM');
	}

	const timeZone = value('TZ') || 'UTC';
	if (!isTimeZone(timeZone)) {
		throw new ConfigError('TZ is not a known time zone');
	}

	const versionCheck = !['off', 'false', '0'].includes(value('VERSION_CHECK').toLowerCase());
	const asked = value('VERSION_CHECK_URL') || GITHUB_LATEST_RELEASE_URL;
	const askable = /^https?:\/\//.test(asked);
	// Refused only while the check is on, so a stack with it off starts as before: then GitHub's stands in.
	if (versionCheck && !askable) {
		throw new ConfigError('VERSION_CHECK_URL must be an http or https address');
	}
	const versionCheckUrl = askable ? asked : GITHUB_LATEST_RELEASE_URL;

	const settingsPin = value('SETTINGS_PIN') || null;
	if (settingsPin !== null && !/^\d{4,8}$/.test(settingsPin)) {
		throw new ConfigError('SETTINGS_PIN must be 4 to 8 digits');
	}

	const port = value('BATOCERA_PORT') || '22';
	if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
		throw new ConfigError('BATOCERA_PORT must be a port number');
	}

	const shutdownSeconds = value('BATOCERA_SHUTDOWN_SECONDS') || '600';
	// A day at most, well inside the longest timer Node keeps (about 24.8 days; a longer one fires at once).
	if (!/^\d+$/.test(shutdownSeconds) || Number(shutdownSeconds) < 1 || Number(shutdownSeconds) > 86_400) {
		throw new ConfigError('BATOCERA_SHUTDOWN_SECONDS must be a whole number of seconds');
	}

	return {
		vangoghUrl: value('VANGOGH_URL').replace(/\/+$/, ''),
		username: value('VANGOGH_USERNAME'),
		password: env.VANGOGH_PASSWORD ?? '',
		rebuildAt,
		timeZone,
		customLogo: value('CUSTOM_LOGO') || null,
		cacheDir: value('CACHE_DIR') || '/cache',
		versionCheck,
		versionCheckUrl,
		settingsPin,
		settingsDir: value('SETTINGS_DIR') || '/settings',
		batoceraPort: Number(port),
		wakeTo: value('BATOCERA_WAKE_TO') || null,
		shutdownSeconds: Number(shutdownSeconds)
	};
}
