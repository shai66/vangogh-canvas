import { VERSION } from '../version';
import { loadConfig, type Config } from './config';
import { buildIndex } from './indexer';
import { createLogger, type Logger } from './log';
import { Rebuilder } from './rebuilder';
import { Scheduler } from './scheduler';
import { IndexStore } from './store';
import { UpdateCheck } from './updates';
import { VangoghClient } from './vangogh/client';

export interface App {
	config: Config;
	log: Logger;
	client: VangoghClient;
	store: IndexStore;
	rebuilder: Rebuilder;
	scheduler: Scheduler;
	updates: UpdateCheck | null;
}

let current: App | null = null;
let onShutdown: (() => void) | null = null;

export function createApp(
	env: Record<string, string | undefined>,
	log: Logger = createLogger()
): App {
	const config = loadConfig(env);
	const client = new VangoghClient({
		url: config.vangoghUrl,
		username: config.username,
		password: config.password,
		log
	});
	const store = new IndexStore(config.cacheDir, log);
	const rebuilder = new Rebuilder({
		build: () => buildIndex(client, log),
		store,
		log,
		// A rebuild is the moment to try a rejected login once more.
		before: () => client.resetAuth()
	});
	const scheduler = new Scheduler({
		rebuilder,
		rebuildAt: config.rebuildAt,
		timeZone: config.timeZone,
		log
	});
	// Spec 0.10.0, section 7: the server asks GitHub for the latest release, unless switched off.
	const updates = config.versionCheck
		? new UpdateCheck({ version: VERSION, url: config.versionCheckUrl, fetch: globalThis.fetch, log })
		: null;
	return { config, log, client, store, rebuilder, scheduler, updates };
}

/** Reads the configuration, loads the cache, and starts the rebuilds. */
export async function startApp(
	env: Record<string, string | undefined> = process.env
): Promise<App> {
	current?.scheduler.stop();
	current?.updates?.stop();
	const app = createApp(env);
	const cached = await app.store.load();
	app.log.info('canvas started', {
		version: VERSION,
		vangogh: app.config.vangoghUrl,
		rebuildAt: app.config.rebuildAt,
		timeZone: app.config.timeZone,
		cachedIndex: cached,
		versionCheck: app.config.versionCheck
	});
	app.scheduler.start();
	app.updates?.start();
	// adapter-node emits this once it has closed the server after SIGTERM or SIGINT.
	// Without it the scheduler's timer keeps the process alive.
	if (onShutdown) process.off('sveltekit:shutdown', onShutdown);
	onShutdown = () => {
		app.scheduler.stop();
		app.updates?.stop();
		app.log.info('canvas stopped');
	};
	process.once('sveltekit:shutdown', onShutdown);
	current = app;
	return app;
}

export function getApp(): App {
	if (!current) throw new Error('the app has not been started');
	return current;
}
