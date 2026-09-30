import { building } from '$app/environment';
import type { HandleServerError, ServerInit } from '@sveltejs/kit';
import { getApp, startApp } from '$lib/server/app';
import { ConfigError } from '$lib/server/config';
import { createLogger, type Logger } from '$lib/server/log';

export const init: ServerInit = async () => {
	if (building) return;
	try {
		await startApp();
	} catch (error) {
		if (error instanceof ConfigError) {
			console.error(`Canvas cannot start: ${error.message}`);
			process.exit(1);
		}
		throw error;
	}
};

const PATH_MAX = 200;

function appLog(): Logger {
	try {
		return getApp().log;
	} catch {
		return createLogger();
	}
}

/** One plain line instead of SvelteKit's coloured one with a stack trace. */
export const handleError: HandleServerError = ({ error, event, status }) => {
	// Anyone on the network could fill the log with unknown paths.
	if (status === 404) return { message: 'error' };
	const fields = {
		status,
		method: event.request.method,
		path: event.url.pathname.slice(0, PATH_MAX)
	};
	const log = appLog();
	if (status < 500) {
		log.warn('request failed', fields);
	} else {
		log.error('request failed', {
			...fields,
			reason: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? (error.stack ?? null) : null
		});
	}
	return { message: 'error' };
};
