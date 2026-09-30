import type { Os } from '../../types';
import { arr, obj, str, unique } from './raw';

export interface LibraryProduct {
	id: string;
	title: string;
	os: Os[];
	dlc: { id: string; title: string }[];
}

const OS_BY_NUMBER = new Map<string, Os>([
	['1', 'windows'],
	['2', 'macos'],
	['3', 'linux']
]);

/** A product id: digits only, since it becomes a key and a part of an address. */
const PRODUCT_ID = /^\d+$/;

function idOf(x: unknown): string {
	const id = typeof x === 'number' ? String(x) : str(x);
	return PRODUCT_ID.test(id) ? id : '';
}

/** Maps the answer of GET /api/available-products. */
export function mapLibrary(raw: unknown): LibraryProduct[] {
	if (!Array.isArray(raw)) throw new Error('the library list is not a list');
	const products: LibraryProduct[] = [];
	for (const item of raw) {
		const product = obj(item);
		const id = idOf(product.id);
		if (!id) continue;
		products.push({
			id,
			title: str(product.tt) || id,
			os: unique(
				arr(product.os)
					.map((n) => OS_BY_NUMBER.get(String(n)))
					.filter((os): os is Os => os !== undefined)
			),
			dlc: Object.entries(obj(product.dlc))
				.filter(([dlcId]) => PRODUCT_ID.test(dlcId))
				.map(([dlcId, title]) => ({
					id: dlcId,
					title: str(title) || dlcId
				}))
		});
	}
	return products;
}
