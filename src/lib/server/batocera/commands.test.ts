import { describe, expect, it } from 'vitest';
import { bytesCommand, filesCommand, macFor, parseDf, parseFiles, parseKib, parsePrimary, parseVersion, removeCommand, removeInPartCommand, supportCommand, unpackCommand } from './commands';

const IP = [
	'1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever preferred_lft forever',
	'2: eth0    inet 10.0.0.21/24 brd 10.0.0.255 scope global eth0\\       valid_lft forever preferred_lft forever',
	'3: wlan0    inet 10.0.0.22/24 brd 10.0.0.255 scope global wlan0\\       valid_lft forever preferred_lft forever',
	'1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\\    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00',
	'2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP mode DEFAULT group default qlen 1000\\    link/ether 02:00:00:aa:bb:cc brd ff:ff:ff:ff:ff:ff',
	'3: wlan0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP mode DORMANT group default qlen 1000\\    link/ether 02:00:00:aa:bb:dd brd ff:ff:ff:ff:ff:ff',
	''
].join('\n');

describe('removeCommand', () => {
	it("builds the remove command only for Canvas's folders", () => {
		expect(removeCommand('/userdata/roms/windows/Night Harbour.pc.part')).toBe("rm -rf -- '/userdata/roms/windows/Night Harbour.pc.part'");
		expect(removeCommand('/userdata/roms/windows/Night Harbour.pc.old')).toBe("rm -rf -- '/userdata/roms/windows/Night Harbour.pc.old'");
		expect(removeCommand('/userdata/roms/dos/Cellar Quest.pc')).toBe("rm -rf -- '/userdata/roms/dos/Cellar Quest.pc'");
		expect(removeCommand('/userdata/roms/dos/.canvas-probe')).toBe("rm -rf -- '/userdata/roms/dos/.canvas-probe'");
		for (const path of [
			'/userdata/roms/windows',
			'/userdata/roms/windows/',
			'/userdata',
			'/userdata/roms/snes/x.pc',
			'/userdata/roms/snes/.canvas-probe',
			'/userdata/roms/windows/x.txt',
			'/userdata/roms/windows/.pc',
			'/userdata/roms/windows/../x.pc',
			'/userdata/roms/windows/a/b.pc',
			'/userdata/roms/windows/a\nb.pc',
			'roms/windows/x.pc'
		]) {
			expect(() => removeCommand(path), path).toThrow();
		}
	});

	it('quotes a folder whose name holds a quote', () => {
		expect(removeCommand("/userdata/roms/windows/it's.pc")).toBe("rm -rf -- '/userdata/roms/windows/it'\\''s.pc'");
	});
});

describe('the commands of the unpacking', () => {
	const PART = "/userdata/roms/windows/Night Harbour's.pc.part";
	const Q = "'/userdata/roms/windows/Night Harbour'\\''s.pc.part'";
	it('builds the commands of the unpacking, quoted for the shell', () => {
		expect(unpackCommand(`${PART}/.canvas-installers/setup it's.exe`, PART)).toBe(
			`innoextract --silent --exclude-temp --output-dir ${Q} '/userdata/roms/windows/Night Harbour'\\''s.pc.part/.canvas-installers/setup it'\\''s.exe'`
		);
		expect(bytesCommand(PART)).toBe(`du -sk -- ${Q}`);
		expect(filesCommand(PART)).toBe(`find ${Q} -type f`);
		expect(removeInPartCommand(PART, '.canvas-installers')).toBe(`rm -rf -- '/userdata/roms/windows/Night Harbour'\\''s.pc.part/.canvas-installers'`);
	});
	it.each([
		['/userdata/roms/windows/Night Harbour.pc', 'a finished folder'],
		['/userdata/system/Night Harbour.pc.part', 'outside the systems'],
		['/userdata/roms/windows/.pc.part', 'a name of the suffix alone']
	])('refuses %s (%s)', (part) => {
		expect(() => bytesCommand(part)).toThrow('not a folder of Canvas');
		expect(() => supportCommand(part)).toThrow('not a folder of Canvas');
	});
	it('refuses an installer outside the installers folder, and a child that is not one name', () => {
		expect(() => unpackCommand(`${PART}/setup.exe`, PART)).toThrow('not a folder of Canvas');
		for (const child of ['', '.', '..', 'a/b', 'a\nb']) expect(() => removeInPartCommand(PART, child)).toThrow('not a folder of Canvas');
	});
	it("reads du's KiB and find's files", () => {
		expect(parseKib(`2048\t${PART}\n`)).toBe(2048 * 1024);
		expect(() => parseKib('du: no such file\n')).toThrow('unreadable du output');
		expect(parseFiles(`${PART}/b.exe\n${PART}/DATA/a.dat\n${PART}/canvas.json\n`, PART)).toEqual(['DATA/a.dat', 'b.exe', 'canvas.json']);
	});
});

describe('parseDf', () => {
	it('reads df', () => {
		const out = 'Filesystem     1024-blocks      Used Available Capacity Mounted on\n/dev/sda2       460000000  60000000 400000000      14% /userdata\n';
		expect(parseDf(out)).toBe(409600000000);
		expect(() => parseDf('')).toThrow();
		expect(() => parseDf('df: /userdata: No such file or directory\n')).toThrow();
	});
});

describe('parseVersion', () => {
	it('reads the version', () => {
		expect(parseVersion('43.1 2026/05/29 00:00\n')).toBe('43.1');
		expect(() => parseVersion('\n')).toThrow();
	});
});

describe('macFor', () => {
	it('finds the MAC of the interface with the address', () => {
		expect(macFor(IP, '10.0.0.21')).toBe('02:00:00:aa:bb:cc');
		expect(macFor(IP, '10.0.0.22')).toBe('02:00:00:aa:bb:dd');
		// A name, or an address the box reaches only through lo: the first card that is up.
		expect(macFor(IP, 'batocera.home')).toBe('02:00:00:aa:bb:cc');
		expect(macFor(IP, '127.0.0.1')).toBe('02:00:00:aa:bb:cc');
		const eth0Down = IP.replace('<BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP mode DEFAULT', '<BROADCAST,MULTICAST> mtu 1500 qdisc mq state DOWN mode DEFAULT');
		expect(macFor(eth0Down, 'batocera.home')).toBe('02:00:00:aa:bb:dd');
		expect(macFor('', '10.0.0.21')).toBeNull();
	});
});

describe('parsePrimary', () => {
	it('reads the primary output', () => {
		expect(parsePrimary('HDMI-1\n')).toBe('HDMI-1');
		expect(parsePrimary('\n  DP-2  \n')).toBe('DP-2');
		expect(parsePrimary('')).toBeNull();
	});
});
