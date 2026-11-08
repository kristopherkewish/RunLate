import { describe, expect, it } from 'vitest';
import { addDays, clock, gtfsTimeToSeconds, melbourneDate, serviceDayBase } from './time';

const local = (epochSec: number) =>
	new Date(epochSec * 1000).toLocaleString('en-AU', {
		timeZone: 'Australia/Melbourne',
		hour12: false
	});

describe('serviceDayBase', () => {
	it('maps GTFS times to Melbourne wall-clock on a normal day', () => {
		expect(local(serviceDayBase('20261109') + gtfsTimeToSeconds('08:19:00'))).toBe(
			'09/11/2026, 08:19:00'
		);
	});

	it('handles times past midnight', () => {
		expect(local(serviceDayBase('20261109') + gtfsTimeToSeconds('25:10:00'))).toBe(
			'10/11/2026, 01:10:00'
		);
	});

	it('handles the day DST starts (4 Oct 2026, clocks jump 2am -> 3am)', () => {
		expect(local(serviceDayBase('20261004') + gtfsTimeToSeconds('08:00:00'))).toBe(
			'04/10/2026, 08:00:00'
		);
	});

	it('handles the day DST ends (5 Apr 2026, clocks go 3am -> 2am)', () => {
		expect(local(serviceDayBase('20260405') + gtfsTimeToSeconds('08:00:00'))).toBe(
			'05/04/2026, 08:00:00'
		);
	});
});

describe('date helpers', () => {
	it('melbourneDate uses Melbourne, not UTC', () => {
		// 2026-11-08T14:30Z is 01:30 on the 9th in Melbourne (AEDT, UTC+11).
		expect(melbourneDate(Date.UTC(2026, 10, 8, 14, 30))).toBe('20261109');
	});

	it('addDays crosses month and year boundaries', () => {
		expect(addDays('20261231', 1)).toBe('20270101');
		expect(addDays('20261101', -1)).toBe('20261031');
	});

	it('clock drops am/pm like the station screens', () => {
		expect(clock(serviceDayBase('20261109') + gtfsTimeToSeconds('21:06:00'))).toBe('9:06');
	});
});
