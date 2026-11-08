<script lang="ts">
	import '@fontsource/public-sans/400.css';
	import '@fontsource/public-sans/600.css';
	import '@fontsource/public-sans/700.css';
	import '@fontsource/public-sans/800.css';
	import '../app.css';
	import { onMount } from 'svelte';
	import { dev } from '$app/env';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	onMount(() => {
		if (!dev && 'serviceWorker' in navigator) {
			navigator.serviceWorker.register('/sw.js').catch(() => {
				/* offline support is a bonus; the board works without it */
			});
		}
	});
</script>

<svelte:head>
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="icon" href="/icon.svg" type="image/svg+xml" />
	<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<meta name="theme-color" content="#000000" />
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
</svelte:head>

{@render children()}
