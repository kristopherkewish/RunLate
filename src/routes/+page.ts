// The page has no server data (it fetches /api/board itself), so it can be a
// static file — which is also what the service worker serves offline.
export const prerender = true;
