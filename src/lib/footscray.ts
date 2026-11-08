// Footscray-specific rules and shared types. Imported by the timetable build
// script (Node), the server route (Workers) and the page.

export type LineCode = string; // GTFS route code, e.g. "SUY", "WER", "GEL"
export type Mode = 'metro' | 'vline';

/** Metro lines that call at Footscray. Anything else is dropped as early as possible. */
export const METRO_LINES = ['SUY', 'WER', 'WIL'] as const;
/** V/Line lines that call at Footscray (Gippsland, Seymour, Shepparton, Albury do not). */
export const VLINE_LINES = ['GEL', 'WBL', 'BAT', 'ART', 'MBY', 'BGO', 'ECH', 'SWL'] as const;

/** Platform stop_ids at Footscray in the GTFS data. */
export const FSY_STOP_IDS = {
	metro: ['15518', '15519', '15520', '15521', '26508', '26509'],
	vline: ['22240']
} as const;

export const METRO_PLATFORMS = [1, 2, 5, 6] as const;
export const VLINE_PLATFORMS = [4] as const;

/**
 * Footscray's platforms are fixed by line and direction (GTFS direction_id:
 * 1 = towards the city, 0 = away from it). Returns null for services the
 * board never shows (citybound V/Line on P3 is set-down only).
 */
export function platformFor(mode: Mode, line: LineCode, directionId: number): number | null {
	const citybound = directionId === 1;
	if (mode === 'metro') {
		if (line === 'SUY') return citybound ? 1 : 2;
		if (line === 'WER' || line === 'WIL') return citybound ? 5 : 6;
		return null;
	}
	if ((VLINE_LINES as readonly string[]).includes(line)) return citybound ? null : 4;
	return null;
}

/** "aus:vic:vic-02-SUY:" -> "SUY"; replacement-bus routes ("...-SUY-R:") -> null. */
export function lineFromRouteId(routeId: string): LineCode | null {
	const m = /^aus:vic:vic-0[12]-([A-Z]{3}):$/.exec(routeId);
	return m ? m[1] : null;
}

// ---------- Timetable file format (static/timetable/*.json) ----------

export interface TimetableTrip {
	/** GTFS trip_id (matches GTFS-Realtime trip_id). */
	id: string;
	mode: Mode;
	line: LineCode;
	platform: number;
	headsign: string;
	/** Scheduled departure from Footscray, epoch seconds. */
	dep: number;
	/** stop_sequence of the Footscray stop in this trip. */
	seq: number;
	/** Index into TimetableDay.patterns: stations served after Footscray. */
	pattern: number;
}

export interface TimetableDay {
	/** Service date, YYYYMMDD. */
	date: string;
	trips: TimetableTrip[];
	patterns: string[][];
}

export interface LineInfo {
	name: string;
	color: string;
	mode: Mode;
}

export interface TimetableIndex {
	generatedAt: string;
	dates: string[];
	lines: Record<LineCode, LineInfo>;
}

// ---------- Board API format (/api/board) ----------

export interface Departure {
	id: string;
	line: LineCode;
	platform: number;
	destination: string;
	via: string | null;
	/** Scheduled departure, epoch seconds. */
	scheduled: number;
	/** Best estimate (live if available), epoch seconds. */
	estimated: number;
	live: boolean;
	cancelled: boolean;
	stops: string[];
}

export interface Alert {
	id: string;
	header: string;
	description: string;
	lines: LineCode[];
}

export interface Board {
	/** When the board was built, epoch seconds. */
	generatedAt: number;
	/** True if live data was merged in. False = timetable only. */
	live: boolean;
	/** GTFS-R feed header timestamp, epoch seconds (null if not live). */
	feedTimestamp: number | null;
	lines: Record<LineCode, LineInfo>;
	platforms: { platform: number; mode: Mode; departures: Departure[] }[];
	alerts: Alert[];
}

/** "Cranbourne via Metro Tunnel" -> ["Cranbourne", "Metro Tunnel"]. */
export function splitHeadsign(headsign: string): [string, string | null] {
	const i = headsign.indexOf(' via ');
	return i === -1 ? [headsign, null] : [headsign.slice(0, i), headsign.slice(i + 5)];
}
