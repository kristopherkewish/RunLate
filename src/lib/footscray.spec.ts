import { describe, expect, it } from 'vitest';
import { lineFromRouteId, platformFor, splitHeadsign } from './footscray';

describe('platformFor (Footscray platforms are fixed by line and direction)', () => {
	it.each([
		['metro', 'SUY', 1, 1],
		['metro', 'SUY', 0, 2],
		['metro', 'WER', 1, 5],
		['metro', 'WER', 0, 6],
		['metro', 'WIL', 1, 5],
		['metro', 'WIL', 0, 6],
		['vline', 'GEL', 0, 4],
		['vline', 'BGO', 0, 4],
		['vline', 'BAT', 0, 4]
	] as const)('%s %s dir %i -> P%i', (mode, line, dir, platform) => {
		expect(platformFor(mode, line, dir)).toBe(platform);
	});

	it('hides citybound V/Line (set-down only on P3)', () => {
		expect(platformFor('vline', 'GEL', 1)).toBeNull();
	});

	it('ignores lines that do not run through Footscray', () => {
		expect(platformFor('metro', 'CGB', 1)).toBeNull();
		expect(platformFor('vline', 'TRN', 0)).toBeNull();
	});
});

describe('lineFromRouteId', () => {
	it('extracts the line code', () => {
		expect(lineFromRouteId('aus:vic:vic-02-SUY:')).toBe('SUY');
		expect(lineFromRouteId('aus:vic:vic-01-GEL:')).toBe('GEL');
	});
	it('rejects replacement bus routes', () => {
		expect(lineFromRouteId('aus:vic:vic-02-SUY-R:')).toBeNull();
	});
});

describe('splitHeadsign', () => {
	it('splits "via"', () => {
		expect(splitHeadsign('Cranbourne via Metro Tunnel')).toEqual(['Cranbourne', 'Metro Tunnel']);
		expect(splitHeadsign('Werribee')).toEqual(['Werribee', null]);
	});
});
