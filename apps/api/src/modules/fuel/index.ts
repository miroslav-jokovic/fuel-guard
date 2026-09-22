/**
 * fuel — the canonical fuel record, third core-store module (docs/ARCHITECTURE.md §3, carved
 * 2026-08-27).
 *
 * The audit that started the re-founding measured `fuel_transactions` written from 35 files with
 * no owner; this module is the answer. It owns the canonical fuel tables — `fuel_transactions`,
 * `fuel_events`, `declined_transactions`, `fuel_cards`, `fuel_stations`,
 * `station_geocode_learned`, and the price family (`fuel_prices`, `fuel_prices_posted`,
 * `fuel_price_days`, `fuel_discount_rules`) — and the machinery that keeps them canonical:
 * station resolution and geocode learning, fill-weather backfill, card↔driver attribution,
 * decline-driver resolution, the posted-price ingests (Pilot, Love's, Road Ranger, Kwik Trip)
 * with their fetch scheduler, the price-day derivation, and the transactions API route.
 *
 * The remaining outside writers are the drawn arrows, each through an interface or pinned:
 * `efs` ingests into `fuel_transactions` (collector→core, manifest-pinned since its carve-out)
 * and resolves decline drivers through this index; `fuel-spend` resolves stations for its
 * report; `idle` derives price days after its rollup. `scoring/*` still writes
 * `fuel_transactions` flags from `services/` — that seam belongs to the `anomalies` carve-out.
 */
export { transactionsRouter } from "./routes/transactions.js";
export { resolveDeclineDrivers } from "./declineDriverResolution.js";
export { resolveFuelTransactionStations } from "./fuelStationResolve.js";
export { syncFuelPriceDays } from "./fuelPriceDaySync.js";
export { backfillFillWeather } from "./fillWeather.js";
export { syncCardAssignments, lookupCardAssignment } from "./cardAssignments.js";
export { attributeDrivers } from "./driverAttribution.js";
export { learnStationGeocodes } from "./stationGeocodeLearning.js";
export { registerDiscountRuleRoutes } from "./routes/discountRules.js";
export { registerFuelExportRoutes } from "./routes/exports.js";
export { FUEL_EVENT_DROP, FUEL_EVENT_DROP_UNVERIFIED } from "./fuelEventTypes.js";
/**
 * The declined-attempt count, exposed because `declined_transactions` is raw-layer and sealed here:
 * the dashboard endpoint asks this module rather than reading the table (queue item 5, §7.2b).
 */
export { countDeclinedAttempts } from "./declinedCount.js";
/**
 * "Which trucks have bought diesel lately?" — asked by the McLeod roster sweep before it retires
 * anything, because a truck that is fuelling has not been sold (F14). Exposed here rather than read
 * across: `fuel_transactions` is this module's table.
 */
export { readRecentlyFuelledVehicleIds, type RecentFuelResult } from "./recentFuelReads.js";
