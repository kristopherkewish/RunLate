import {
	FSY_STOP_IDS,
	METRO_LINES,
	METRO_PLATFORMS,
	VLINE_LINES,
	VLINE_PLATFORMS,
	lineFromRouteId,
	platformFor,
	splitHeadsign,
	type Alert,
	type Board,
	type Departure,
	type LineInfo,
	type Mode,
	type TimetableDay
} from '../footscray';
import type { Feed, LiveData } from './feeds';
import {
	EFFECT,
	STOP,
	TRIP,
	type StopTimeUpdate,
	type TranslatedString,
	type TripUpdate
} from './gtfsr';

export const WINDOW_BEFORE_S = 30; // keep a departed train on screen briefly ("Now")
export const WINDOW_AFTER_S = 4 * 3600;
export const PER_PLATFORM = 14;

const SHOWN_LINES = new Set<string>([...METRO_LINES, ...VLINE_LINES]);
const FSY_STOPS = new Set<string>([...FSY_STOP_IDS.metro, ...FSY_STOP_IDS.vline]);
const METRO_STOP_PLATFORM: Record<string, number> = {
	'15518': 1,
	'15519': 2,
	'26508': 5,
	'26509': 6
};
const EXTRA_TRIP_RELS = new Set<number>([TRIP.ADDED, TRIP.UNSCHEDULED, TRIP.DUPLICATED, TRIP.NEW]);

/** Trip updates for Footscray lines only; everything else is discarded before any real work. */
export function indexTripUpdates(...feeds: (Feed | null)[]): Map<string, TripUpdate> {
	const out = new Map<string, TripUpdate>();
	for (const feed of feeds) {
		for (const e of feed?.entity ?? []) {
			const tu = e.tripUpdate;
			const id = tu?.trip?.tripId;
			if (!tu || !id) continue;
			// trip_id looks like "02-SUY--74-T5-Z030"; the 3-letter code is the line.
			const line = id.slice(3, 6);
			if (!SHOWN_LINES.has(line)) continue;
			out.set(id, tu);
		}
	}
	return out;
}

const stopTime = (u: StopTimeUpdate) => u.departure?.time ?? u.arrival?.time ?? null;
const stopDelay = (u: StopTimeUpdate) => u.departure?.delay ?? u.arrival?.delay ?? null;

export interface LiveEstimate {
	estimated: number;
	cancelled: boolean;
	/** The train has already passed Footscray (all updates are for later stops). */
	passed: boolean;
}

/** Applies a GTFS-R trip update to a scheduled Footscray departure. */
export function estimate(scheduled: number, seq: number, tu: TripUpdate): LiveEstimate {
	const base = { estimated: scheduled, cancelled: false, passed: false };
	if (tu.trip?.scheduleRelationship === TRIP.CANCELED) return { ...base, cancelled: true };
	const updates = tu.stopTimeUpdate ?? [];
	if (!updates.length) return base;

	const here = updates.find(
		(u) =>
			(u.stopSequence != null && u.stopSequence === seq) ||
			(u.stopId != null && FSY_STOPS.has(u.stopId))
	);
	if (here) {
		if (here.scheduleRelationship === STOP.SKIPPED) return { ...base, cancelled: true };
		const t = stopTime(here);
		if (t != null) return { ...base, estimated: t };
		const d = stopDelay(here);
		return d != null ? { ...base, estimated: scheduled + d } : base;
	}

	// No update for Footscray itself: propagate the delay from the last earlier stop.
	const earlier = updates.filter((u) => u.stopSequence != null && u.stopSequence < seq);
	if (earlier.length) {
		const last = earlier.reduce((a, b) => ((b.stopSequence ?? 0) > (a.stopSequence ?? 0) ? b : a));
		const d = stopDelay(last);
		return d != null ? { ...base, estimated: scheduled + d } : base;
	}
	// Only later stops are reported, so the train is already past Footscray.
	if (updates.every((u) => u.stopSequence != null && u.stopSequence > seq))
		return { ...base, passed: true };
	return base;
}

function text(t: TranslatedString | null | undefined): string {
	const tr = t?.translation ?? [];
	return (tr.find((x) => !x.language || x.language === 'en') ?? tr[0])?.text?.trim() ?? '';
}

// Alerts the banner is for: problems with trains running. Facility notices
// (car parks, lifts, escalators) are left out.
const SERVICE_EFFECTS = new Set<number>([
	EFFECT.NO_SERVICE,
	EFFECT.REDUCED_SERVICE,
	EFFECT.SIGNIFICANT_DELAYS,
	EFFECT.DETOUR,
	EFFECT.MODIFIED_SERVICE,
	EFFECT.STOP_MOVED
]);
const VAGUE_EFFECTS = new Set<number>([EFFECT.OTHER_EFFECT, EFFECT.UNKNOWN_EFFECT]);
// Safety net for disruptions tagged with a vague effect.
const SERVICE_WORDS =
	/\b(delay(s|ed)?|cancel(l?ed|lations?)|buses replace|replacement bus(es)?|suspended|not running|no trains|disruption|reduced service|altered timetable|terminat(e|es|ing))\b/i;

/** Whether an alert is about trains running (vs. car parks, lifts, etc.). */
export function isServiceAlert(
	effect: number | undefined,
	header: string,
	description: string
): boolean {
	const e = effect ?? EFFECT.UNKNOWN_EFFECT;
	if (SERVICE_EFFECTS.has(e)) return true;
	if (VAGUE_EFFECTS.has(e)) return SERVICE_WORDS.test(`${header} ${description}`);
	return false; // accessibility issues, additional service, no effect
}

/** Metro alerts about train service on Footscray's lines that are active now. */
export function footscrayAlerts(feed: Feed | null, now: number): Alert[] {
	const out: Alert[] = [];
	const seen = new Set<string>();
	for (const e of feed?.entity ?? []) {
		const a = e.alert;
		if (!a) continue;
		const periods = a.activePeriod ?? [];
		const active =
			!periods.length || periods.some((p) => (p.start ?? 0) <= now && now <= (p.end || Infinity));
		if (!active) continue;
		const lines = new Set<string>();
		for (const ie of a.informedEntity ?? []) {
			const m = /^aus:vic:vic-02-([A-Z]{3})(-R)?:$/.exec(ie.routeId ?? '');
			if (m && (METRO_LINES as readonly string[]).includes(m[1])) lines.add(m[1]);
		}
		if (!lines.size) continue;
		const header = text(a.headerText);
		const description = text(a.descriptionText);
		if (!isServiceAlert(a.effect, header, description)) continue;
		const key = header + '|' + description;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ id: e.id ?? key, header, description, lines: [...lines].sort() });
	}
	return out;
}

export interface BuildInput {
	days: TimetableDay[];
	lines: Record<string, LineInfo>;
	live: LiveData | null;
	now: number; // epoch seconds
}

export function buildBoard({ days, lines, live, now }: BuildInput): Board {
	const updates = indexTripUpdates(live?.metroTrips ?? null, live?.vlineTrips ?? null);
	const isLive = !!(live?.metroTrips || live?.vlineTrips);
	const from = now - WINDOW_BEFORE_S;
	const to = now + WINDOW_AFTER_S;

	const byPlatform = new Map<number, Departure[]>();
	const push = (d: Departure) => {
		let list = byPlatform.get(d.platform);
		if (!list) byPlatform.set(d.platform, (list = []));
		list.push(d);
	};

	const seenIds = new Set<string>();
	for (const day of days) {
		for (const t of day.trips) {
			// Cheap pre-filter on the schedule; a delayed train can be up to an hour late.
			if (t.dep < from - 3600 || t.dep > to) continue;
			seenIds.add(t.id);
			const tu = updates.get(t.id);
			const est = tu ? estimate(t.dep, t.seq, tu) : null;
			if (est?.passed) continue;
			const estimated = est?.estimated ?? t.dep;
			// Cancelled trains stay until their scheduled time passes.
			const shownAt = est?.cancelled ? t.dep : estimated;
			if (shownAt < from || shownAt > to) continue;
			const [destination, via] = splitHeadsign(t.headsign);
			push({
				id: t.id,
				line: t.line,
				platform: t.platform,
				destination,
				via,
				scheduled: t.dep,
				estimated,
				live: !!tu,
				cancelled: !!est?.cancelled,
				stops: day.patterns[t.pattern] ?? []
			});
		}
	}

	// Live trips the timetable doesn't know about. Only trust trips the feed
	// explicitly marks as extra: our timetable deliberately omits services
	// (e.g. set-down-only citybound V/Line), so "not in our files" isn't enough.
	for (const [id, tu] of updates) {
		if (seenIds.has(id)) continue;
		if (!EXTRA_TRIP_RELS.has(tu.trip?.scheduleRelationship ?? TRIP.SCHEDULED)) continue;
		const here = tu.stopTimeUpdate?.find((u) => u.stopId && FSY_STOPS.has(u.stopId));
		const when = here && stopTime(here);
		if (!here || when == null || when < from || when > to) continue;
		const line = lineFromRouteId(tu.trip?.routeId ?? '') ?? id.slice(3, 6);
		const mode: Mode = id.startsWith('01-') ? 'vline' : 'metro';
		const dir = tu.trip?.directionId ?? null; // feeds are decoded without defaults, so absent = undefined
		const platform =
			dir != null ? platformFor(mode, line, dir) : (METRO_STOP_PLATFORM[here.stopId!] ?? null);
		if (platform === null) continue;
		push({
			id,
			line,
			platform,
			destination: lines[line]?.name ?? line,
			via: null,
			scheduled: when,
			estimated: when,
			live: true,
			cancelled: here.scheduleRelationship === STOP.SKIPPED,
			stops: []
		});
	}

	const platforms = [
		...METRO_PLATFORMS.map((p) => ({ platform: p, mode: 'metro' as const })),
		...VLINE_PLATFORMS.map((p) => ({ platform: p, mode: 'vline' as const }))
	].map(({ platform, mode }) => ({
		platform,
		mode,
		departures: (byPlatform.get(platform) ?? [])
			.sort(
				(a, b) =>
					(a.cancelled ? a.scheduled : a.estimated) - (b.cancelled ? b.scheduled : b.estimated)
			)
			.slice(0, PER_PLATFORM)
	}));

	const feedTs = live?.metroTrips?.header?.timestamp ?? live?.vlineTrips?.header?.timestamp ?? null;
	return {
		generatedAt: now,
		live: isLive,
		feedTimestamp: isLive ? feedTs : null,
		lines,
		platforms,
		alerts: footscrayAlerts(live?.metroAlerts ?? null, now)
	};
}
