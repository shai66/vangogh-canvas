import { NO_SERVER, serverInEffect, type ServerInEffect } from '../settings';
import { VERSION } from '../version';
import { Batocera } from './batocera/service';
import { loadConfig, type Config } from './config';
import { buildIndex } from './indexer';
import { createLogger, type Logger } from './log';
import { Rebuilder } from './rebuilder';
import { Scheduler } from './scheduler';
import { SettingsStore } from './settings';
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
	/** Created always; it runs only while the check is on. */
	updates: UpdateCheck;
	/** True while the update check runs: the stack's switch, or the sheet's once it was changed there. */
	updatesOn(): boolean;
	/** When the server started, as an ISO time. */
	startedAt: string;
	/** Null while no PIN is set: then the settings file is not read. */
	settings: SettingsStore | null;
	/** Null while settings are off: everything of Batocera needs them. */
	batocera: Batocera | null;
	/**
	 * Applies the Server settings in effect: moves the daily rebuild, and starts or stops the update check when its
	 * switch changed. At start, and after each save of the settings. Spec of the settings tabs, section 5.2.
	 */
	applyServer(): void;
}

/** The Server settings as the stack has them, its defaults included. */
export function stackServer(config: Config): ServerInEffect {
	return { rebuildAt: config.rebuildAt, timeZone: config.timeZone, versionCheck: config.versionCheck };
}

let current: App | null = null;
let onShutdown: (() => void) | null = null;

export function createApp(
	env: Record<string, string | undefined>,
	log: Logger = createLogger()
): App {
	const startedAt = new Date().toISOString();
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
	// Spec 0.10.0, section 7: the server asks GitHub for the latest release while the check is on.
	const updates = new UpdateCheck({ version: VERSION, url: config.versionCheckUrl, fetch: globalThis.fetch, log });
	// With the check off, a `VERSION_CHECK_URL` that is no address was replaced by GitHub's.
	const stackUrl = env.VERSION_CHECK_URL?.trim() ?? '';
	const urlReplaced = stackUrl !== '' && stackUrl !== config.versionCheckUrl;
	let checking = false;
	const settings = config.settingsPin ? new SettingsStore({ dir: config.settingsDir, log }) : null;
	const batocera = settings ? new Batocera({ config, settings, store, client, log }) : null;
	const app: App = {
		config,
		log,
		client,
		store,
		rebuilder,
		scheduler,
		updates,
		updatesOn: () => checking,
		startedAt,
		settings,
		batocera,
		applyServer() {
			const inEffect = serverInEffect(settings?.get().server ?? NO_SERVER, stackServer(config));
			scheduler.reschedule(inEffect.rebuildAt, inEffect.timeZone);
			// A save that leaves the switch as it was does not restart the check.
			if (inEffect.versionCheck === checking) return;
			checking = inEffect.versionCheck;
			if (checking) {
				if (urlReplaced) log.warn('VERSION_CHECK_URL is not an http or https address: the update check asks GitHub instead');
				updates.start();
			} else {
				updates.stop();
			}
		}
	};
	settings?.onSave(() => app.applyServer());
	return app;
}

/** Reads the configuration, loads the cache, and starts the rebuilds. */
export async function startApp(
	env: Record<string, string | undefined> = process.env
): Promise<App> {
	current?.scheduler.stop();
	current?.updates.stop();
	const app = createApp(env);
	const cached = await app.store.load();
	await app.settings?.load();
	await app.batocera?.start();
	// The values in effect: the sheet's where it changed them, else the stack's.
	const inEffect = serverInEffect(app.settings?.get().server ?? NO_SERVER, stackServer(app.config));
	app.log.info('canvas started', {
		version: VERSION,
		vangogh: app.config.vangoghUrl,
		rebuildAt: inEffect.rebuildAt,
		timeZone: inEffect.timeZone,
		cachedIndex: cached,
		versionCheck: inEffect.versionCheck,
		settings: app.settings !== null
	});
	app.scheduler.start();
	app.applyServer();
	// adapter-node emits this once it has closed the server after SIGTERM or SIGINT.
	// Without it the scheduler's timer keeps the process alive.
	if (onShutdown) process.off('sveltekit:shutdown', onShutdown);
	onShutdown = () => {
		app.scheduler.stop();
		app.updates.stop();
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
