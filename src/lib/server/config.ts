import { GITHUB_LATEST_RELEASE_URL } from './updates';

export interface Config {
	vangoghUrl: string;
	username: string;
	password: string;
	rebuildAt: string;
	timeZone: string;
	customLogo: string | null;
	cacheDir: string;
	/** False when `VERSION_CHECK` is off: Canvas never asks GitHub for the latest release. */
	versionCheck: boolean;
	/** Where the latest release is asked for. Replaced in the tests only (`VERSION_CHECK_URL`). */
	versionCheckUrl: string;
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
	if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(rebuildAt)) {
		throw new ConfigError('REBUILD_AT must be a time as HH:MM');
	}

	const timeZone = value('TZ') || 'UTC';
	try {
		new Intl.DateTimeFormat('en', { timeZone });
	} catch {
		throw new ConfigError('TZ is not a known time zone');
	}

	const versionCheck = !['off', 'false', '0'].includes(value('VERSION_CHECK').toLowerCase());
	const versionCheckUrl = (versionCheck && value('VERSION_CHECK_URL')) || GITHUB_LATEST_RELEASE_URL;
	if (!/^https?:\/\//.test(versionCheckUrl)) {
		throw new ConfigError('VERSION_CHECK_URL must be an http or https address');
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
		versionCheckUrl
	};
}
