import { createHash } from 'node:crypto';
import { ALL_OS, type Detail, type DlcDetail, type Downloads, type Kind, type ListEntry } from '../types';
import { INDEX_SCHEMA, type FileTarget, type Index } from './index-types';
import type { Logger } from './log';
import { mapDetails, type MappedDetails, type MappedDownloads } from './mapper/downloads';
import { mapLibrary, type LibraryProduct } from './mapper/library';
import { mapApiProduct, type MappedProduct } from './mapper/product';
import { mapLimit } from './util';
import {
	VangoghAuthError,
	VangoghHttpError,
	type DownloadType,
	type VangoghSource
} from './vangogh/client';

/** The rebuild could not produce an index worth serving. */
export class RebuildFailed extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'RebuildFailed';
	}
}

const CONCURRENCY = 4;

interface Gathered {
	library: LibraryProduct;
	product: MappedProduct | null;
	details: MappedDetails | null;
	filenames: Record<string, string>;
	/** Why the records could not be read, or null. */
	error: string | null;
	/** True when file names call threw VangoghHttpError for a product with gog-details. */
	filenamesFailed: boolean;
}

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function sameTitle(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function basename(path: string): string {
	return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** The id Canvas gives a file. Stable while the address in vangogh is. */
export function fileId(manualUrl: string): string {
	return createHash('sha256').update(manualUrl).digest('hex').slice(0, 16);
}

async function gather(
	source: VangoghSource,
	library: LibraryProduct,
	log: Logger
): Promise<Gathered> {
	try {
		const productRaw = await source.metadata('gog-api-products', library.id);
		const detailsRaw = await source.metadata('gog-details', library.id);
		let filenames: Record<string, string> = {};
		let filenamesFailed = false;
		// vangogh answers 500 for file names of a product without details.
		if (detailsRaw !== null) {
			try {
				filenames = await source.filenames(library.id);
			} catch (error) {
				if (!(error instanceof VangoghHttpError)) throw error;
				filenamesFailed = true;
				log.warn('file names not available', { id: library.id, status: error.status });
			}
		}
		return {
			library,
			product: productRaw === null ? null : mapApiProduct(productRaw),
			details: detailsRaw === null ? null : mapDetails(detailsRaw),
			filenames,
			error: null,
			filenamesFailed
		};
	} catch (error) {
		if (error instanceof VangoghAuthError) throw error;
		return { library, product: null, details: null, filenames: {}, error: reason(error), filenamesFailed: false };
	}
}

/** The files of one download list that exist in the archive. */
function toDownloads(
	downloads: MappedDownloads,
	filenames: Record<string, string>,
	productId: string,
	downloadType: DownloadType,
	targets: Record<string, FileTarget>
): Downloads {
	const out: Downloads = {};
	// The addresses come from vangogh: one like `constructor` must not find a property.
	const nameOf = (manualUrl: string): string =>
		Object.hasOwn(filenames, manualUrl) && typeof filenames[manualUrl] === 'string'
			? filenames[manualUrl]
			: '';
	for (const os of ALL_OS) {
		const present = (downloads.byOs[os] ?? []).filter((f) => nameOf(f.manualUrl) !== '');
		if (present.length === 0) continue;
		out[os] = present.map((f, position) => {
			const id = fileId(f.manualUrl);
			const filename = basename(nameOf(f.manualUrl));
			targets[`${productId}/${id}`] = {
				productId,
				downloadType,
				manualUrl: f.manualUrl,
				filename
			};
			return {
				fileId: id,
				name: f.name || filename,
				filename,
				version: f.version,
				sizeText: f.sizeText,
				sizeBytes: f.sizeBytes,
				run: position === 0
			};
		});
	}
	return out;
}

function offersFiles(downloads: Downloads, dlc: DlcDetail[]): boolean {
	return [downloads, ...dlc.map((d) => d.downloads)].some((d) => Object.keys(d).length > 0);
}

/**
 * Whether a record counts as not read for the threshold that fails a rebuild.
 * A product without a product record does. So does one whose file names could
 * not be fetched, unless its details offer no installer: it is left out, and
 * no file name could matter for it.
 */
function countsAsFailed(g: Gathered): boolean {
	if (g.product === null) return true;
	return g.filenamesFailed && !(g.details !== null && !g.details.offersInstallers);
}

/** Builds the index. Spec section 4. */
export async function buildIndex(
	source: VangoghSource,
	log: Logger,
	now: () => Date = () => new Date()
): Promise<Index> {
	let library: LibraryProduct[];
	try {
		library = mapLibrary(await source.availableProducts());
	} catch (error) {
		if (error instanceof VangoghAuthError) throw error;
		throw new RebuildFailed(`the library list could not be read: ${reason(error)}`, {
			cause: error
		});
	}
	if (library.length === 0) throw new RebuildFailed('the library list is empty');

	const gathered = await mapLimit(library, CONCURRENCY, (product) => gather(source, product, log));

	// A missing product record counts too: an archive that answers 404 for
	// everything must not replace a good index with an empty one.
	const failed = gathered.filter(countsAsFailed);
	for (const g of failed) {
		if (g.error !== null) {
			log.warn('record skipped', { id: g.library.id, title: g.library.title, reason: g.error });
		}
	}
	// vangogh went away during the rebuild: keep the previous index.
	if (failed.length * 2 > gathered.length) {
		throw new RebuildFailed(`${failed.length} of ${gathered.length} records could not be read`);
	}
	for (const g of gathered) {
		if (g.error === null && g.product === null) {
			log.warn('record skipped', {
				id: g.library.id,
				title: g.library.title,
				reason: 'no metadata found'
			});
		}
	}

	const owned = new Set(library.map((p) => p.id));
	const packTitles = new Map<string, string>();
	const partOf = new Map<string, string[]>();
	for (const g of gathered) {
		if (g.product?.productType !== 'PACK') continue;
		const title = g.product.title ?? g.library.title;
		packTitles.set(g.library.id, title);
		for (const game of g.product.includes) {
			partOf.set(game.id, [...(partOf.get(game.id) ?? []), title]);
		}
	}

	const entries: ListEntry[] = [];
	const details: Record<string, Detail> = {};
	const files: Record<string, FileTarget> = {};

	gathered.forEach((g, order) => {
		const id = g.library.id;
		const product = g.product;
		const title = product?.title ?? g.library.title;
		const targets: Record<string, FileTarget> = {};

		const downloads = g.details
			? toDownloads(g.details.downloads, g.filenames, id, 'installer', targets)
			: {};
		const dlc: DlcDetail[] = (g.details?.dlcs ?? []).map((d) => ({
			title: d.title,
			downloads: toDownloads(d.downloads, g.filenames, id, 'downloadable-content', targets)
		}));
		for (const listed of g.library.dlc) {
			if (!dlc.some((d) => sameTitle(d.title, listed.title))) {
				dlc.push({ title: listed.title, downloads: {} });
			}
		}

		let kind: Kind = 'game';
		let requires: string | null = null;

		if (product?.productType === 'PACK') {
			if (!offersFiles(downloads, dlc)) {
				log.info('pack left out of the list', { id, title });
				return;
			}
			log.info('pack has files of its own and is listed', { id, title });
		}

		if (product?.productType === 'DLC') {
			const base = product.requires.find((r) => owned.has(r.id));
			if (base) {
				log.info('dlc is nested under its game', { id, title, game: base.id });
				return;
			}
			kind = 'orphaned-dlc';
			const needed = product.requires[0];
			requires = needed ? (needed.title ?? `GOG product ${needed.id}`) : null;
			log.info('orphaned dlc', { id, title, requires: product.requires.map((r) => r.id) });
		}

		if (
			kind === 'game' &&
			product !== null &&
			g.details !== null &&
			!g.details.offersInstallers
		) {
			log.info('product left out, gog offers no installer', { id, title });
			return;
		}

		const entry: ListEntry = {
			id,
			title,
			kind,
			os: g.library.os.length > 0 ? g.library.os : (product?.os ?? []),
			genres: product?.genres ?? [],
			tags: product?.tags ?? [],
			developers: product?.developers ?? [],
			publisher: product?.publisher ?? '',
			multiplayer: product?.multiplayer ?? false,
			coop: product?.coop ?? false,
			poster: product?.poster ?? null,
			banner: product?.banner ?? null,
			dlc: dlc.map((d) => d.title),
			order,
			complete: product !== null,
			hasFiles: offersFiles(downloads, dlc)
		};

		const packs = [
			...(partOf.get(id) ?? []),
			...(product?.includedIn ?? [])
				.map((r) => packTitles.get(r.id))
				.filter((t): t is string => t !== undefined)
		];

		const { dlc: _titles, ...shared } = entry;
		entries.push(entry);
		details[id] = {
			...shared,
			description: product?.description ?? '',
			languages: product?.languages ?? [],
			features: product?.features ?? [],
			screenshots: product?.screenshots ?? [],
			backdrop: product?.backdrop ?? null,
			releaseYear: product?.releaseYear ?? null,
			macNotice: product?.macNotice ?? null,
			downloads,
			downloadLanguage: g.details?.downloads.language ?? null,
			dlc,
			requires,
			partOf: [...new Set(packs)]
		};
		Object.assign(files, targets);
	});

	const version = createHash('sha256')
		.update(JSON.stringify([INDEX_SCHEMA, entries, details]))
		.digest('hex')
		.slice(0, 16);

	return { schema: INDEX_SCHEMA, builtAt: now().toISOString(), version, entries, details, files };
}
