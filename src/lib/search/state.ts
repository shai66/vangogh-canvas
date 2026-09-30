import { ALL_OS, type Os } from '$lib/types';

export type Sort = 'title' | 'recent';

/** The ways of playing with others that can be filtered by. Each is a flag of a list entry. */
export type Together = 'multiplayer' | 'coop';
export const ALL_TOGETHER: readonly Together[] = ['multiplayer', 'coop'];

export interface ViewState {
	q: string;
	os: Os[];
	genres: string[];
	together: Together[];
	sort: Sort;
}

export const DEFAULT_STATE: ViewState = { q: '', os: [], genres: [], together: [], sort: 'title' };

const MAX_QUERY = 200;

function values(params: URLSearchParams, name: string, split: boolean): string[] {
	const raw = params.getAll(name).flatMap((v) => (split ? v.split(',') : [v]));
	return [...new Set(raw.map((v) => v.trim()).filter(Boolean))];
}

/** The view described by the address, such as `?q=witcher&os=linux&play=coop`. */
export function parseState(params: URLSearchParams): ViewState {
	return {
		q: (params.get('q') ?? '').slice(0, MAX_QUERY),
		os: values(params, 'os', true).filter((v): v is Os => (ALL_OS as readonly string[]).includes(v)),
		genres: values(params, 'genre', false),
		together: values(params, 'play', true).filter((v): v is Together =>
			(ALL_TOGETHER as readonly string[]).includes(v)
		),
		sort: params.get('sort') === 'recent' ? 'recent' : 'title'
	};
}

/** The address for a view. Defaults are left out. */
export function toParams(state: ViewState): URLSearchParams {
	const params = new URLSearchParams();
	if (state.q.trim()) params.set('q', state.q.trim());
	if (state.os.length > 0) params.set('os', state.os.join(','));
	for (const genre of state.genres) params.append('genre', genre);
	if (state.together.length > 0) params.set('play', state.together.join(','));
	if (state.sort !== 'title') params.set('sort', state.sort);
	return params;
}
