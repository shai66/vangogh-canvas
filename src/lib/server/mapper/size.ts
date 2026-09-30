const UNITS: Record<string, number> = {
	b: 1,
	kb: 1024,
	mb: 1024 ** 2,
	gb: 1024 ** 3,
	tb: 1024 ** 4
};

/** Bytes in a size such as "2.5 GB". 0 when it cannot be read. */
export function parseSize(text: unknown): number {
	if (typeof text !== 'string') return 0;
	const match = /^\s*(\d+(?:[.,]\d+)?)\s*([kmgt]?b)\s*$/i.exec(text);
	if (!match) return 0;
	return Math.round(Number(match[1].replace(',', '.')) * UNITS[match[2].toLowerCase()]);
}
