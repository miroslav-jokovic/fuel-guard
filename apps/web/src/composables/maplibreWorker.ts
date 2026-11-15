/**
 * maplibre 6 no longer inlines its worker: it loads `maplibre-gl-worker.mjs` from beside its own module
 * file. A bundler moves that module into a hashed chunk and leaves the worker behind — the first build of
 * the upgrade (2026-11-15) had no worker file in `dist/assets` at all, which is a map that never draws a
 * tile, in production only. `?url` makes Vite emit the file and hand back its address.
 * `e2e-apply/liveMap.spec.ts` is the test that fails without it.
 *
 * Its own file because `useMapLibre.ts` sits at its 500-line budget; every map goes through that composable,
 * so this is set in exactly one place.
 */
import url from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

export const MAPLIBRE_WORKER_URL: string = url;
