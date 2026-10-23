import { createSocket } from 'node:dgram';
import { describe, expect, it } from 'vitest';
import { magicPacket, sendWake, wakeTargets } from './wake';

describe('magicPacket', () => {
	it('makes the magic packet', () => {
		const packet = magicPacket('02:00:00:aa:bb:cc');
		expect(packet.length).toBe(102);
		expect([...packet.subarray(0, 6)]).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
		for (let i = 0; i < 16; i++) expect([...packet.subarray(6 + i * 6, 12 + i * 6)]).toEqual([0x02, 0, 0, 0xaa, 0xbb, 0xcc]);
	});

	it('refuses a malformed MAC', () => {
		for (const mac of ['', '02:00:00:aa:bb', '02:00:00:aa:bb:cc:dd', '02:00:00:aa:bb:zz', 'nonsense']) expect(() => magicPacket(mac)).toThrow();
	});
});

describe('wakeTargets', () => {
	it('sends to the broadcast addresses, or where the tests say', () => {
		expect(wakeTargets('10.0.0.21', null)).toEqual([
			{ host: '255.255.255.255', port: 9 },
			{ host: '255.255.255.255', port: 7 },
			{ host: '10.0.0.255', port: 9 },
			{ host: '10.0.0.255', port: 7 }
		]);
		expect(wakeTargets('batocera.home', null)).toEqual([
			{ host: '255.255.255.255', port: 9 },
			{ host: '255.255.255.255', port: 7 }
		]);
		expect(wakeTargets('10.0.0.21', '127.0.0.1:40009')).toEqual([{ host: '127.0.0.1', port: 40009 }]);
	});
});

describe('sendWake', () => {
	it('sends the packet', async () => {
		const server = createSocket('udp4');
		const got = new Promise<Buffer>((resolve) => server.once('message', resolve));
		await new Promise<void>((resolve) => server.bind(0, '127.0.0.1', resolve));
		try {
			await sendWake('02:00:00:aa:bb:cc', '10.0.0.21', `127.0.0.1:${server.address().port}`);
			expect((await got).equals(magicPacket('02:00:00:aa:bb:cc'))).toBe(true);
		} finally {
			server.close();
		}
	});
});
