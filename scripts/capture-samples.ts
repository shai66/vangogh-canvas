// Saves real responses of vangogh to samples/. Run with:
//   node --env-file=.env scripts/capture-samples.ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

function requireEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		console.error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
		process.exit(1);
	}
	return value;
}

const base = requireEnv('VANGOGH_URL').replace(/\/+$/, '');
const username = requireEnv('VANGOGH_USERNAME');
const password = requireEnv('VANGOGH_PASSWORD');
const out = 'samples';

async function save(path: string, data: unknown): Promise<void> {
	const file = join(out, path);
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, JSON.stringify(data, null, '\t'));
}

async function login(): Promise<string> {
	const res = await fetch(`${base}/api/auth-user`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ username, password })
	});
	if (!res.ok) throw new Error(`login failed with ${res.status}`);
	const body = (await res.json()) as { token: string };
	return body.token;
}

const token = await login();
const auth = { authorization: `Bearer ${token}` };

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
	const res = await fetch(`${base}${path}`, { headers: auth });
	if (!res.ok) {
		await res.body?.cancel();
		return { status: res.status, body: null };
	}
	return { status: res.status, body: await res.json() };
}

async function probe(path: string, headers: Record<string, string> = {}) {
	const res = await fetch(`${base}${path}`, { headers: { ...auth, ...headers } });
	await res.body?.cancel();
	return {
		path,
		status: res.status,
		headers: Object.fromEntries(res.headers.entries())
	};
}

type Product = { id: string | number; tt?: string; dlc?: Record<string, string> };

const list = await getJson('/api/available-products');
if (!Array.isArray(list.body)) throw new Error(`library list answered ${list.status}`);
await save('available-products.json', list.body);
const products = list.body as Product[];
console.log(`${products.length} products in the library list`);

const status: Record<string, Record<string, number>> = {};
for (const product of products) {
	const id = String(product.id);
	status[id] = {};
	for (const type of ['gog-api-products', 'gog-details']) {
		const res = await getJson(`/api/metadata/${type}/${id}`);
		status[id][type] = res.status;
		if (res.body !== null) await save(`metadata/${type}/${id}.json`, res.body);
	}
	const names = await getJson(`/api/gog/filenames/${id}`);
	status[id].filenames = names.status;
	if (names.body !== null) await save(`filenames/${id}.json`, names.body);
	process.stdout.write('.');
}
console.log('');
await save('status.json', status);

// Probes: one image, and one file of a game and of a DLC, in each address form.
const probes: unknown[] = [];

// The first file of a download list that the archive holds.
function firstManualUrl(downloads: unknown, names: Record<string, string>): string | null {
	if (!Array.isArray(downloads)) return null;
	for (const pair of downloads) {
		const byOs = Array.isArray(pair) ? pair[1] : null;
		if (!byOs || typeof byOs !== 'object') continue;
		for (const files of Object.values(byOs as Record<string, unknown>)) {
			if (!Array.isArray(files)) continue;
			for (const file of files) {
				const url = (file as { manualUrl?: unknown })?.manualUrl;
				if (typeof url === 'string' && names[url]) return url;
			}
		}
	}
	return null;
}

let gameProbed = false;
let dlcProbed = false;
for (const product of products) {
	const id = String(product.id);
	if (status[id]['gog-details'] !== 200) continue;
	const details = (await getJson(`/api/metadata/gog-details/${id}`)).body as {
		downloads?: unknown;
		dlcs?: { title?: string; downloads?: unknown }[];
	};
	const names = ((await getJson(`/api/gog/filenames/${id}`)).body ?? {}) as Record<string, string>;
	const range = { range: 'bytes=0-0' };
	const gameUrl = firstManualUrl(details.downloads, names);
	if (gameUrl && !gameProbed) {
		gameProbed = true;
		const stripped = gameUrl.replace(/^\/+/, '');
		probes.push({ what: 'game file, leading slash stripped', ...(await probe(`/api/gog/manual-url/${id}/installer/${stripped}`, range)) });
		probes.push({ what: 'game file, leading slash kept', ...(await probe(`/api/gog/manual-url/${id}/installer/${gameUrl}`, range)) });
	}
	const dlc = details.dlcs?.find((d) => firstManualUrl(d.downloads, names));
	if (dlc && !dlcProbed) {
		dlcProbed = true;
		const stripped = firstManualUrl(dlc.downloads, names)!.replace(/^\/+/, '');
		const dlcId = Object.entries(product.dlc ?? {}).find(([, title]) => title === dlc.title)?.[0];
		probes.push({ what: 'dlc file, base game id', ...(await probe(`/api/gog/manual-url/${id}/downloadable-content/${stripped}`, range)) });
		if (dlcId) {
			probes.push({ what: 'dlc file, dlc id', ...(await probe(`/api/gog/manual-url/${dlcId}/downloadable-content/${stripped}`, range)) });
		}
	}
	if (gameProbed && dlcProbed) break;
}

for (const product of products) {
	const id = String(product.id);
	if (status[id]['gog-api-products'] !== 200) continue;
	const record = (await getJson(`/api/metadata/gog-api-products/${id}`)).body as {
		_links?: { boxArtImage?: { href?: string } };
	};
	const href = record._links?.boxArtImage?.href;
	if (!href) continue;
	const last = decodeURIComponent(href.split(/[?#]/)[0].split('/').pop() ?? '');
	const imageId = last.replace(/\.[A-Za-z0-9]+$/, '').replace(/_?\{formatter\}$/, '');
	probes.push({ what: 'poster', href, imageId, ...(await probe(`/api/gog/image/${imageId}`)) });
	break;
}

await save('probes.json', probes);
console.log(`done, see ${out}/`);
