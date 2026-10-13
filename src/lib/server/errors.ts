/**
 * The code of the network error behind a failed request, like ECONNREFUSED, or "timeout"
 * when the request was given up. Node's fetch keeps the real reason in `cause`.
 */
export function causeCode(error: unknown): string | null {
	if (!(error instanceof Error)) return null;
	if (error.name === 'TimeoutError') return 'timeout';
	let cause: unknown = error.cause;
	for (let depth = 0; depth < 3 && cause instanceof Error; depth++) {
		const code = (cause as { code?: unknown }).code;
		if (typeof code === 'string') return code;
		if (cause.name === 'TimeoutError') return 'timeout';
		cause = cause.cause;
	}
	return null;
}
