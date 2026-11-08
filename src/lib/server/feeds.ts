import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
export type Feed = GtfsRealtimeBindings.transit_realtime.IFeedMessage;

const BASE = 'https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1';
export const FEEDS = {
	metroTrips: `${BASE}/metro/trip-updates`,
	metroAlerts: `${BASE}/metro/service-alerts`,
	vlineTrips: `${BASE}/vline/trip-updates`
} as const;
export type FeedName = keyof typeof FEEDS;

/**
 * Decodes a GTFS-R feed into a plain object. `defaults: false` matters: the
 * raw protobufjs message reports absent fields as 0 (e.g. a missing
 * stop_sequence or departure time), which would corrupt estimates.
 */
export function decodeFeed(bytes: Uint8Array): Feed {
	return FeedMessage.toObject(FeedMessage.decode(bytes), {
		longs: Number,
		enums: Number,
		defaults: false
	}) as Feed;
}

/** Converts protobuf Long values to plain numbers. */
export function num(v: unknown): number | null {
	if (v === null || v === undefined) return null;
	if (typeof v === 'number') return v;
	if (typeof v === 'object' && v && 'toNumber' in v)
		return (v as { toNumber(): number }).toNumber();
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
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
const TTL_MS = 30_000;
let memo: { at: number; data: Promise<LiveData> } | null = null;

/** Fetches all feeds; a failed feed comes back as null rather than failing the board. */
export function getLiveData(key: string, now = Date.now()): Promise<LiveData> {
	if (memo && now - memo.at < TTL_MS) return memo.data;
	const settle = (name: FeedName) =>
		fetchFeed(name, key).catch((e) => {
			console.error('feed failed', name, String(e));
			return null;
		});
	const data = Promise.all([
		settle('metroTrips'),
		settle('vlineTrips'),
		settle('metroAlerts')
	]).then(([metroTrips, vlineTrips, metroAlerts]) => ({ metroTrips, vlineTrips, metroAlerts }));
	memo = { at: now, data };
	// Don't keep a fully failed result for the whole TTL.
	data.then((d) => {
		if (!d.metroTrips && !d.vlineTrips && memo?.data === data)
			memo = { at: now - TTL_MS + 5000, data };
	});
	return data;
}
