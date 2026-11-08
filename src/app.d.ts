// See https://svelte.dev/docs/kit/types#app.d.ts
// Worker bindings and secrets (ASSETS, PTV_GTFSR_KEY) are typed in
// worker-configuration.d.ts (`npm run gen`) and read via `cloudflare:workers`.
declare global {
	namespace App {}
}

export {};
