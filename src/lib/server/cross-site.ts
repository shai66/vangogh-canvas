/** True when a browser sent the request from a page of another site. */
export function crossSite(request: Request, url: URL): boolean {
	const origin = request.headers.get('origin');
	if (origin !== null) {
		let host: string | null = null;
		try {
			host = new URL(origin).host;
		} catch {
			// "null" or anything else that is not an address.
		}
		if (host !== url.host) return true;
	}
	const site = request.headers.get('sec-fetch-site');
	return site !== null && site !== 'same-origin' && site !== 'none';
}
