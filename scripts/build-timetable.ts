// Builds the Footscray-only timetable files from Transport Victoria's GTFS
// Schedule data.
//
//   tsx scripts/build-timetable.ts --metro <dir> --vline <dir> [--out static/timetable]
//
// <dir> is an extracted google_transit.zip (mode 2 = Metro, mode 1 = V/Line).
// Writes one JSON file per service date plus index.json, replacing whatever
// was in --out.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	FSY_STOP_IDS,
	lineFromRouteId,
	platformFor,
	type LineInfo,
	type Mode,
	type TimetableDay,
	type TimetableIndex,
	type TimetableTrip
} from '../src/lib/footscray';
import { addDays, gtfsTimeToSeconds, melbourneDate, serviceDayBase } from '../src/lib/time';

type Row = Record<string, string>;

/** Parses one CSV line (handles quoted fields and "" escapes). */
export function parseCsvLine(line: string): string[] {
	const out: string[] = [];
	let cur = '';
	let q = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (q) {
			if (c === '"') {
				if (line[i + 1] === '"') {
					cur += '"';
					i++;
				} else q = false;
			} else cur += c;
		} else if (c === '"') q = true;
		else if (c === ',') {
			out.push(cur);
			cur = '';
		} else cur += c;
	}
	out.push(cur);
	return out;
}

export function readCsv(path: string, keep?: (r: Row) => boolean): Row[] {
	const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
	const lines = text.split(/\r?\n/);
	const header = parseCsvLine(lines[0]);
	const rows: Row[] = [];
	for (let i = 1; i < lines.length; i++) {
		if (!lines[i]) continue;
		const v = parseCsvLine(lines[i]);
		const r: Row = {};
		for (let j = 0; j < header.length; j++) r[header[j]] = v[j] ?? '';
		if (!keep || keep(r)) rows.push(r);
	}
	return rows;
}

export function stationName(stopName: string): string {
	return stopName.replace(/ (Railway )?Station$/, '').trim();
}

/** Expands calendar.txt + calendar_dates.txt into service_id -> set of YYYYMMDD. */
export function serviceDates(calendar: Row[], exceptions: Row[]): Map<string, Set<string>> {
	const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
	const out = new Map<string, Set<string>>();
	for (const c of calendar) {
		const set = new Set<string>();
		const start = Date.UTC(
			+c.start_date.slice(0, 4),
			+c.start_date.slice(4, 6) - 1,
			+c.start_date.slice(6)
		);
		const end = Date.UTC(
			+c.end_date.slice(0, 4),
			+c.end_date.slice(4, 6) - 1,
			+c.end_date.slice(6)
		);
		for (let t = start; t <= end; t += 86400000) {
			const d = new Date(t);
			const dow = days[(d.getUTCDay() + 6) % 7];
			if (c[dow] === '1') set.add(d.toISOString().slice(0, 10).replaceAll('-', ''));
		}
		out.set(c.service_id, set);
	}
	for (const e of exceptions) {
		let set = out.get(e.service_id);
		if (!set) out.set(e.service_id, (set = new Set()));
		if (e.exception_type === '1') set.add(e.date);
		else if (e.exception_type === '2') set.delete(e.date);
	}
	return out;
}

interface Extracted {
	byDate: Map<
		string,
		{ trip: Omit<TimetableTrip, 'pattern' | 'dep'> & { depSec: number }; pattern: string[] }[]
	>;
	lines: Record<string, LineInfo>;
}

export function extractMode(dir: string, mode: Mode, into: Extracted): void {
	const fsyStops = new Set<string>(FSY_STOP_IDS[mode]);

	const routes = readCsv(join(dir, 'routes.txt'));
	const routeLine = new Map<string, string>();
	for (const r of routes) {
		const line = lineFromRouteId(r.route_id);
		if (!line) continue;
		routeLine.set(r.route_id, line);
		into.lines[line] = { name: r.route_short_name, color: `#${r.route_color || '444444'}`, mode };
	}

	const allTrips = readCsv(join(dir, 'trips.txt'));
	const trips = new Map<string, Row>();
	for (const t of allTrips) {
		const line = routeLine.get(t.route_id);
		if (!line) continue; // replacement buses etc.
		if (platformFor(mode, line, +t.direction_id) === null) continue; // line doesn't serve a shown platform
		trips.set(t.trip_id, { ...t, line });
	}

	// Through-running trains (e.g. Sunbury -> Metro Tunnel -> Cranbourne) are
	// split into several trips sharing a block_id. Keep those blocks' other
	// trips so the stopping pattern can follow the train to its destination.
	const blockKey = (t: Row) => (t.block_id ? `${t.service_id}|${t.block_id}` : '');
	const wantedBlocks = new Set([...trips.values()].map(blockKey).filter(Boolean));
	const blocks = new Map<string, string[]>();
	for (const t of allTrips) {
		const k = blockKey(t);
		if (!k || !wantedBlocks.has(k)) continue;
		let list = blocks.get(k);
		if (!list) blocks.set(k, (list = []));
		list.push(t.trip_id);
	}
	const needed = new Set([...trips.keys(), ...[...blocks.values()].flat()]);

	const names = new Map<string, string>();
	for (const s of readCsv(join(dir, 'stops.txt'))) names.set(s.stop_id, stationName(s.stop_name));

	// Group stop_times by trip, keeping only trips we care about.
	const times = new Map<string, Row[]>();
	for (const st of readCsv(join(dir, 'stop_times.txt'), (r) => needed.has(r.trip_id))) {
		let list = times.get(st.trip_id);
		if (!list) times.set(st.trip_id, (list = []));
		list.push(st);
	}
	for (const list of times.values()) list.sort((a, b) => +a.stop_sequence - +b.stop_sequence);
	const firstDep = (id: string) =>
		gtfsTimeToSeconds(times.get(id)?.[0]?.departure_time ?? '99:00:00');
	for (const list of blocks.values()) list.sort((a, b) => firstDep(a) - firstDep(b));

	/** Stops after `from` in this trip, then in following trips of the block until the destination is reached. */
	const onwardStops = (tripId: string, from: number, destination: string): string[] => {
		const out: string[] = [];
		const push = (s: Row) => {
			if (s.drop_off_type === '1') return; // pick-up only, train doesn't let people off
			const n = names.get(s.stop_id) ?? s.stop_id;
			if (out[out.length - 1] !== n) out.push(n);
		};
		times
			.get(tripId)!
			.slice(from + 1)
			.forEach(push);
		const t = trips.get(tripId)!;
		const block = blocks.get(blockKey(t));
		if (!block) return out;
		let idx = block.indexOf(tripId);
		for (let hop = 0; hop < 3 && out.at(-1) !== destination && idx + 1 < block.length; hop++) {
			const next = times.get(block[++idx]);
			if (!next?.length || names.get(next[0].stop_id) !== out.at(-1)) break; // not a through-run
			next.slice(1).forEach(push);
		}
		// If the block overshot (train continues in service past its signed destination), trim.
		const end = out.indexOf(destination);
		return end === -1 ? out : out.slice(0, end + 1);
	};

	const dates = serviceDates(
		readCsv(join(dir, 'calendar.txt')),
		readCsv(join(dir, 'calendar_dates.txt'))
	);

	for (const [tripId, t] of trips) {
		const list = times.get(tripId);
		if (!list) continue;
		const i = list.findIndex((s) => fsyStops.has(s.stop_id));
		if (i === -1) continue;
		const fsy = list[i];
		if (fsy.pickup_type === '1' || i === list.length - 1) continue; // can't board / terminates here
		const platform = platformFor(mode, t.line, +t.direction_id);
		if (platform === null) continue;

		const headsign = t.trip_headsign || names.get(list.at(-1)!.stop_id) || '';
		const destination = headsign.split(' via ')[0];
		const pattern = onwardStops(tripId, i, destination);

		const base = {
			id: tripId,
			mode,
			line: t.line,
			platform,
			headsign,
			seq: +fsy.stop_sequence,
			depSec: gtfsTimeToSeconds(fsy.departure_time || fsy.arrival_time)
		};
		for (const date of dates.get(t.service_id) ?? []) {
			let day = into.byDate.get(date);
			if (!day) into.byDate.set(date, (day = []));
			day.push({ trip: base, pattern });
		}
	}
}

export function finalise(ex: Extracted): { days: TimetableDay[]; index: TimetableIndex } {
	const days: TimetableDay[] = [];
	for (const date of [...ex.byDate.keys()].sort()) {
		const base = serviceDayBase(date);
		const patterns: string[][] = [];
		const patternIdx = new Map<string, number>();
		const trips: TimetableTrip[] = ex.byDate.get(date)!.map(({ trip, pattern }) => {
			const key = pattern.join('|');
			let p = patternIdx.get(key);
			if (p === undefined) {
				p = patterns.push(pattern) - 1;
				patternIdx.set(key, p);
			}
			const { depSec, ...rest } = trip;
			return { ...rest, dep: base + depSec, pattern: p };
		});
		trips.sort((a, b) => a.dep - b.dep || a.id.localeCompare(b.id));
		days.push({ date, trips, patterns });
	}
	const used = new Set(days.flatMap((d) => d.trips.map((t) => t.line)));
	const lines = Object.fromEntries(Object.entries(ex.lines).filter(([code]) => used.has(code)));
	return {
		days,
		index: { generatedAt: new Date().toISOString(), dates: days.map((d) => d.date), lines }
	};
}

function main() {
	const args = process.argv.slice(2);
	const arg = (name: string, def?: string) => {
		const i = args.indexOf(`--${name}`);
		if (i !== -1) return args[i + 1];
		if (def !== undefined) return def;
		throw new Error(`missing --${name}`);
	};
	const out = arg('out', 'static/timetable');
	const ex: Extracted = { byDate: new Map(), lines: {} };
	extractMode(arg('metro'), 'metro', ex);
	extractMode(arg('vline'), 'vline', ex);
	// Drop service dates that are already over (keep yesterday for after-midnight trips).
	const from = arg('from', addDays(melbourneDate(Date.now()), -1));
	for (const date of ex.byDate.keys()) if (date < from) ex.byDate.delete(date);
	const { days, index } = finalise(ex);

	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });
	for (const d of days) writeFileSync(join(out, `${d.date}.json`), JSON.stringify(d));
	writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 1));

	const sizes = readdirSync(out).map((f) => readFileSync(join(out, f)).length);
	console.log(
		`wrote ${days.length} days (${days[0]?.date}..${days.at(-1)?.date}), ` +
			`${days.reduce((n, d) => n + d.trips.length, 0)} departures, ` +
			`${(sizes.reduce((a, b) => a + b, 0) / 1024).toFixed(0)} KB total`
	);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/build-timetable.ts')) main();
