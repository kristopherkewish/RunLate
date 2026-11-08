import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TimetableDay, TimetableIndex } from '../footscray';
import { buildBoard, estimate, footscrayAlerts, indexTripUpdates, isServiceAlert } from './board';
import { EFFECT } from './gtfsr';
import { decodeFeed, type Feed } from './feeds';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const metroTrips = decodeFeed(fixture('metro-trip-updates.pb'));
const vlineTrips = decodeFeed(fixture('vline-trip-updates.pb'));
const metroAlerts = decodeFeed(fixture('metro-service-alerts.pb'));
const day: TimetableDay = JSON.parse(fixture('timetable-20261108.json').toString());
const index: TimetableIndex = JSON.parse(fixture('timetable-index.json').toString());
const feedNow = Number(metroTrips.header!.timestamp);

const T = 1_800_000_000;

describe('estimate', () => {
	it('uses the live time at Footscray', () => {
		const e = estimate(T, 12, {
			stopTimeUpdate: [{ stopSequence: 12, stopId: '15518', departure: { time: T + 120 } }]
		});
		expect(e).toEqual({ estimated: T + 120, cancelled: false, passed: false });
	});

	it('propagates the delay from the last earlier stop', () => {
		const e = estimate(T, 12, {
			stopTimeUpdate: [
				{ stopSequence: 8, departure: { delay: 60 } },
				{ stopSequence: 10, departure: { delay: 180 } }
			]
		});
		expect(e.estimated).toBe(T + 180);
	});

	it('marks a skipped Footscray stop as cancelled (e.g. a train terminating early)', () => {
		const e = estimate(T, 12, {
			stopTimeUpdate: [{ stopSequence: 12, stopId: '15518', scheduleRelationship: 1 }]
		});
		expect(e.cancelled).toBe(true);
	});

	it('marks a cancelled trip as cancelled', () => {
		expect(estimate(T, 12, { trip: { scheduleRelationship: 3 } }).cancelled).toBe(true);
	});

	it('treats a train with only later stops reported as already gone', () => {
		const e = estimate(T, 12, { stopTimeUpdate: [{ stopSequence: 15, departure: { time: T } }] });
		expect(e.passed).toBe(true);
	});

	it('does not invent a time of 0 when only a delay is sent', () => {
		const e = estimate(T, 12, { stopTimeUpdate: [{ stopSequence: 12, departure: { delay: 60 } }] });
		expect(e.estimated).toBe(T + 60);
	});
});

describe('decodeFeed', () => {
	it('leaves absent fields undefined instead of protobuf defaults', () => {
		const vl = vlineTrips.entity!.find((e) => e.tripUpdate?.trip?.tripId)!;
		expect(vl.tripUpdate!.trip!.directionId).toBeUndefined();
	});
});

describe('indexTripUpdates', () => {
	it('keeps only lines that call at Footscray', () => {
		const idx = indexTripUpdates(metroTrips, vlineTrips);
		expect(idx.size).toBeGreaterThan(0);
		for (const id of idx.keys()) {
			expect([
				'SUY',
				'WER',
				'WIL',
				'GEL',
				'WBL',
				'BAT',
				'ART',
				'MBY',
				'BGO',
				'ECH',
				'SWL'
			]).toContain(id.slice(3, 6));
		}
	});
});

describe('footscrayAlerts', () => {
	it('returns only alerts for Footscray lines (including their replacement buses)', () => {
		const alert = (id: string, routeId: string) => ({
			id,
			alert: {
				effect: EFFECT.MODIFIED_SERVICE,
				informedEntity: [{ routeId }],
				headerText: { translation: [{ text: `Buses replace trains ${id}` }] }
			}
		});
		const feed: Feed = {
			entity: [
				alert('a', 'aus:vic:vic-02-SUY:'),
				alert('b', 'aus:vic:vic-02-WER-R:'),
				alert('c', 'aus:vic:vic-02-CGB:')
			]
		};
		const alerts = footscrayAlerts(feed, T);
		expect(alerts.map((a) => a.id)).toEqual(['a', 'b']);
		expect(alerts.map((a) => a.lines)).toEqual([['SUY'], ['WER']]);
	});

	it('drops alerts outside their active period', () => {
		const feed: Feed = {
			header: { gtfsRealtimeVersion: '2.0' },
			entity: [
				{
					id: 'x',
					alert: {
						activePeriod: [{ start: T - 100, end: T - 10 }],
						informedEntity: [{ routeId: 'aus:vic:vic-02-SUY:' }],
						headerText: { translation: [{ text: 'Old' }] }
					}
				}
			]
		};
		expect(footscrayAlerts(feed, T)).toEqual([]);
	});
});

describe('buildBoard against recorded feeds', () => {
	const board = buildBoard({
		days: [day],
		lines: index.lines,
		live: { metroTrips, vlineTrips, metroAlerts },
		now: feedNow
	});

	it('is live', () => {
		expect(board.live).toBe(true);
		expect(board.feedTimestamp).toBe(feedNow);
	});

	it('has the Footscray platforms in order', () => {
		expect(board.platforms.map((p) => p.platform)).toEqual([1, 2, 5, 6, 4]);
	});

	it('puts every departure on its fixed platform, in time order, within the window', () => {
		const expected: Record<string, number[]> = { SUY: [1, 2], WER: [5, 6], WIL: [5, 6] };
		for (const p of board.platforms) {
			expect(p.departures.length).toBeGreaterThan(0);
			let prev = -Infinity;
			for (const d of p.departures) {
				if (p.mode === 'vline') expect(p.platform).toBe(4);
				else expect(expected[d.line]).toContain(p.platform);
				const t = d.cancelled ? d.scheduled : d.estimated;
				expect(t).toBeGreaterThanOrEqual(prev);
				expect(t).toBeGreaterThanOrEqual(feedNow - 30);
				prev = t;
			}
		}
	});

	it('never shows citybound V/Line', () => {
		const p4 = board.platforms.find((p) => p.platform === 4)!;
		expect(p4.departures.some((d) => d.destination === 'Southern Cross')).toBe(false);
	});

	it('merges live estimates into scheduled trips', () => {
		const all = board.platforms.flatMap((p) => p.departures);
		expect(all.some((d) => d.live)).toBe(true);
		expect(all.every((d) => Math.abs(d.estimated - d.scheduled) < 3600)).toBe(true);
	});

	it('falls back to the timetable when feeds are down', () => {
		const offline = buildBoard({ days: [day], lines: index.lines, live: null, now: feedNow });
		expect(offline.live).toBe(false);
		expect(offline.platforms.flatMap((p) => p.departures).every((d) => !d.live)).toBe(true);
	});
});

describe('decodeFeed filtering', () => {
	it('drops entities for lines that do not serve Footscray before conversion', () => {
		const bytes = fixture('metro-trip-updates.pb');
		const all = decodeFeed(bytes, true).entity!.length;
		const kept = decodeFeed(bytes).entity!;
		expect(kept.length).toBeGreaterThan(0);
		expect(kept.length).toBeLessThan(all);
		expect(
			kept.every((e) => ['SUY', 'WER', 'WIL'].includes(e.tripUpdate!.trip!.tripId!.slice(3, 6)))
		).toBe(true);
	});
});

describe('banner alerts are about trains running', () => {
	it.each([
		[
			EFFECT.MODIFIED_SERVICE,
			'Planned work: Buses replace trains from Newport to Werribee',
			'',
			true
		],
		[EFFECT.SIGNIFICANT_DELAYS, 'Delays on the Sunbury line', '', true],
		[EFFECT.NO_SERVICE, 'No trains between Footscray and Sunshine', '', true],
		[EFFECT.REDUCED_SERVICE, 'Planned Works', '', true],
		[
			EFFECT.OTHER_EFFECT,
			'Planned work: Albion Station car park',
			'A section of the car park is closed.',
			false
		],
		[EFFECT.OTHER_EFFECT, 'Planned work: Tottenham Station car space closures', '', false],
		[EFFECT.OTHER_EFFECT, 'Planned work: Southern Cross Station lift works', '', false],
		[EFFECT.ACCESSIBILITY_ISSUE, 'Lift out of service at Footscray', 'Trains are delayed', false],
		[EFFECT.OTHER_EFFECT, 'Minor delays', 'Trains may be delayed up to 10 minutes.', true],
		[undefined, 'Sunbury line', 'Trains cancelled due to a police operation.', true],
		[EFFECT.UNKNOWN_EFFECT, 'Station notice', 'New artwork installed.', false]
	])('effect %s "%s" -> %s', (effect, header, description, expected) => {
		expect(isServiceAlert(effect, header, description)).toBe(expected);
	});

	it('drops car park notices from the recorded feed', () => {
		const alerts = footscrayAlerts(metroAlerts, feedNow);
		expect(alerts.some((a) => /car (park|space)/i.test(a.header))).toBe(false);
	});
});
