import { json } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { dev } from '$app/env';
import type { RequestHandler } from './$types';
import type { TimetableDay, TimetableIndex } from '../../../lib/footscray';
import { addDays, melbourneDate, melbourneHour } from '../../../lib/time';
import { getLiveData } from '../../../lib/server/feeds';
import { buildBoard } from '../../../lib/server/board';

// Timetable files are static assets; parse each once per isolate.
const fileCache = new Map<string, Promise<unknown>>();

function loadJson<T>(path: string, fetcher: (url: string) => Promise<Response>): Promise<T | null> {
	let p = fileCache.get(path);
	if (!p) {
		p = fetcher(path)
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		fileCache.set(path, p);
		p.then((v) => v === null && fileCache.delete(path)); // retry missing files next time
		if (fileCache.size > 8) fileCache.delete(fileCache.keys().next().value!);
	}
	return p as Promise<T | null>;
}

export const GET: RequestHandler = async ({ fetch, url }) => {
	const nowMs = Date.now();
	const now = Math.floor(nowMs / 1000);
	// In dev the ASSETS binding points at an unbuilt directory; Vite serves static/ instead.
	const assets = dev ? null : env.ASSETS;
	const fetcher = (path: string) =>
		assets ? assets.fetch(new URL(path, url.origin)) : fetch(path);

	// Only parse the service days that can matter: yesterday's runs past midnight
	// (GTFS times like 26:30), and tomorrow's can fall in a late-evening lookahead
	// (e.g. Night Network). Each file parsed is CPU on the free plan's 10 ms budget.
	const today = melbourneDate(nowMs);
	const hour = melbourneHour(nowMs);
	const dates = [
		...(hour < 5 ? [addDays(today, -1)] : []),
		today,
		...(hour >= 20 ? [addDays(today, 1)] : [])
	];
	const [index, ...days] = await Promise.all([
		loadJson<TimetableIndex>('/timetable/index.json', fetcher),
		...dates.map((d) => loadJson<TimetableDay>(`/timetable/${d}.json`, fetcher))
	]);
	if (!index) return json({ error: 'timetable missing' }, { status: 503 });

	const key = env.PTV_GTFSR_KEY;
	const live = key ? await getLiveData(key, nowMs) : null;

	const board = buildBoard({
		days: days.filter((d): d is TimetableDay => !!d),
		lines: index.lines,
		live,
		now
	});
	return json(board, {
		headers: { 'cache-control': 'public, max-age=15' }
	});
};
