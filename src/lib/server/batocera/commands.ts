/** The folders of the two systems Canvas sends to, and the box's data partition (spec 2.2). */
export const SYSTEM_DIR = { windows: '/userdata/roms/windows', dos: '/userdata/roms/dos' } as const;
export const USERDATA = '/userdata';

/** The only commands Canvas runs on the box, besides those the functions below build. */
export const COMMANDS = {
	df: 'df -Pk /userdata',
	version: 'batocera-version',
	ip: 'ip -o -4 addr show; ip -o link show',
	primary: 'DISPLAY=:0.0 xrandr --listPrimary',
	shutdown: 'batocera-es-swissknife --shutdown',
	innoextract: 'command -v innoextract'
} as const;

/** The exit code of `COMMANDS.shutdown` once it has started the shutdown: 43.1's batocera-es-swissknife ends with 11 then. */
export const SHUTTING_DOWN = 11;

export const PROBE = '.canvas-probe';
const SUFFIXES = ['.pc.part', '.pc.old', '.pc'];
/** The folder in a game's `.pc.part` folder that holds its installers while they are sent and unpacked (0.12.1). */
export const INSTALLERS = '.canvas-installers';
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** `text` as one word for the shell: in single quotes, each quote in it written `'\''`. */
export function shellQuote(text: string): string {
	return `'${text.replace(/'/g, "'\\''")}'`;
}

/** The name of `path` when it is directly in a system's folder and has no control character; else it throws. */
function nameInSystem(path: string): string {
	const at = path.lastIndexOf('/');
	const name = path.slice(at + 1);
	if (!(Object.values(SYSTEM_DIR) as string[]).includes(path.slice(0, at)) || CONTROL.test(name)) throw new Error('not a folder of Canvas');
	return name;
}

/**
 * `rm -rf` of one of Canvas's folders: a `.pc`, `.pc.part` or `.pc.old` folder in a system's
 * folder, or the probe of the connection test. Anything else throws. A quote in the name is
 * quoted for the shell, since a folder is named after the game's title (spec 2.2).
 */
export function removeCommand(path: string): string {
	const name = nameInSystem(path);
	if (name !== PROBE && !SUFFIXES.some((s) => name.endsWith(s) && name.length > s.length)) throw new Error('not a folder of Canvas');
	return `rm -rf -- ${shellQuote(path)}`;
}

/** Throws unless `part` is a `.pc.part` folder directly in a system's folder, the only place the commands below touch. */
function partGuard(part: string): void {
	const name = nameInSystem(part);
	if (!name.endsWith('.pc.part') || name === '.pc.part') throw new Error('not a folder of Canvas');
}

/** Throws unless `name` is one name in a folder: not empty, not `.` or `..`, without `/` or a control character. */
function nameGuard(name: string): void {
	if (name === '' || name === '.' || name === '..' || name.includes('/') || CONTROL.test(name)) throw new Error('not a folder of Canvas');
}

/** innoextract of an installer in the part's installers folder, unpacked into the part, with the options of 0.12.0 (spec 2.2). */
export function unpackCommand(installer: string, part: string): string {
	partGuard(part);
	const dir = `${part}/${INSTALLERS}/`;
	if (!installer.startsWith(dir)) throw new Error('not a folder of Canvas');
	nameGuard(installer.slice(dir.length));
	return `innoextract --silent --exclude-temp --output-dir ${shellQuote(part)} ${shellQuote(installer)}`;
}

/** The KiB a part takes on the box, which `parseKib` reads. */
export function bytesCommand(part: string): string {
	partGuard(part);
	return `du -sk -- ${shellQuote(part)}`;
}

/** The files in a part, which `parseFiles` reads. */
export function filesCommand(part: string): string {
	partGuard(part);
	return `find ${shellQuote(part)} -type f`;
}

/** GOG's `__support/app` copied over the part's root, when the installer has one (spec 2.2). */
export function supportCommand(part: string): string {
	partGuard(part);
	return `if [ -d ${shellQuote(`${part}/__support/app`)} ]; then cp -a ${shellQuote(`${part}/__support/app/.`)} ${shellQuote(`${part}/`)}; fi`;
}

/** `rm -rf` of one file or folder directly in a part, `child` being its name. */
export function removeInPartCommand(part: string, child: string): string {
	partGuard(part);
	nameGuard(child);
	return `rm -rf -- ${shellQuote(`${part}/${child}`)}`;
}

/** The free bytes of `df -Pk`: the fourth column of the last line, in KiB. */
export function parseDf(out: string): number {
	const last = out.trim().split('\n').pop() ?? '';
	const available = last.trim().split(/\s+/)[3] ?? '';
	if (!/^\d+$/.test(available)) throw new Error('unreadable df output');
	return Number(available) * 1024;
}

/** The bytes of `du -sk`: the first field of its first line, in KiB. */
export function parseKib(out: string): number {
	const kib = out.split('\n')[0].trim().split(/\s+/)[0] ?? '';
	if (!/^\d+$/.test(kib)) throw new Error('unreadable du output');
	return Number(kib) * 1024;
}

/** The files `find` lists under `part`, as paths relative to it with `/`, sorted; any other line is left out. */
export function parseFiles(out: string, part: string): string[] {
	const at = `${part}/`;
	return out
		.split('\n')
		.filter((line) => line.startsWith(at))
		.map((line) => line.slice(at.length))
		.sort();
}

/** Batocera's version: the first word of `batocera-version`. */
export function parseVersion(out: string): string {
	const word = out.trim().split(/\s+/)[0] ?? '';
	if (word === '') throw new Error('unreadable batocera-version output');
	return word;
}

interface Card {
	name: string;
	up: boolean;
	mac: string;
}

/**
 * The MAC of the network card that holds `address`, from `COMMANDS.ip`. For a host name, or an
 * address no card with a MAC holds (lo), the MAC of the first card that is up and not lo.
 */
export function macFor(out: string, address: string): string | null {
	const holders = new Map<string, string>();
	const cards: Card[] = [];
	for (const line of out.split('\n')) {
		const addr = /^\d+:\s+(\S+)\s+inet\s+(\d{1,3}(?:\.\d{1,3}){3})\//.exec(line);
		if (addr) {
			holders.set(addr[2], addr[1]);
			continue;
		}
		const link = /^\d+:\s+([^:\s@]+)(?:@[^:\s]+)?:\s+<([^>]*)>(.*)$/.exec(line);
		const mac = link && /link\/ether\s+([0-9a-f]{2}(?::[0-9a-f]{2}){5})/i.exec(link[3]);
		if (link && mac) {
			const up = link[2].split(',').includes('LOWER_UP') || /\bstate UP\b/.test(link[3]);
			cards.push({ name: link[1], up, mac: mac[1].toLowerCase() });
		}
	}
	const holder = holders.get(address);
	const card = cards.find((c) => c.name === holder) ?? cards.find((c) => c.up && c.name !== 'lo');
	return card?.mac ?? null;
}

/** The primary output of `xrandr --listPrimary`: its first line that is not empty. */
export function parsePrimary(out: string): string | null {
	return (
		out
			.split('\n')
			.map((line) => line.trim())
			.find((line) => line !== '') ?? null
	);
}
