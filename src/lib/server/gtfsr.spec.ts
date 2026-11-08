import { readFileSync } from 'node:fs';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { describe, expect, it } from 'vitest';
import { decodeGtfsRealtime, type Feed } from './gtfsr';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

/** Keeps only the fields our decoder handles, dropping undefined keys and empty arrays. */
function project(feed: Feed | Record<string, any>): unknown {
	const pick = (o: any, keys: string[]) => {
		if (o == null) return undefined;
		const out: Record<string, unknown> = {};
		for (const k of keys) if (o[k] !== undefined && o[k] !== null) out[k] = o[k];
		return out;
	};
	const ev = (e: any) => pick(e, ['delay', 'time']);
	const tr = (t: any) =>
		t && { translation: (t.translation ?? []).map((x: any) => pick(x, ['text', 'language'])) };
	return {
		timestamp: (feed as any).header?.timestamp,
		entity: ((feed as any).entity ?? []).map((e: any) => {
			const out: Record<string, unknown> = { id: e.id };
			if (e.tripUpdate) {
				const tu = e.tripUpdate;
				out.tripUpdate = {
					trip: pick(tu.trip, [
						'tripId',
						'routeId',
						'directionId',
						'startTime',
						'startDate',
						'scheduleRelationship'
					]),
					stopTimeUpdate: (tu.stopTimeUpdate ?? []).map((u: any) => ({
						...pick(u, ['stopSequence', 'stopId', 'scheduleRelationship']),
						...(u.arrival ? { arrival: ev(u.arrival) } : {}),
						...(u.departure ? { departure: ev(u.departure) } : {})
					}))
				};
			}
			if (e.alert) {
				const a = e.alert;
				out.alert = {
					cause: a.cause,
					effect: a.effect,
					activePeriod: (a.activePeriod ?? []).map((p: any) => pick(p, ['start', 'end'])),
					informedEntity: (a.informedEntity ?? []).map((s: any) =>
						pick(s, ['routeId', 'directionId'])
					),
					headerText: tr(a.headerText),
					descriptionText: tr(a.descriptionText)
				};
			}
			return out;
		})
	};
}

describe('decodeGtfsRealtime matches the official bindings', () => {
	it.each(['metro-trip-updates.pb', 'vline-trip-updates.pb', 'metro-service-alerts.pb'])(
		'%s',
		(name) => {
			const bytes = fixture(name);
			const official = FeedMessage.toObject(FeedMessage.decode(bytes), {
				longs: Number,
				enums: Number,
				defaults: false
			});
			const ours = decodeGtfsRealtime(bytes);
			expect(ours.entity!.length).toBeGreaterThan(0);
			expect(project(ours)).toEqual(project(official));
		}
	);

	it('decodes negative delays (int32 is sign-extended to 10 bytes)', () => {
		const msg = FeedMessage.encode(
			FeedMessage.fromObject({
				header: { gtfsRealtimeVersion: '2.0', timestamp: 1794135121 },
				entity: [
					{
						id: '1',
						tripUpdate: {
							trip: { tripId: '02-SUY--1-T5-A001' },
							stopTimeUpdate: [{ stopSequence: 3, arrival: { delay: -228, time: 1794133752 } }]
						}
					}
				]
			})
		).finish();
		const feed = decodeGtfsRealtime(msg);
		expect(feed.header!.timestamp).toBe(1794135121);
		expect(feed.entity![0].tripUpdate!.stopTimeUpdate![0].arrival).toEqual({
			delay: -228,
			time: 1794133752
		});
	});

	it('skips trips the filter rejects without decoding their stop times', () => {
		const feed = decodeGtfsRealtime(fixture('metro-trip-updates.pb'), {
			trip: (id) => !!id?.startsWith('02-SUY')
		});
		expect(feed.entity!.length).toBeGreaterThan(0);
		expect(feed.entity!.every((e) => e.tripUpdate!.trip!.tripId!.startsWith('02-SUY'))).toBe(true);
	});
});
