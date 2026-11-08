import type { Departure } from './footscray';

/** Minutes until departure as the station screens show it: "Now", "1 min", "12 min". */
export function minutesLabel(d: Departure, nowSec: number): string {
	const mins = Math.floor((d.estimated - nowSec) / 60);
	return mins <= 0 ? 'Now' : `${mins} min`;
}

/** Departures still worth showing at `nowSec` (the board is fetched every 30 s; this trims in between). */
export function upcoming(list: Departure[], nowSec: number): Departure[] {
	return list.filter((d) => (d.cancelled ? d.scheduled : d.estimated) >= nowSec - 30);
}

/** Late by at least a minute (shown as a small hint next to the time). */
export function lateBy(d: Departure): number {
	return Math.floor((d.estimated - d.scheduled) / 60);
}

export function stoppingText(stops: string[], destination: string): string {
	if (!stops.length) return '';
	if (stops.length === 1) return `Stops at ${stops[0]} only`;
	const rest = stops.at(-1) === destination ? stops : [...stops, destination];
	return `Stops at ${rest.slice(0, -1).join(', ')} and ${rest.at(-1)}`;
}
