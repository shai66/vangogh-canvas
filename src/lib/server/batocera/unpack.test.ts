import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeInstaller } from '../testing/batocera-library';
import { startFakeBatocera, type FakeBatocera } from '../testing/fake-batocera';
import { BoxDown, openBox, type Box } from './box';
import { INSTALLERS } from './commands';
import { UnpackError, unpackOnBox } from './unpack';

describe('unpackOnBox', () => {
	const part = '/userdata/roms/windows/Night Harbour.pc.part';
	const installer = `${part}/${INSTALLERS}/setup_night_harbour_1.2.exe`;
	let fake: FakeBatocera;
	let box: Box;

	beforeEach(async () => {
		fake = await startFakeBatocera();
		box = await openBox({ address: '127.0.0.1', port: fake.port, user: fake.user, password: fake.password, hostKey: null });
	});

	afterEach(async () => {
		box.close();
		await fake.close();
	});

	/** The installer on the box, in the part's installers folder. */
	async function put(body: Buffer | string): Promise<void> {
		await box.mkdirs(`${part}/${INSTALLERS}`);
		await box.write(installer, Buffer.from(body));
	}

	const until = async (check: () => boolean, ms = 2000) => {
		const end = Date.now() + ms;
		while (!check()) {
			if (Date.now() > end) throw new Error('timed out');
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	};

	/** What `unpackOnBox` throws. */
	const failure = (signal = new AbortController().signal) => unpackOnBox(box, { installer, part, signal }).catch((e: unknown) => e);

	it('unpacks an installer on the box', async () => {
		await put(fakeInstaller({ 'bin/Harbour.exe': 'harbour', 'goggame-3001.info': '{}' }));
		await unpackOnBox(box, { installer, part, signal: new AbortController().signal });
		expect((await box.read(`${part}/bin/Harbour.exe`))?.toString()).toBe('harbour');
		expect(await box.list(part)).toEqual([INSTALLERS, 'bin', 'goggame-3001.info']);
		expect(fake.unpacked).toEqual([installer]);
	});

	it("throws the box's innoextract message when it fails", async () => {
		await put(JSON.stringify({ fail: 'Not a supported Inno Setup installer' }));
		const error = await failure();
		expect(error).toBeInstanceOf(UnpackError);
		// innoextract's own words, for the log.
		expect((error as UnpackError).message).toContain('Not a supported Inno Setup installer');
		expect((error as UnpackError).rar).toBe(false);
	});

	it('says when RAR support is needed', async () => {
		await put(JSON.stringify({ fail: 'unrar is needed for this installer' }));
		const error = await failure();
		expect(error).toBeInstanceOf(UnpackError);
		expect((error as UnpackError).rar).toBe(true);
	});

	it('stops when told to', async () => {
		await put(JSON.stringify({ delayMs: 1500, files: { 'late.exe': 'x' } }));
		const stop = new AbortController();
		setTimeout(() => stop.abort(), 200);
		expect(((await failure(stop.signal)) as Error).name).toBe('AbortError');
		await until(() => fake.unpacking === 0, 500);
		await new Promise((resolve) => setTimeout(resolve, 2000));
		expect(await box.list(part)).not.toContain('late.exe');
		// Told before it starts, it does not start.
		expect(((await failure(AbortSignal.abort())) as Error).name).toBe('AbortError');
		expect(fake.unpacked).toEqual([installer]);
	});

	it('says the box went away, not that the installer failed, when the connection ends', async () => {
		await put(JSON.stringify({ delayMs: 1500, files: { 'late.exe': 'x' } }));
		const done = failure();
		await until(() => fake.unpacking === 1);
		await fake.off();
		expect(await done).toBeInstanceOf(BoxDown);
		await until(() => fake.unpacking === 0, 500);
	});
});
