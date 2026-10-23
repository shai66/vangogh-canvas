import { createSocket } from 'node:dgram';

/** The wake-on-LAN packet: six bytes 0xff, then the MAC sixteen times. */
export function magicPacket(mac: string): Buffer {
	if (!/^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i.test(mac)) throw new Error('malformed MAC address');
	const bytes = Buffer.from(mac.replace(/[:-]/g, ''), 'hex');
	return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => bytes)]);
}

/** Where to send it: the limited broadcast, and the box's /24 broadcast when its address is IPv4; or the one place a test says. */
export function wakeTargets(address: string, override: string | null): { host: string; port: number }[] {
	if (override) {
		const at = override.lastIndexOf(':');
		return [{ host: override.slice(0, at), port: Number(override.slice(at + 1)) }];
	}
	const hosts = ['255.255.255.255'];
	const v4 = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(address);
	if (v4) hosts.push(`${v4[1]}.255`);
	return hosts.flatMap((host) => [9, 7].map((port) => ({ host, port })));
}

/** Sends the packet to every target; fails only when none of them took it. */
export async function sendWake(mac: string, address: string, override: string | null): Promise<void> {
	const packet = magicPacket(mac);
	const socket = createSocket('udp4');
	try {
		await new Promise<void>((resolve, reject) => {
			socket.once('error', reject);
			socket.bind(0, () => {
				try {
					socket.setBroadcast(true);
				} catch (e) {
					return reject(e);
				}
				resolve();
			});
		});
		const sends = wakeTargets(address, override).map(
			(t) =>
				new Promise<void>((resolve, reject) => {
					socket.send(packet, t.port, t.host, (err) => (err ? reject(err) : resolve()));
				})
		);
		const results = await Promise.allSettled(sends);
		const failed = results.find((r) => r.status === 'rejected');
		if (failed && results.every((r) => r.status === 'rejected')) throw (failed as PromiseRejectedResult).reason;
	} finally {
		socket.close();
	}
}
