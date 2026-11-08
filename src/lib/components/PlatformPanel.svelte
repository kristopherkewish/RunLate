<script lang="ts">
	import type { Departure, LineInfo } from '../footscray';
	import { clock } from '../time';
	import { lateBy, minutesLabel, stoppingText, upcoming } from '../display';
	import Ticker from './Ticker.svelte';

	let {
		platform,
		departures,
		lines,
		now
	}: {
		platform: number;
		departures: Departure[];
		lines: Record<string, LineInfo>;
		now: number;
	} = $props();

	const shown = $derived(upcoming(departures, now));
	const next = $derived(shown[0]);
	const rest = $derived(shown.slice(1));
	const color = (d: Departure | undefined) => (d ? (lines[d.line]?.color ?? '#666') : '#333');

	// Show as many follow-on rows as fit without clipping.
	let list = $state<HTMLElement>();
	let fit = $state(3);
	$effect(() => {
		if (!list) return;
		const measure = () => {
			const row = list!.querySelector<HTMLElement>('.row');
			if (!row) return;
			const pitch = row.offsetHeight + parseFloat(getComputedStyle(row).marginBottom || '0');
			const pad = parseFloat(getComputedStyle(list!).paddingTop || '0') * 2;
			// The last row doesn't need its bottom margin.
			const usable =
				list!.clientHeight - pad + parseFloat(getComputedStyle(row).marginBottom || '0');
			fit = Math.max(1, Math.floor(usable / pitch));
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(list);
		return () => ro.disconnect();
	});
</script>

<section class="panel" style:--line={color(next)} aria-label="Platform {platform}">
	<header class="plat">
		<span class="plat-label">Platform</span>
		<span class="plat-num">{platform}</span>
	</header>

	{#if next}
		<div class="next" class:cancelled={next.cancelled}>
			<div class="next-time">
				{clock(next.scheduled)}
				{#if !next.cancelled && lateBy(next) >= 2}<span class="late">+{lateBy(next)}</span>{/if}
			</div>
			<div class="next-dest">
				<div class="dest">{next.destination}</div>
				{#if next.via}<div class="via">via {next.via}</div>{/if}
			</div>
			<div class="next-min">
				{#if next.cancelled}<span class="cancel-tag">Cancelled</span>{:else}{minutesLabel(
						next,
						now
					)}{/if}
			</div>
		</div>
		<div class="pattern">
			{#if next.cancelled}
				<span class="cancel-text">This train has been cancelled</span>
			{:else if next.stops.length}
				<Ticker text={stoppingText(next.stops, next.destination)} />
			{/if}
		</div>
	{:else}
		<div class="next empty"><div class="dest">No departures</div></div>
		<div class="pattern"></div>
	{/if}

	<ol class="rest" bind:this={list}>
		{#each rest as d, i (d.id)}
			<li class="row" class:cancelled={d.cancelled} class:hidden={i >= fit} style:--line={color(d)}>
				<span class="r-time">{clock(d.scheduled)}</span>
				<span class="r-dest">{d.destination}</span>
				<span class="r-min">{d.cancelled ? 'Cancelled' : minutesLabel(d, now)}</span>
			</li>
		{/each}
	</ol>
</section>

<style>
	.panel {
		container-type: inline-size;
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--panel);
		border-left: 0.5rem solid var(--line);
		overflow: hidden;
	}
	.plat {
		display: flex;
		align-items: baseline;
		gap: 0.4em;
		padding: 0.35em 0.8em;
		background: var(--panel-head);
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-size: clamp(0.8rem, 3.2cqi, 1.4rem);
	}
	.plat-num {
		color: var(--fg);
		font-weight: 800;
		font-size: 1.5em;
	}
	.next {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 0 0.6em;
		padding: 0.4em 0.6em 0.1em;
		font-size: clamp(1.1rem, 5.6cqi, 3.4rem);
	}
	.next-time {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.late {
		font-size: 0.5em;
		color: var(--warn);
		margin-left: 0.15em;
		vertical-align: super;
	}
	.dest {
		font-weight: 800;
		line-height: 1.05;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.next-dest {
		min-width: 0;
	}
	.via {
		font-size: 0.45em;
		color: var(--muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.next-min {
		font-weight: 800;
		color: var(--accent);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.pattern {
		min-height: 1.6em;
		padding: 0.15em 0.8em 0.4em;
		font-size: clamp(0.85rem, 3.2cqi, 1.6rem);
		color: var(--fg);
		border-bottom: 2px solid var(--line);
	}
	.cancelled .dest,
	.cancelled .next-time,
	.row.cancelled .r-dest,
	.row.cancelled .r-time {
		text-decoration: line-through;
		text-decoration-thickness: 0.08em;
		opacity: 0.6;
	}
	.cancel-tag,
	.cancel-text,
	.row.cancelled .r-min {
		color: var(--bad);
	}
	.rest {
		flex: 1;
		min-height: 0;
		margin: 0;
		padding: 0.2em 0;
		list-style: none;
		overflow: hidden;
		font-size: clamp(0.95rem, 3.8cqi, 2rem);
	}
	.row {
		display: grid;
		grid-template-columns: 3.4em 1fr auto;
		gap: 0.6em;
		align-items: center;
		padding: 0.22em 0.8em 0.22em 0.6em;
		border-left: 0.25em solid var(--line);
		margin-left: 0.4em;
		margin-bottom: 0.15em;
	}
	.row.hidden {
		display: none;
	}
	.r-time {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.r-dest {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.r-min {
		font-weight: 700;
		color: var(--accent);
		font-variant-numeric: tabular-nums;
	}
	.empty .dest {
		color: var(--muted);
		font-weight: 600;
		grid-column: 1 / -1;
	}

	/* Phones: the page scrolls, so give each panel a fixed number of follow-on rows. */
	@media (max-width: 700px) {
		.rest {
			flex: none;
			height: calc(3 * 1.85em);
		}
	}
</style>
