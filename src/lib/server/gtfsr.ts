// A small, purpose-built GTFS-Realtime decoder.
//
// The general-purpose protobufjs bindings cost 10-20 ms of CPU per refresh on
// a cold Worker isolate, over the free plan's 10 ms budget. This reads the
// protobuf wire format directly, decodes only the fields the board uses, and
// skips entities for other lines without decoding them.
//
// Field numbers follow gtfs-realtime.proto:
// https://gtfs.org/documentation/realtime/proto/
//
// Output mirrors the shape of the official bindings' plain objects
// (`toObject` with longs/enums as numbers and no defaults): absent fields are
// undefined, never 0.

export interface StopTimeEvent {
	delay?: number;
	time?: number;
}
export interface StopTimeUpdate {
	stopSequence?: number;
	stopId?: string;
	arrival?: StopTimeEvent;
	departure?: StopTimeEvent;
	scheduleRelationship?: number;
}
export interface TripDescriptor {
	tripId?: string;
	routeId?: string;
	directionId?: number;
	startTime?: string;
	startDate?: string;
	scheduleRelationship?: number;
}
export interface TripUpdate {
	trip?: TripDescriptor;
	stopTimeUpdate?: StopTimeUpdate[];
}
export interface Translation {
	text?: string;
	language?: string;
}
export interface TranslatedString {
	translation?: Translation[];
}
export interface Alert {
	activePeriod?: { start?: number; end?: number }[];
	/** Only route_id and direction_id are decoded. */
	informedEntity?: { routeId?: string; directionId?: number }[];
	headerText?: TranslatedString;
	descriptionText?: TranslatedString;
}
export interface FeedEntity {
	id?: string;
	tripUpdate?: TripUpdate;
	alert?: Alert;
}
export interface Feed {
	header?: { gtfsRealtimeVersion?: string; timestamp?: number };
	entity?: FeedEntity[];
}

/** TripDescriptor.ScheduleRelationship */
export const TRIP = {
	SCHEDULED: 0,
	ADDED: 1,
	UNSCHEDULED: 2,
	CANCELED: 3,
	DUPLICATED: 6,
	NEW: 8
} as const;
/** TripUpdate.StopTimeUpdate.ScheduleRelationship */
export const STOP = { SCHEDULED: 0, SKIPPED: 1, NO_DATA: 2 } as const;

const utf8 = new TextDecoder();

class Reader {
	pos: number;
	constructor(
		readonly buf: Uint8Array,
		start = 0,
		readonly end = buf.length
	) {
		this.pos = start;
	}

	/** Unsigned varint as a number (exact up to 2^53). */
	varint(): number {
		let result = 0;
		let mul = 1;
		for (let i = 0; i < 10; i++) {
			const b = this.buf[this.pos++];
			result += (b & 0x7f) * mul;
			if (b < 0x80) return result;
			mul *= 128;
		}
		throw new Error('malformed varint');
	}

	/** int32: negative values are sign-extended to 10 bytes; keep the low 32 bits. */
	int32(): number {
		let lo = 0;
		let shift = 0;
		let i = 0;
		let b: number;
		do {
			b = this.buf[this.pos++];
			if (shift < 32) lo |= (b & 0x7f) << shift;
			shift += 7;
			if (++i > 10) throw new Error('malformed varint');
		} while (b >= 0x80);
		return lo | 0;
	}

	/** Returns [start, end) of a length-delimited field and moves past it. */
	bytes(): [number, number] {
		const len = this.varint();
		const start = this.pos;
		this.pos += len;
		if (this.pos > this.end) throw new Error('truncated field');
		return [start, this.pos];
	}

	string(): string {
		const [s, e] = this.bytes();
		return utf8.decode(this.buf.subarray(s, e));
	}

	skip(wireType: number): void {
		switch (wireType) {
			case 0:
				while (this.buf[this.pos++] >= 0x80);
				break;
			case 1:
				this.pos += 8;
				break;
			case 2:
				this.bytes();
				break;
			case 5:
				this.pos += 4;
				break;
			default:
				throw new Error(`unsupported wire type ${wireType}`);
		}
	}

	sub([s, e]: [number, number]): Reader {
		return new Reader(this.buf, s, e);
	}

	/** Iterates fields: calls fn(fieldNumber, wireType) until the end; fn must consume or skip. */
	each(fn: (field: number, wire: number) => void): void {
		while (this.pos < this.end) {
			const tag = this.varint();
			fn(tag >>> 3, tag & 7);
		}
	}
}

function stopTimeEvent(r: Reader): StopTimeEvent {
	const out: StopTimeEvent = {};
	r.each((f, w) => {
		if (f === 1 && w === 0) out.delay = r.int32();
		else if (f === 2 && w === 0) out.time = r.varint();
		else r.skip(w);
	});
	return out;
}

function stopTimeUpdate(r: Reader): StopTimeUpdate {
	const out: StopTimeUpdate = {};
	r.each((f, w) => {
		if (f === 1 && w === 0) out.stopSequence = r.varint();
		else if (f === 4 && w === 2) out.stopId = r.string();
		else if (f === 2 && w === 2) out.arrival = stopTimeEvent(r.sub(r.bytes()));
		else if (f === 3 && w === 2) out.departure = stopTimeEvent(r.sub(r.bytes()));
		else if (f === 5 && w === 0) out.scheduleRelationship = r.varint();
		else r.skip(w);
	});
	return out;
}

function tripDescriptor(r: Reader): TripDescriptor {
	const out: TripDescriptor = {};
	r.each((f, w) => {
		if (w === 2 && f === 1) out.tripId = r.string();
		else if (w === 2 && f === 5) out.routeId = r.string();
		else if (w === 2 && f === 2) out.startTime = r.string();
		else if (w === 2 && f === 3) out.startDate = r.string();
		else if (w === 0 && f === 6) out.directionId = r.varint();
		else if (w === 0 && f === 4) out.scheduleRelationship = r.varint();
		else r.skip(w);
	});
	return out;
}

/** Just the trip_id of a TripDescriptor (enough to decide whether to keep it). */
function tripIdOf(r: Reader): string | undefined {
	let id: string | undefined;
	r.each((f, w) => {
		if (f === 1 && w === 2) id = r.string();
		else r.skip(w);
	});
	return id;
}

/**
 * Decodes a TripUpdate only if `keep(tripId)` says so; rejected trips cost
 * one string decode and no allocations for their stop times.
 */
function tripUpdate(r: Reader, keep: (tripId: string | undefined) => boolean): TripUpdate | null {
	let tripRange: [number, number] | undefined;
	const stops: [number, number][] = [];
	r.each((f, w) => {
		if (f === 1 && w === 2) tripRange = r.bytes();
		else if (f === 2 && w === 2) stops.push(r.bytes());
		else r.skip(w);
	});
	if (!tripRange || !keep(tripIdOf(r.sub(tripRange)))) return null;
	const out: TripUpdate = { trip: tripDescriptor(r.sub(tripRange)) };
	if (stops.length) out.stopTimeUpdate = stops.map((range) => stopTimeUpdate(r.sub(range)));
	return out;
}

function translation(r: Reader): Translation {
	const out: Translation = {};
	r.each((f, w) => {
		if (f === 1 && w === 2) out.text = r.string();
		else if (f === 2 && w === 2) out.language = r.string();
		else r.skip(w);
	});
	return out;
}

function translated(r: Reader): TranslatedString {
	const list: Translation[] = [];
	r.each((f, w) => {
		if (f === 1 && w === 2) list.push(translation(r.sub(r.bytes())));
		else r.skip(w);
	});
	return { translation: list };
}

function alert(r: Reader, keep: (a: Alert) => boolean): Alert | null {
	const out: Alert = {};
	const text: { header?: [number, number]; description?: [number, number] } = {};
	r.each((f, w) => {
		if (f === 1 && w === 2) {
			const range: { start?: number; end?: number } = {};
			const s = r.sub(r.bytes());
			s.each((tf, tw) => {
				if (tf === 1 && tw === 0) range.start = s.varint();
				else if (tf === 2 && tw === 0) range.end = s.varint();
				else s.skip(tw);
			});
			(out.activePeriod ??= []).push(range);
		} else if (f === 5 && w === 2) {
			const sel: NonNullable<Alert['informedEntity']>[number] = {};
			const s = r.sub(r.bytes());
			s.each((sf, sw) => {
				// Only the route matters to the board; selectors also list every
				// affected stop, which is most of the feed's bytes.
				if (sf === 2 && sw === 2) sel.routeId = s.string();
				else if (sf === 6 && sw === 0) sel.directionId = s.varint();
				else s.skip(sw);
			});
			(out.informedEntity ??= []).push(sel);
		} else if (f === 10 && w === 2) text.header = r.bytes();
		else if (f === 11 && w === 2) text.description = r.bytes();
		else r.skip(w);
	});
	if (!keep(out)) return null;
	// Text is the bulk of an alert; only decode it for alerts we keep.
	if (text.header) out.headerText = translated(r.sub(text.header));
	if (text.description) out.descriptionText = translated(r.sub(text.description));
	return out;
}

export interface DecodeFilter {
	trip?: (tripId: string | undefined) => boolean;
	alert?: (a: Alert) => boolean;
}

/** Decodes trip updates and alerts (vehicle positions are skipped). */
export function decodeGtfsRealtime(buf: Uint8Array, filter: DecodeFilter = {}): Feed {
	const keepTrip = filter.trip ?? (() => true);
	const keepAlert = filter.alert ?? (() => true);
	const r = new Reader(buf);
	const feed: Feed = { entity: [] };
	r.each((f, w) => {
		if (f === 1 && w === 2) {
			const header: NonNullable<Feed['header']> = {};
			const h = r.sub(r.bytes());
			h.each((hf, hw) => {
				if (hf === 1 && hw === 2) header.gtfsRealtimeVersion = h.string();
				else if (hf === 3 && hw === 0) header.timestamp = h.varint();
				else h.skip(hw);
			});
			feed.header = header;
		} else if (f === 2 && w === 2) {
			const e = r.sub(r.bytes());
			const entity: FeedEntity = {};
			let keep = false;
			e.each((ef, ew) => {
				if (ef === 1 && ew === 2) entity.id = e.string();
				else if (ef === 3 && ew === 2) {
					const tu = tripUpdate(e.sub(e.bytes()), keepTrip);
					if (tu) ((entity.tripUpdate = tu), (keep = true));
				} else if (ef === 5 && ew === 2) {
					const a = alert(e.sub(e.bytes()), keepAlert);
					if (a) ((entity.alert = a), (keep = true));
				} else e.skip(ew);
			});
			if (keep) feed.entity!.push(entity);
		} else r.skip(w);
	});
	return feed;
}
