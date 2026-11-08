import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractMode, finalise, parseCsvLine, serviceDates } from './build-timetable';
import { gtfsTimeToSeconds, serviceDayBase } from '../src/lib/time';

const dir = (m: string) => fileURLToPath(new URL(`./fixtures/${m}`, import.meta.url));

function build() {
	const ex = { byDate: new Map(), lines: {} } as Parameters<typeof extractMode>[2];
	extractMode(dir('metro'), 'metro', ex);
	extractMode(dir('vline'), 'vline', ex);
	return finalise(ex);
}

describe('parseCsvLine', () => {
	it('handles quotes, commas and escaped quotes', () => {
		expect(parseCsvLine('"a","b, c","say ""hi""",')).toEqual(['a', 'b, c', 'say "hi"', '']);
	});
});

describe('serviceDates', () => {
	it('applies weekdays and exceptions', () => {
		const s = serviceDates(
			[
				{
					service_id: 'X',
					monday: '1',
					tuesday: '1',
					wednesday: '0',
					thursday: '0',
					friday: '0',
					saturday: '0',
					sunday: '0',
					start_date: '20261109',
					end_date: '20261117'
				}
			],
			[
				{ service_id: 'X', date: '20261110', exception_type: '2' },
				{ service_id: 'X', date: '20261113', exception_type: '1' }
			]
		);
		expect([...s.get('X')!].sort()).toEqual(['20261109', '20261113', '20261116', '20261117']);
	});
});

describe('timetable extraction', () => {
	const { days, index } = build();
	const mon = days.find((d) => d.date === '20261109')!;
	const trip = (id: string) => mon.trips.find((t) => t.id === id);

	it('writes one file per service date', () => {
		// WK runs Mon-Fri 9-13 Nov minus Tue 10th, plus Sat 14th.
		expect(days.map((d) => d.date)).toEqual([
			'20261109',
			'20261111',
			'20261112',
			'20261113',
			'20261114'
		]);
		expect(index.dates).toEqual(days.map((d) => d.date));
	});

	it('only lists lines that appear on the board', () => {
		expect(Object.keys(index.lines).sort()).toEqual(['GEL', 'SUY']);
		expect(index.lines.SUY).toEqual({ name: 'Sunbury', color: '#FFBE00', mode: 'metro' });
	});

	it('assigns fixed platforms and epoch departure times', () => {
		const t = trip('02-SUY--1-T5-A001')!;
		expect(t.platform).toBe(1);
		expect(t.seq).toBe(2);
		expect(t.dep).toBe(serviceDayBase('20261109') + gtfsTimeToSeconds('08:06:00'));
	});

	it('follows a through-running train along its block to the signed destination', () => {
		const t = trip('02-SUY--1-T5-A001')!;
		expect(mon.patterns[t.pattern]).toEqual(['Arden', 'Town Hall', 'Anzac', 'Cranbourne']);
	});

	it('handles times past midnight and leaves pick-up-only stops out of patterns', () => {
		const t = trip('02-SUY--1-T5-A003')!;
		expect(t.platform).toBe(2);
		expect(t.dep).toBe(serviceDayBase('20261109') + 24.5 * 3600);
		expect(mon.patterns[t.pattern]).toEqual(['Sunbury']); // Middle Footscray is pick-up only
	});

	it('drops trains that terminate at Footscray, replacement buses and lines that skip Footscray', () => {
		expect(trip('02-SUY--1-T5-A004')).toBeUndefined();
		expect(trip('02-SUY-R-1-T5-BUS1')).toBeUndefined();
		expect(trip('01-TRN--1-T0-8003')).toBeUndefined();
	});

	it('keeps outbound V/Line on P4 and drops set-down-only citybound V/Line', () => {
		expect(trip('01-GEL--1-T0-8001')).toMatchObject({
			platform: 4,
			mode: 'vline',
			headsign: 'Waurn Ponds'
		});
		expect(mon.patterns[trip('01-GEL--1-T0-8001')!.pattern]).toEqual(['Tarneit', 'Waurn Ponds']);
		expect(trip('01-GEL--1-T0-8002')).toBeUndefined();
	});
});
