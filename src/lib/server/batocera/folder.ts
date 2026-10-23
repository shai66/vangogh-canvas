/**
 * What Canvas puts into a game's folder on the box: its name, the program to start
 * (`autorun.cmd`), the DOS start commands (`dosbox.bat`) and the marker. All pure.
 */

export const MARKER = 'canvas.json';

/** The title as a folder name (spec 2.2); the id when nothing is left. */
export function folderName(title: string, id: string): string {
	const name = title
		// eslint-disable-next-line no-control-regex
		.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '')
		.replace(/\s+/g, ' ')
		.replace(/^[. ]+|[. ]+$/g, '');
	return name || id;
}

export interface PlayTask {
	category?: string;
	isPrimary?: boolean;
	isHidden?: boolean;
	type?: string;
	path?: string;
	workingDir?: string;
	arguments?: string;
}

/** The program of a game from its `goggame-<id>.info` (spec 2.3). */
export function chooseTask(info: unknown): PlayTask | null {
	if (typeof info !== 'object' || info === null) return null;
	const tasks = (info as { playTasks?: unknown }).playTasks;
	if (!Array.isArray(tasks)) return null;
	const programs = tasks.filter(
		(t): t is PlayTask => typeof t === 'object' && t !== null && t.type === 'FileTask' && typeof t.path === 'string' && /\.exe$/i.test(t.path)
	);
	return (
		programs.find((t) => t.isHidden === true && t.category === 'game') ??
		programs.find((t) => t.isPrimary === true) ??
		programs.find((t) => t.category === 'game') ??
		null
	);
}

/** A GOG path ("bin\Game.exe", "..\x") as clean parts, resolved against a folder. */
function resolve(path: string, from = ''): string[] {
	const out: string[] = [];
	for (const part of `${from}/${path}`.split(/[\\/]+/)) {
		if (part === '' || part === '.') continue;
		if (part === '..') out.pop();
		else out.push(part);
	}
	return out;
}

/** The file as it is named on disk, whatever the case GOG wrote; null when it is not among the files. */
function onDisk(files: string[], parts: string[]): string | null {
	const want = parts.join('/').toLowerCase();
	return files.find((f) => f.toLowerCase() === want) ?? null;
}

/** The two lines of `autorun.cmd`, or null when the program is not among the files. */
export function autorunCmd(task: PlayTask, files: string[]): string | null {
	const program = onDisk(files, resolve(task.path ?? ''));
	if (!program) return null;
	const programParts = program.split('/');
	let dirParts = programParts.slice(0, -1);
	if (task.workingDir) {
		// A given working folder counts, even the root of the files (then no DIR).
		const given = resolve(task.workingDir);
		// Take the folder's name from the files when there is one, so the case is the files'.
		const want = given.join('/').toLowerCase();
		const folder = files.map((f) => f.split('/').slice(0, -1)).find((d) => d.length >= given.length && d.slice(0, given.length).join('/').toLowerCase() === want);
		dirParts = given.length === 0 ? [] : folder ? folder.slice(0, given.length) : given;
	}
	let common = 0;
	while (common < dirParts.length && common < programParts.length - 1 && dirParts[common].toLowerCase() === programParts[common].toLowerCase()) common++;
	const relative = [...dirParts.slice(common).map(() => '..'), ...programParts.slice(common)].join('/');
	const args = task.arguments ? ` ${task.arguments}` : '';
	const dir = dirParts.length > 0 ? `DIR=${dirParts.join('/')}\n` : '';
	return `${dir}CMD="${relative}"${args}\n`;
}

/** A folder as it is named on disk, whatever the case GOG wrote; null when no file is under it. */
function folderOnDisk(files: string[], parts: string[]): string[] | null {
	const want = `${parts.join('/').toLowerCase()}/`;
	const file = files.find((f) => f.toLowerCase().startsWith(want));
	return file ? file.split('/').slice(0, parts.length) : null;
}

/** The lines of the `[autoexec]` section of a DOSBox configuration, without comments. */
function autoexec(text: string): string[] {
	const lines: string[] = [];
	let inside = false;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (/^\[.*\]$/.test(line)) {
			inside = line.toLowerCase() === '[autoexec]';
			continue;
		}
		if (inside && line !== '' && !line.startsWith('#')) lines.push(line);
	}
	return lines;
}

/** The name of a label line (":game" is "game"), in lower case; null for any other line. */
function label(line: string): string | null {
	return /^:([^:\s]\S*)/.exec(line)?.[1].toLowerCase() ?? null;
}

/**
 * GOG's launcher of one game (a menu of the game, its setup and exit) as the game's own start
 * (spec 2.4): the lines before the menu, then the game's block without `cls`; null for any other lines.
 */
function launcherOfOne(lines: string[]): string[] | null {
	const labels = lines.map(label);
	const names = labels.filter((name) => name !== null);
	if (!names.includes('launcher') || !names.includes('game')) return null;
	if (!names.every((name) => ['launcher', 'game', 'setup', 'exit'].includes(name))) return null;
	const block = (name: string) => {
		const rest = lines.slice(labels.indexOf(name) + 1);
		const end = rest.findIndex((line) => label(line) !== null);
		return end === -1 ? rest : rest.slice(0, end);
	};
	const menu = block('launcher');
	if (!menu.some((line) => /^@?choice\b/i.test(line))) return null;
	if (!menu.some((line) => /^if\s+errorlevel\s+1\s+goto\s+game$/i.test(line))) return null;
	const before = lines.findIndex((line) => label(line) !== null || /^goto\s+launcher$/i.test(line));
	const game = block('game');
	const end = game.findIndex((line) => /^goto\s/i.test(line));
	const commands = (end === -1 ? game : game.slice(0, end)).filter((line) => !/^@?cls$/i.test(line));
	if (commands.length === 0) return null;
	const out = [...lines.slice(0, before), ...commands];
	// A `goto` left over would jump to a label that is gone, and DOSBox would end the batch there.
	return out.some((line) => /^@?goto\b/i.test(line)) ? null : out;
}

/** The start commands of a DOS game (spec 2.4), with CRLF ends; null when no line is left. */
export function dosboxBat(task: PlayTask, files: string[], read: (file: string) => string | null): string | null {
	const from = (task.workingDir ?? '').replace(/\\/g, '/');
	const lines: string[] = [];
	for (const match of (task.arguments ?? '').matchAll(/-conf\s+(?:"([^"]*)"|(\S+))/gi)) {
		const file = onDisk(files, resolve(match[1] ?? match[2], from));
		const text = file === null ? null : read(file);
		if (text !== null) lines.push(...autoexec(text));
	}
	// GOG's launcher of one game waits for a key on the TV: the game's own commands start instead.
	const kept = launcherOfOne(lines) ?? lines;
	// GOG's menu of several games (labels, `goto`) ends each game with `exit`: there it stays.
	const menu = kept.some((line) => /^:[^:\s]/.test(line));
	const out: string[] = [];
	for (const line of kept) {
		if (/^@?echo\s+off$/i.test(line) || (!menu && /^exit$/i.test(line))) continue;
		// GOG's overlay for saves in the cloud: without it the saves stay in the game's folder.
		if (/^mount\s.*\s-t\s+overlay\b/i.test(line)) continue;
		// DOSBox Pure mounts the game's folder as C:, so GOG's mount of a sub-folder as C becomes a `cd` into it.
		const drive = /^mount\s+c\s+(?:"([^"]*)"|(\S+))/i.exec(line);
		if (drive) {
			const parts = resolve(drive[1] ?? drive[2], from);
			if (parts.length > 0) out.push('C:', `cd \\${(folderOnDisk(files, parts) ?? parts).join('\\')}`);
			continue;
		}
		const image = /^(imgmount\s+\S+\s+)(?:"([^"]*)"|(\S+))(.*)$/i.exec(line);
		if (image) {
			const parts = resolve(image[2] ?? image[3], from);
			const found = onDisk(files, parts);
			const path = (found ?? parts.join('/')).replace(/\//g, '\\');
			out.push(`${image[1]}"C:\\${path}"${image[4]}`);
		} else out.push(line);
	}
	return out.length > 0 ? out.map((l) => `${l}\r\n`).join('') : null;
}

export interface Marker {
	gameId: string;
	system: 'windows' | 'dos';
	files: string[];
	version: string;
	sentAt: string;
	canvas: string;
}

export function markerJson(m: Marker): string {
	return `${JSON.stringify(m, null, 2)}\n`;
}

/** The marker read back; null when the text is not a marker (not JSON, or no game id). */
export function parseMarker(text: string): Marker | null {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const m = value as Record<string, unknown>;
	if (typeof m.gameId !== 'string' || m.gameId === '') return null;
	if (m.system !== 'windows' && m.system !== 'dos') return null;
	if (!Array.isArray(m.files) || !m.files.every((f) => typeof f === 'string')) return null;
	if (typeof m.version !== 'string' || typeof m.sentAt !== 'string' || typeof m.canvas !== 'string') return null;
	return { gameId: m.gameId, system: m.system, files: m.files, version: m.version, sentAt: m.sentAt, canvas: m.canvas };
}
