/** What an image id may look like. Also guards the /img route. */
export const IMAGE_ID = /^[A-Za-z0-9]{16,128}$/;

/**
 * The image id inside one of GOG's image addresses: the last path segment,
 * without its extension and without a trailing `{formatter}`.
 */
export function imageIdFromUrl(url: string | null | undefined): string | undefined {
	if (!url) return undefined;
	let last: string;
	try {
		last = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() ?? '');
	} catch {
		return undefined;
	}
	const id = last.replace(/\.[A-Za-z0-9]+$/, '').replace(/_?\{formatter\}$/, '');
	return IMAGE_ID.test(id) ? id : undefined;
}
