const MB = 1024 ** 2;
const GB = 1024 ** 3;
const TB = 1024 ** 4;

/** Whole from 10 on, otherwise to a tenth: 38, 2.5. */
const tenths = (n: number): number => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);

/** A size for people: "1.2 TB", "38 GB", "2.5 GB", "512 MB". */
export function formatSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
	if (bytes >= TB) return `${tenths(bytes / TB)} TB`;
	if (bytes >= GB) {
		const gb = tenths(bytes / GB);
		// Just under a terabyte rounds up to one.
		return gb >= 1024 ? '1 TB' : `${gb} GB`;
	}
	const mb = Math.max(1, Math.round(bytes / MB));
	// Just under a gigabyte rounds up to one.
	return mb >= 1024 ? '1 GB' : `${mb} MB`;
}

/** A text that starts with a capital letter. GOG writes many names in lower case: "manual". */
export function upperFirst(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}
