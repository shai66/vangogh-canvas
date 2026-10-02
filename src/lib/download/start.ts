import type { FileEntry } from '$lib/types';

export type Checked = 'ok' | 'missing' | 'unreachable';

/** What starting downloads needs from the browser. Tests hand in their own. */
export interface Starter {
	/** Asks Canvas whether the file can be fetched, without fetching it. */
	check(url: string): Promise<Checked>;
	/** Makes the browser download the file. */
	trigger(url: string): void;
	wait(ms: number): Promise<void>;
}

export interface StartResult {
	/** The ids of the files whose download was started. */
	started: string[];
	/** The ids of the files that are missing in the archive. */
	missing: string[];
	/** True when the archive could not be reached. Nothing after that file was tried. */
	unreachable: boolean;
}

export function downloadUrl(gameId: string, fileId: string): string {
	return `/download/${encodeURIComponent(gameId)}/${encodeURIComponent(fileId)}`;
}

/** Between two downloads. Browsers drop downloads that start in the same moment. */
export const GAP_MS = 700;

/**
 * Starts the files one after another. A file that is missing in the archive
 * is skipped and the rest goes on. When the archive cannot be reached it
 * stops: every further file would fail the same way.
 */
export async function startDownloads(
	gameId: string,
	files: Pick<FileEntry, 'fileId'>[],
	io: Starter,
	gapMs = GAP_MS
): Promise<StartResult> {
	const result: StartResult = { started: [], missing: [], unreachable: false };
	for (const file of files) {
		const url = downloadUrl(gameId, file.fileId);
		const checked = await io.check(url);
		if (checked === 'unreachable') {
			result.unreachable = true;
			break;
		}
		if (checked === 'missing') {
			result.missing.push(file.fileId);
			continue;
		}
		if (result.started.length > 0) await io.wait(gapMs);
		io.trigger(url);
		result.started.push(file.fileId);
	}
	return result;
}

/** The real thing. Only runs in a browser. */
export const browserStarter: Starter = {
	async check(url) {
		try {
			const answer = await fetch(url, { method: 'HEAD', cache: 'no-store' });
			if (answer.ok) return 'ok';
			return answer.status === 404 ? 'missing' : 'unreachable';
		} catch {
			return 'unreachable';
		}
	},
	trigger(url) {
		// The answer is an attachment, so the page stays where it is.
		const link = document.createElement('a');
		link.href = url;
		link.download = '';
		link.hidden = true;
		document.body.append(link);
		link.click();
		link.remove();
	},
	wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
};
