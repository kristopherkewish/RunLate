<script lang="ts">
	import { onMount } from 'svelte';
	import type { Board } from '../lib/footscray';
	import { clock } from '../lib/time';
	import PlatformPanel from '../lib/components/PlatformPanel.svelte';
	import Ticker from '../lib/components/Ticker.svelte';

	const POLL_MS = 30_000;
	const STALE_S = 120;
	const CACHE_KEY = 'runlate:board';

	let board = $state<Board | null>(null);
	/** When we last got a board from the server (epoch seconds). */
	let lastOk = $state(0);
	let now = $state(Math.floor(Date.now() / 1000));
	let failed = $state(false);

	function save(b: Board, at: number) {
		try {
			localStorage.setItem(CACHE_KEY, JSON.stringify({ at, board: b }));
		} catch {
			/* storage unavailable: fine, just no offline copy */
		}
	}

	function restore() {
		try {
			const raw = localStorage.getItem(CACHE_KEY);
			if (!raw) return;
			const { at, board: b } = JSON.parse(raw);
			if (b?.platforms) {
				board = b;
				lastOk = at;
			}
		} catch {
			/* ignore a corrupt or blocked cache */
		}
	}

	async function refresh() {
		try {
			const res = await fetch('/api/board', { cache: 'no-store' });
			if (!res.ok) throw new Error(String(res.status));
			const b: Board = await res.json();
			board = b;
			lastOk = Math.floor(Date.now() / 1000);
			failed = false;
			save(b, lastOk);
		} catch {
			failed = true;
		}
	}

	onMount(() => {
		restore();
		refresh();
		const poll = setInterval(refresh, POLL_MS);
		const tick = setInterval(() => (now = Math.floor(Date.now() / 1000)), 1000);
		const onVisible = () => document.visibilityState === 'visible' && refresh();
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(poll);
			clearInterval(tick);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	const metro = $derived(board?.platforms.filter((p) => p.mode === 'metro') ?? []);
	const vline = $derived(board?.platforms.filter((p) => p.mode === 'vline') ?? []);
	const staleFor = $derived(lastOk ? now - lastOk : 0);
	const alertText = $derived(
		board?.alerts
			.map((a) => (a.description ? `${a.header}: ${a.description}` : a.header))
			.join('   •   ') ?? ''
	);
	const agoText = (s: number) => (s < 120 ? `${s} s` : `${Math.floor(s / 60)} min`);
</script>

<svelte:head>
	<title>Footscray departures</title>
	<meta name="description" content="Live train departures from Footscray station" />
</svelte:head>

<div class="board">
	<header class="top">
		<h1>Footscray</h1>
		<div class="clock" aria-label="Current time">{clock(now)}</div>
	</header>

	{#if board && staleFor > STALE_S}
		<div class="notice warn" role="status">
			No connection — last updated {agoText(staleFor)} ago. Times may be out of date.
		</div>
	{:else if board && !board.live}
		<div class="notice warn" role="status">Live data unavailable — showing timetabled times.</div>
	{/if}

	{#if alertText}
		<div class="notice alert" role="status"><Ticker text={alertText} speed={80} /></div>
	{/if}

	{#if board}
		<main class="grid">
			<div class="metro">
				{#each metro as p (p.platform)}
					<PlatformPanel
						platform={p.platform}
						departures={p.departures}
						lines={board.lines}
						{now}
					/>
				{/each}
			</div>
			<div class="vline">
				<h2>V/Line</h2>
				{#each vline as p (p.platform)}
					<PlatformPanel
						platform={p.platform}
						departures={p.departures}
						lines={board.lines}
						{now}
					/>
				{/each}
			</div>
		</main>
	{:else}
		<main class="loading">
			{failed ? 'Can’t reach the departures service. Retrying…' : 'Loading departures…'}
		</main>
	{/if}
</div>

<style>
	.board {
		height: 100dvh;
		display: flex;
		flex-direction: column;
		gap: var(--gap);
		padding: var(--gap);
		box-sizing: border-box;
	}
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.2em 0.6em;
		background: var(--brand);
		color: #fff;
		font-size: clamp(1.1rem, 2.4vw, 2.6rem);
	}
	h1 {
		margin: 0;
		font-size: 1em;
		font-weight: 800;
		letter-spacing: 0.01em;
	}
	.clock {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.notice {
		padding: 0.4em 0.8em;
		font-size: clamp(0.9rem, 1.4vw, 1.5rem);
		font-weight: 600;
	}
	.warn {
		background: var(--warn);
		color: #000;
	}
	.alert {
		background: var(--alert-bg);
		color: var(--alert-fg);
	}
	.grid {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 2fr 1fr;
		gap: var(--gap);
	}
	.metro {
		display: grid;
		/* P1/P2 (Sunbury) on the left, P5/P6 (Werribee/Williamstown) on the right. */
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
		grid-auto-flow: column;
		gap: var(--gap);
		min-height: 0;
	}
	.vline {
		display: flex;
		flex-direction: column;
		gap: var(--gap);
		min-height: 0;
	}
	.vline > :global(.panel) {
		flex: 1;
	}
	h2 {
		margin: 0;
		padding: 0.25em 0.6em;
		background: var(--vline);
		color: #fff;
		font-size: clamp(1rem, 1.6vw, 1.8rem);
		font-weight: 800;
	}
	.loading {
		flex: 1;
		display: grid;
		place-items: center;
		color: var(--muted);
		font-size: 1.4rem;
	}

	/* Tablets / portrait screens: metro 2x2 on top, V/Line full width below. */
	@media (max-width: 1100px) {
		.grid {
			grid-template-columns: 1fr;
			grid-template-rows: 2fr 1fr;
		}
	}

	/* Phones: everything stacks and the page scrolls. */
	@media (max-width: 700px) {
		.board {
			height: auto;
			min-height: 100dvh;
		}
		.grid {
			display: flex;
			flex-direction: column;
		}
		.metro {
			display: flex;
			flex-direction: column;
		}
	}
</style>
