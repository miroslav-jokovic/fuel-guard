/**
 * mcleod — the McLeod LoadMaster collector, second module of the 2026-08-26 re-founding
 * (D-ARC1, docs/ARCHITECTURE.md §2).
 *
 * Everything that receives from the carrier-side McLeod agent lives here: the ingest routes the
 * agent posts to, roster identity ingestion with provenance (drivers/vehicles/trailers, the
 * merge/match/retire machinery), movement and load ingestion, and the integration on/off status.
 * Owns `tms_movements` and `load_external_payloads`; roster writes flow into `roster`-owned
 * tables through the set-based RPCs (0174/0175 pattern), which is why they appear in no
 * `.from()` writer manifest. The financial-store ingestion (FINANCIAL-STORE-PLAN —
 * `mcleod_settlements`, `mcleod_ap_vouchers`, `mcleod_billing` → `financial_entries`) is owed to
 * this module and builds INSIDE it, which is half the reason it was carved now.
 *
 * `isTmsRosterMaster` is exported for the three Samsara syncs: when McLeod masters the roster,
 * Samsara defers on identity fields. That is a real cross-collector rule, not a leak — it goes
 * through this interface so the day it changes, one export records who depended on it.
 */
export { tmsIngestRouter } from "./routes/tmsIngest.js";
export { tmsRosterMasterRouter } from "./routes/tmsRosterMaster.js";
export { isTmsRosterMaster } from "./rosterMastery.js";
export { getTmsIntegrationStatus, enableTmsIntegration, disableTmsIntegration } from "./tmsIngest.js";
export { registerMcleodIntegrationRoutes } from "./routes/integration.js";
export {
  readSettlementsWindow,
  readApVouchersWindow,
  readBillingWindow,
  readLedgerTotals,
  readMovementsWindow,
  type StagedMovement,
  type StagedSettlement,
  type StagedVoucher,
  type StagedBilling,
  type StagedGlTotal,
} from "./financialReads.js";
