import type { Detail, ListEntry } from '../types';
import type { DownloadType } from './vangogh/client';

/** Raised when the shape of the cached index changes. 5: the year in the list, the extras and the system requirements. */
export const INDEX_SCHEMA = 5;

/** Where a file is in vangogh. Never sent to the browser. */
export interface FileTarget {
	productId: string;
	downloadType: DownloadType;
	manualUrl: string;
	filename: string;
}

export interface Index {
	schema: typeof INDEX_SCHEMA;
	builtAt: string;
	version: string;
	entries: ListEntry[];
	details: Record<string, Detail>;
	/** Keyed by `<gameId>/<fileId>`. */
	files: Record<string, FileTarget>;
}
