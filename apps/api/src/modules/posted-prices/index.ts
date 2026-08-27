/**
 * posted-prices — the posted-fuel-price collector, carved 2026-08-27 (program step P1.5,
 * D-SEP12, docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md; replaces the phantom
 * `manual-uploads` collector ARCHITECTURE.md §2 struck the same day).
 *
 * One module per source family: Pilot/Flying J (public price table + XLSX report + locations
 * export), Love's (Auth0-authenticated Experience API + XLSX export), Kwik Trip (store list),
 * Road Ranger (public page scrape). Owns the collected price tables — `fuel_prices` (Pilot
 * cash/credit report rows) and `fuel_prices_posted` (the cross-brand posted board) — both
 * raw-layer in scripts/table-modules.json: frozen at ingest, priced-day derivation stays in
 * `fuel` (`fuel_price_days`).
 *
 * Named debt, inherited knowingly: the scrapers upsert `fuel_stations` (fuel-owned core)
 * directly — the same collector→core direct-write posture mcleod has today. The owner-interface
 * pass (a fuel station-upsert API) is program burn-down work (P6.1); the five write sites are
 * pinned in scripts/table-writers.json and grandfathered by name in check-table-modules.mjs
 * until then.
 */
export { startPostedPriceScheduler, gatePostedBatch, runPostedPriceFetch, POSTED_SOURCE_XLSX } from "./postedPriceFetch.js";
export { ingestPostedPrices } from "./postedPriceIngest.js";
export { ingestPilotPrices } from "./pilotPriceIngest.js";
export { ingestPilotLocations } from "./pilotLocationsIngest.js";
export { runKwikTripSync } from "./kwikTripIngest.js";
export { runRoadRangerFetch } from "./roadRangerIngest.js";
export { ingestLovesExport, upsertLoves } from "./lovesIngest.js";
export { runLovesApiSync } from "./lovesApiClient.js";
export { registerNetworkRoutes } from "./routes/networks.js";
