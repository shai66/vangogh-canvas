// Safe access to JSON of unknown shape. vangogh's records are never trusted
// to have a field.

export function obj(x: unknown): Record<string, unknown> {
	return x !== null && typeof x === 'object' && !Array.isArray(x)
		? (x as Record<string, unknown>)
		: {};
}

export function arr(x: unknown): unknown[] {
	return Array.isArray(x) ? x : [];
}

export function str(x: unknown): string {
	return typeof x === 'string' ? x.trim() : '';
}

export function unique<T>(items: T[]): T[] {
	return [...new Set(items)];
}

/** The `name` of every object in a list. */
export function names(x: unknown): string[] {
	return unique(
		arr(x)
			.map((item) => str(obj(item).name))
			.filter(Boolean)
	);
}
