import { METRO_LINES, VLINE_LINES } from '../footscray';
import { decodeGtfsRealtime, type Feed } from './gtfsr';

export type { Feed };

const BASE = 'https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1';
export const FEEDS = {
	metroTrips: `${BASE}/metro/trip-updates`,
	metroAlerts: `${BASE}/metro/service-alerts`,
	vlineTrips: `${BASE}/vline/trip-updates`
} as const;
export type FeedName = keyof typeof FEEDS;

const SHOWN_LINES = new Set<string>([...METRO_LINES, ...VLINE_LINES]);
const ALERT_ROUTE = new RegExp(`^aus:vic:vic-02-(${METRO_LINES.join('|')})(-R)?:$`);

/**
 * Decodes a GTFS-R feed, keeping only trips and alerts that can matter at
 * Footscray (pass `all = true` to keep everything). Other lines' trips are
 * skipped without decoding their stop times. Trip IDs look like
 * "02-SUY--74-T5-Z030", where the 3 letters are the line.
 */
export function decodeFeed(bytes: Uint8Array, all = false): Feed {
	if (all) return decodeGtfsRealtime(bytes);
	return decodeGtfsRealtime(bytes, {
		trip: (id) => !!id && SHOWN_LINES.has(id.slice(3, 6)),
		alert: (a) => (a.informedEntity ?? []).some((ie) => ALERT_ROUTE.test(ie.routeId ?? ''))
	});
}

async function fetchFeed(name: FeedName, key: string): Promise<Feed> {
	const res = await fetch(FEEDS[name], { headers: { KeyID: key } });
	if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
	return decodeFeed(new Uint8Array(await res.arrayBuffer()));
}

export interface LiveData {
	metroTrips: Feed | null;
	vlineTrips: Feed | null;
	metroAlerts: Feed | null;
}

// Workers' Cache API is a no-op on *.workers.dev, so memoise per isolate.
// Any number of open screens hitting the same isolate share one upstream fetch.
// Trip updates change constantly; alerts (mostly planned works) rarely do, and
// they're the most expensive feed to decode, so they're refreshed less often.
const TTL_MS: Record<FeedName, number> = {
	metroTrips: 30_000,
	vlineTrips: 30_000,
	metroAlerts: 5 * 60_000
};
const RETRY_MS = 5_000;
const memo = new Map<FeedName, { at: number; ttl: number; data: Promise<Feed | null> }>();

function cachedFeed(name: FeedName, key: string, now: number): Promise<Feed | null> {
	const hit = memo.get(name);
	if (hit && now - hit.at < hit.ttl) return hit.data;
	const data = fetchFeed(name, key).catch((e) => {
		console.error('feed failed', name, String(e));
		// Keep serving the last good copy for a while, and retry soon.
		const entry = memo.get(name);
		if (entry?.data === data) entry.ttl = RETRY_MS;
		return hit?.data ?? null;
	});
	memo.set(name, { at: now, ttl: TTL_MS[name], data });
	return data;
}

/** Fetches all feeds; a failed feed comes back as its last good copy (or null) rather than failing the board. */
export async function getLiveData(key: string, now = Date.now()): Promise<LiveData> {
	const [metroTrips, vlineTrips, metroAlerts] = await Promise.all([
		cachedFeed('metroTrips', key, now),
		cachedFeed('vlineTrips', key, now),
		cachedFeed('metroAlerts', key, now)
	]);
	return { metroTrips, vlineTrips, metroAlerts };
}
