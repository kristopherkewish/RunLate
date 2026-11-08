// Melbourne time helpers. GTFS times are relative to "noon minus 12h" of the
// service date in the agency timezone, and can exceed 24:00:00.

export const TZ = 'Australia/Melbourne';

const fmt = new Intl.DateTimeFormat('en-AU', {
	timeZone: TZ,
	hourCycle: 'h23',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit'
});

function parts(epochMs: number) {
	const p: Record<string, string> = {};
	for (const { type, value } of fmt.formatToParts(new Date(epochMs))) p[type] = value;
	return p;
}

/** Offset of Melbourne local time from UTC at the given instant, in ms. */
export function tzOffsetMs(epochMs: number): number {
	const p = parts(epochMs);
	const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
	return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/** Epoch ms of a Melbourne wall-clock time. */
export function melbourneToEpochMs(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
	const guess = Date.UTC(y, mo - 1, d, h, mi, s);
	let t = guess - tzOffsetMs(guess);
	t = guess - tzOffsetMs(t); // second pass settles DST edges
	return t;
}

/** Epoch seconds of "noon minus 12h" for a YYYYMMDD service date. */
export function serviceDayBase(date: string): number {
	const y = +date.slice(0, 4),
		m = +date.slice(4, 6),
		d = +date.slice(6, 8);
	return melbourneToEpochMs(y, m, d, 12) / 1000 - 12 * 3600;
}

/** "25:10:00" -> seconds. */
export function gtfsTimeToSeconds(t: string): number {
	const [h, m, s] = t.split(':').map(Number);
	return h * 3600 + m * 60 + s;
}

/** Melbourne calendar date (YYYYMMDD) of an instant. */
export function melbourneDate(epochMs: number): string {
	const p = parts(epochMs);
	return `${p.year}${p.month}${p.day}`;
}

/** YYYYMMDD +/- n days. */
export function addDays(date: string, n: number): string {
	const t = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8) + n);
	return new Date(t).toISOString().slice(0, 10).replaceAll('-', '');
}

const clockFmt = new Intl.DateTimeFormat('en-AU', {
	timeZone: TZ,
	hour: 'numeric',
	minute: '2-digit',
	hourCycle: 'h12'
});

/** "9:06" style clock time (no am/pm, like the station screens). */
export function clock(epochSec: number): string {
	return clockFmt
		.format(new Date(epochSec * 1000))
		.replace(/\s?[ap]m$/i, '')
		.trim();
}
