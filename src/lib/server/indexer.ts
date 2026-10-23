import { createHash } from 'node:crypto';
import { byKind } from '../extras';
import {
	ALL_OS,
	type Detail,
	type DlcDetail,
	type Downloads,
	type ExtraFile,
	type Kind,
	type ListEntry
} from '../types';
import { collect, type Member, type PackRecord } from './collections';
import { INDEX_SCHEMA, type FileTarget, type Index } from './index-types';
import type { Logger } from './log';
import { mapDetails, type MappedDetails, type MappedDownloads, type MappedExtra } from './mapper/downloads';
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
	/** The extras on disk, each with the name of its file. */
	extras: PresentExtra[];
	/** True when vangogh could not say which extras are on disk. */
	extrasFailed: boolean;
}

interface PresentExtra extends MappedExtra {
	filename: string;
}

/** The extras that are on disk. vangogh's file names never list them, so it is asked about each, one after another. */
async function presentExtras(source: VangoghSource, productId: string, extras: MappedExtra[]): Promise<PresentExtra[]> {
	const present: PresentExtra[] = [];
	for (const extra of extras) {
		const filename = await source.fileOnDisk({ productId, downloadType: 'extra', manualUrl: extra.manualUrl });
		if (filename !== null) present.push({ ...extra, filename });
	}
	return present;
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
		const details = detailsRaw === null ? null : mapDetails(detailsRaw);
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
		// Only a product that offers installers is listed, so only its extras are asked about.
		let extras: PresentExtra[] = [];
		let extrasFailed = false;
		if (details?.offersInstallers) {
			try {
				extras = await presentExtras(source, library.id, details.extras);
			} catch (error) {
				if (error instanceof VangoghAuthError) throw error;
				extrasFailed = true;
				log.warn('extras not available', { id: library.id, reason: reason(error) });
			}
		}
		return {
			library,
			product: productRaw === null ? null : mapApiProduct(productRaw),
			details,
			filenames,
			error: null,
			filenamesFailed,
			extras,
			extrasFailed
		};
	} catch (error) {
		if (error instanceof VangoghAuthError) throw error;
		return {
			library,
			product: null,
			details: null,
			filenames: {},
			error: reason(error),
			filenamesFailed: false,
			extras: [],
			extrasFailed: false
		};
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

/** The extras on disk as the index holds them, in the panel's order, each with its place in vangogh. */
function toExtras(extras: PresentExtra[], productId: string, targets: Record<string, FileTarget>): ExtraFile[] {
	return extras
		.map((e) => {
			const id = fileId(e.manualUrl);
			targets[`${productId}/${id}`] = { productId, downloadType: 'extra', manualUrl: e.manualUrl, filename: basename(e.filename) };
			return { fileId: id, name: e.name, kind: e.kind, sizeText: e.sizeText, sizeBytes: e.sizeBytes };
		})
		.sort(byKind);
}

function offersFiles(downloads: Downloads, dlc: DlcDetail[]): boolean {
	return [downloads, ...dlc.map((d) => d.downloads)].some((d) => Object.keys(d).length > 0);
}

/**
 * Whether a record counts as not read for the threshold that fails a rebuild.
 * A product without a product record does. So does one whose extras vangogh
 * could not say about, and one whose file names could not be fetched, unless
 * its details offer no installer: it is left out, and no file name could matter for it.
 */
function countsAsFailed(g: Gathered): boolean {
	if (g.product === null) return true;
	if (g.extrasFailed) return true;
	return g.filenamesFailed && !(g.details !== null && !g.details.offersInstallers);
}

/** What one read of a pack's record gave. */
interface PackRead {
	id: string;
	product: MappedProduct | null;
	/** True when vangogh failed to answer, not when it has no such record. */
	failed: boolean;
}

/**
 * The records of the packs the entries name: spec, section 4.2. A pack of the library list was
 * read with it and is not read again. A pack that is not found, is of another type or has no
 * name is left out. One that vangogh fails to give is left out with a warning, and when that
 * happens to more than half of them the rebuild fails, as for the games' records. A refused
 * login stops the rebuild.
 */
async function readPacks(source: VangoghSource, gathered: Gathered[], named: Set<string>, log: Logger): Promise<PackRecord[]> {
	const record = (id: string, name: string, product: MappedProduct): PackRecord => ({
		id,
		name,
		poster: product.poster,
		storeUrl: product.storeUrl,
		series: product.series,
		includes: product.includes.map((r) => r.id)
	});
	const packs: PackRecord[] = [];
	const inLibrary = new Set<string>();
	for (const g of gathered) {
		if (g.product?.productType !== 'PACK') continue;
		inLibrary.add(g.library.id);
		packs.push(record(g.library.id, g.product.title ?? g.library.title, g.product));
	}

	const read = await mapLimit(
		[...named].filter((id) => !inLibrary.has(id)),
		CONCURRENCY,
		async (id): Promise<PackRead> => {
			try {
				const raw = await source.metadata('gog-api-products', id);
				return { id, product: raw === null ? null : mapApiProduct(raw), failed: false };
			} catch (error) {
				if (error instanceof VangoghAuthError) throw error;
				log.warn('pack not available', { id, reason: reason(error) });
				return { id, product: null, failed: true };
			}
		}
	);
	const failed = read.filter((r) => r.failed).length;
	if (failed * 2 > read.length) throw new RebuildFailed(`${failed} of ${read.length} packs could not be read`);

	let leftOut = failed;
	for (const { id, product, failed: lost } of read) {
		if (lost) continue;
		if (product === null) {
			leftOut++;
			log.info('pack left out of the collections', { id, reason: 'not found' });
			continue;
		}
		if (product.productType !== 'PACK' || product.title === null) {
			leftOut++;
			log.info('pack left out of the collections', { id, reason: product.productType !== 'PACK' ? 'not a pack' : 'no name' });
			continue;
		}
		packs.push(record(id, product.title, product));
	}
	log.info('packs read', { read: read.length, leftOut });
	return packs;
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

	const entries: ListEntry[] = [];
	const details: Record<string, Detail> = {};
	const files: Record<string, FileTarget> = {};
	/** The entries as the rules of collections see them, and the packs they name. */
	const members: Member[] = [];
	const named = new Set<string>();

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
		const extras = toExtras(g.extras, id, targets);

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
			releaseYear: product?.releaseYear ?? null,
			dlc: dlc.map((d) => d.title),
			extraKinds: extras.map((e) => e.kind),
			order,
			complete: product !== null,
			hasFiles: offersFiles(downloads, dlc),
			// Worked out with the collections, once every entry is known.
			collection: null,
			series: null,
			packs: [],
			adult: product?.adult ?? false
		};
		members.push({ id, title, releaseYear: entry.releaseYear, storeUrl: product?.storeUrl ?? null, series: product?.series ?? null });
		for (const pack of product?.includedIn ?? []) named.add(pack.id);

		const { dlc: _titles, ...shared } = entry;
		entries.push(entry);
		details[id] = {
			...shared,
			description: product?.description ?? '',
			languages: product?.languages ?? [],
			features: product?.features ?? [],
			screenshots: product?.screenshots ?? [],
			backdrop: product?.backdrop ?? null,
			macNotice: product?.macNotice ?? null,
			dos: product?.dos ?? false,
			requirements: product?.requirements ?? {},
			storeUrl: product?.storeUrl ?? null,
			rating: product?.rating ?? null,
			downloads,
			downloadLanguage: g.details?.downloads.language ?? null,
			dlc,
			extras,
			requires
		};
		Object.assign(files, targets);
	});

	const { collections, of } = collect(members, await readPacks(source, gathered, named, log));
	for (const entry of entries) {
		const groups = of.get(entry.id);
		if (!groups) continue;
		Object.assign(entry, groups);
		Object.assign(details[entry.id], groups);
	}

	const version = createHash('sha256')
		.update(JSON.stringify([INDEX_SCHEMA, entries, details, collections]))
		.digest('hex')
		.slice(0, 16);

	return { schema: INDEX_SCHEMA, builtAt: now().toISOString(), version, entries, details, files, collections };
}
