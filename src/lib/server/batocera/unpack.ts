import type { Box } from './box';
import { unpackCommand } from './commands';

/** The box's innoextract could not unpack an installer; `rar` when it needs RAR support, which that innoextract does not have (spec 3.3). */
export class UnpackError extends Error {
	readonly rar: boolean;
	constructor(message: string, rar: boolean) {
		super(message);
		this.name = 'UnpackError';
		this.rar = rar;
	}
}

/** How much of innoextract's output is kept for the log. */
const OUTPUT_LIMIT = 8192;

/**
 * Unpacks an installer of the part's installers folder into the part with the box's innoextract (spec 2.2). A
 * `.bin` part next to the installer is found by innoextract itself. Stopping ends it on the box.
 */
export async function unpackOnBox(box: Box, o: { installer: string; part: string; signal: AbortSignal }): Promise<void> {
	const { code, output } = await box.run(unpackCommand(o.installer, o.part), { signal: o.signal });
	if (code === 0) return;
	const said = output.trim().slice(0, OUTPUT_LIMIT);
	throw new UnpackError(said || `innoextract ended with ${code}`, /\b(un)?rar\b/i.test(said));
}
