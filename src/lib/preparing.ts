/**
 * What the page says while Canvas has no library yet (0.10.2): it is reading the archive, vangogh refused
 * the login, or the last reading failed for another reason (vangogh did not answer, or answered an error).
 */
export type PreparingState = 'reading' | 'refused' | 'unreadable';

export function preparingState(
	rebuild: { running: boolean; lastResult: 'never' | 'ok' | 'failed' },
	login: 'unknown' | 'ok' | 'rejected'
): PreparingState {
	if (rebuild.running) return 'reading';
	if (login === 'rejected') return 'refused';
	return rebuild.lastResult === 'failed' ? 'unreadable' : 'reading';
}
