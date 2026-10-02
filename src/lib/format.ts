const MB = 1024 ** 2;
const GB = 1024 ** 3;

/** A size for people: "38 GB", "2.5 GB", "512 MB". */
export function formatSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
	if (bytes >= GB) {
		const gb = bytes / GB;
		return `${gb >= 10 ? Math.round(gb) : Math.round(gb * 10) / 10} GB`;
	}
	const mb = Math.max(1, Math.round(bytes / MB));
	// Just under a gigabyte rounds up to one.
	return mb >= 1024 ? '1 GB' : `${mb} MB`;
}

/** A text that starts with a capital letter. GOG writes many names in lower case: "manual". */
export function upperFirst(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}
