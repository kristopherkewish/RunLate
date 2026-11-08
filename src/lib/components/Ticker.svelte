<script lang="ts">
	// Stopping-pattern style ticker: if the text doesn't fit, it holds at the
	// start so it can be read, scrolls to the end, holds, then repeats.
	let { text, speed = 60 }: { text: string; speed?: number } = $props();

	let outer = $state<HTMLElement>();
	let inner = $state<HTMLElement>();
	let overflow = $state(0);

	$effect(() => {
		void text;
		if (!outer || !inner) return;
		const measure = () => (overflow = inner!.scrollWidth - outer!.clientWidth);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(outer);
		ro.observe(inner);
		return () => ro.disconnect();
	});

	// 15% hold, 70% scroll, 15% hold.
	const scrolling = $derived(overflow > 2);
	const total = $derived(scrolling ? Math.max(6, overflow / speed / 0.7) : 0);
</script>

<div class="ticker" bind:this={outer}>
	<span
		class="inner"
		class:scrolling
		bind:this={inner}
		style:--distance="-{overflow + 8}px"
		style:--duration="{total}s">{text}</span
	>
</div>

<style>
	.ticker {
		overflow: hidden;
		white-space: nowrap;
	}
	.inner {
		display: inline-block;
	}
	.scrolling {
		animation: scroll var(--duration) linear infinite;
	}
	@keyframes scroll {
		0%,
		15% {
			transform: translateX(0);
		}
		85%,
		100% {
			transform: translateX(var(--distance));
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.scrolling {
			animation: none;
		}
		.ticker {
			white-space: normal;
		}
	}
</style>
