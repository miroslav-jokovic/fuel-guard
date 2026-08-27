/**
 * maintenance — its own section, built ahead of its collector (program step P5.3, D-SEP8 —
 * the owner's 2026-08-27 ruling: separate section in architecture and policies now, FleetPal
 * data and custom features later). Owns no tables yet.
 *
 * THE FLEETPAL DEDUP CONTRACT, written here first as D-SEP8 requires: when the FleetPal
 * collector lands, every work-order expense it projects into financial_entries MUST carry a
 * dedup_key of the form `maint:<vendor-invoice-or-wo-ref>` computed identically for the McLeod
 * AP voucher that bills the same work — so 0257's canonical index, not reviewer vigilance, is
 * what keeps one wrench from being paid twice. A FleetPal ingest PR that cannot state its
 * dedup_key mapping against the AP side does not merge.
 */
export { maintenanceRouter } from "./routes/index.js";
