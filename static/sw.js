// Minimal service worker: makes the board installable and lets it open
// offline (the page then shows its last saved board with a stale warning).
//
// - Page navigations: network first, fall back to the cached page.
// - /_app/immutable/*: cache first (file names are content-hashed).
// - Fonts, icons, manifest: stale-while-revalidate.
// - /api/* and /timetable/*: never cached here (always live).

const SHELL = 'runlate-shell-v1';
const ASSETS = 'runlate-assets-v1';
const KEEP = [SHELL, ASSETS];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(SHELL)
			.then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg']))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin) return;
	if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/timetable/')) return;

	if (req.mode === 'navigate') {
		event.respondWith(
			fetch(req)
				.then((res) => {
					if (res.ok) {
						const copy = res.clone();
						caches.open(SHELL).then((c) => c.put('/', copy));
					}
					return res;
				})
				.catch(() => caches.match('/').then((r) => r || Response.error()))
		);
		return;
	}

	if (url.pathname.startsWith('/_app/immutable/')) {
		event.respondWith(
			caches.match(req).then(
				(hit) =>
					hit ||
					fetch(req).then((res) => {
						if (res.ok) {
							const copy = res.clone();
							caches.open(ASSETS).then((c) => c.put(req, copy));
						}
						return res;
					})
			)
		);
		return;
	}

	event.respondWith(
		caches.match(req).then((hit) => {
			const network = fetch(req)
				.then((res) => {
					if (res.ok) {
						const copy = res.clone();
						caches.open(ASSETS).then((c) => c.put(req, copy));
					}
					return res;
				})
				.catch(() => hit || Response.error());
			return hit || network;
		})
	);
});
