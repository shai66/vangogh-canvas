import type { Os } from './types';

/**
 * What the visitor sits at. `phone` is a phone or a tablet: installers are
 * not meant for it. `other` is a system Canvas has no installers for.
 */
export type Visitor = Os | 'phone' | 'other';

/**
 * Reads the system from the browser's user agent. `touchPoints` is
 * `navigator.maxTouchPoints`: an iPad calls itself a Mac and is told apart
 * by its touch screen. The server does not know it and passes 0.
 */
export function detectVisitor(userAgent: string, touchPoints = 0): Visitor {
	if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return 'phone';
	if (/Macintosh|Mac OS X/i.test(userAgent)) return touchPoints > 1 ? 'phone' : 'macos';
	if (/Windows/i.test(userAgent)) return 'windows';
	if (/CrOS/i.test(userAgent)) return 'other';
	if (/Linux|X11/i.test(userAgent)) return 'linux';
	return 'other';
}
