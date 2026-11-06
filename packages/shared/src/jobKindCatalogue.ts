/**
 * What each background job is, in the office's words (E5, the failed-jobs card; ADS-RUNBOOK Gap 2;
 * 2026-11-06). The ONE place a job kind gets a human name: Settings › Data & sync's "Failed background
 * jobs" reads it, and nothing else may restate it. The kinds themselves are the API's `JobKind`
 * (`apps/api/src/modules/org/jobs.ts`). `jobKindCatalogue.test.ts` there fails the build when a kind has no
 * entry here, or an entry names no kind.
 *
 *   label  what the job does, as a sentence's subject ("Reading ad spend from Meta").
 *   area   which part of the product it belongs to, for grouping and for who to ask.
 *   item   the payload key naming the one thing the job was for, and what to call it, when the job names one.
 *   hint   what usually causes a failure and what to do, for the kinds an office person is expected to act on.
 *          Written from the code that runs the job; the ads ones from `docs/plans/recruitment/ADS-RUNBOOK.md`.
 */

export type JobArea = "fuel" | "telematics" | "efs" | "documents" | "compliance" | "finance" | "maintenance" | "recruiting" | "ads" | "platform";

export interface JobKindEntry {
  label: string;
  area: JobArea;
  item?: { key: string; noun: string };
  hint?: string;
}

export const JOB_AREA_LABELS: Record<JobArea, string> = {
  fuel: "Fuel", telematics: "Samsara", efs: "EFS fuel cards", documents: "Documents", compliance: "Compliance",
  finance: "Finance", maintenance: "Maintenance", recruiting: "Recruiting", ads: "Recruiting ads", platform: "System",
};

const ADS_CONNECTION_HINT =
  "Usually Meta was unreachable or the ad account connection stopped working. It runs again by itself; if it keeps failing, test the connection on Settings › Ads control.";

export const JOB_KIND_CATALOGUE = {
  rebuild: { label: "Rebuilding fuel scores", area: "fuel" },
  backfill: { label: "Back-filling fuel history", area: "fuel" },
  score_import: { label: "Scoring imported fuel purchases", area: "fuel" },
  score_declined_import: { label: "Scoring imported declined purchases", area: "fuel" },
  rescore_declined: { label: "Re-scoring declined purchases", area: "fuel" },
  score_txn: { label: "Scoring one fuel purchase", area: "fuel" },
  efs_store_sync: { label: "Repairing the EFS purchase store", area: "efs" },
  sync_vehicles: { label: "Syncing trucks from Samsara", area: "telematics" },
  sync_trailers: { label: "Syncing trailers from Samsara", area: "telematics" },
  sync_idle: { label: "Syncing idling from Samsara", area: "telematics" },
  idle_event_twins: { label: "Cleaning up doubled idle events", area: "telematics" },
  sync_ifta: { label: "Syncing IFTA miles from Samsara", area: "telematics" },
  sync_documents: { label: "Syncing driver documents from Samsara", area: "documents" },
  sync_odometer: { label: "Syncing odometer readings from Samsara", area: "telematics" },
  idle_engine: { label: "Working out idle hours and stops", area: "telematics" },
  sync_hos: { label: "Syncing hours of service from Samsara", area: "telematics" },
  sync_stats: { label: "Syncing truck readings from Samsara", area: "telematics" },
  sync_drivers: { label: "Syncing drivers from Samsara", area: "telematics" },
  nightly_reconcile: { label: "Nightly fuel check against telematics", area: "fuel" },
  efs_ingest: { label: "Importing EFS purchases", area: "efs" },
  efs_soap_posted: { label: "Reading posted EFS purchases", area: "efs" },
  efs_soap_rejected: { label: "Reading declined EFS purchases", area: "efs" },
  efs_window_refetch: { label: "Re-reading an EFS time window", area: "efs" },
  efs_process_import: { label: "Processing an EFS import file", area: "efs" },
  efs_card_sync: { label: "Syncing EFS cards", area: "efs" },
  efs_card_status: { label: "Changing an EFS card's status", area: "efs" },
  sync_driver_scores: { label: "Syncing driver scores", area: "telematics" },
  snapshot_driver_week: { label: "Saving the week's driver scores", area: "telematics" },
  hazmat_extract: { label: "Reading a hazmat shipping paper", area: "compliance" },
  hazmat_analyze: { label: "Checking a hazmat load", area: "compliance" },
  document_read: { label: "Reading a document", area: "documents" },
  document_intake: { label: "Filing a scanned document", area: "documents" },
  pattern_sweep: { label: "Looking for fuel patterns across cases", area: "fuel" },
  data_retention: { label: "Removing data past its keep date", area: "platform" },
  dq_binder: { label: "Building a driver-file binder", area: "compliance" },
  document_derive: { label: "Preparing a document's preview", area: "documents" },
  financial_projection: { label: "Loading McLeod financials", area: "finance" },
  fuel_spend_rollup: { label: "Totalling daily fuel spend", area: "fuel" },
  fleetpal_sync: { label: "Syncing repairs from FleetPal", area: "maintenance" },
  medstop_sync: { label: "Syncing drug test results from Med-Stop", area: "compliance" },
  ads_step: {
    label: "Moving an ad campaign to its next step", area: "ads", item: { key: "campaignId", noun: "Campaign" },
    hint: "A step the ads agent could not finish: writing the ad, putting it on Meta, launching or pausing it. The campaign shows what went wrong; it is tried again on the next pass.",
  },
  ads_rules_sync: {
    label: "Copying the ads spending limits into Meta", area: "ads",
    hint: "Meta's own automatic pauses were not updated, so they still hold the limits saved before. Save Settings › Ads control again once the connection works.",
  },
  ads_leads_backfill: {
    label: "Bringing in new leads from Meta", area: "ads", item: { key: "connectionId", noun: "Ad account" },
    hint: `${ADS_CONNECTION_HINT} No lead is lost: the next run that works reaches back for the ones it missed.`,
  },
  ads_lead_fetch: {
    label: "Reading one new lead from Meta", area: "ads", item: { key: "leadgenId", noun: "Meta lead" },
    hint: `${ADS_CONNECTION_HINT} The hourly lead check brings this lead in once Meta answers.`,
  },
  ads_insights: {
    label: "Reading ad spend from Meta", area: "ads", item: { key: "connectionId", noun: "Ad account" },
    hint: `${ADS_CONNECTION_HINT} While it fails, our automatic pauses cannot see the newest spend; Meta's own pauses still run.`,
  },
  ads_reconcile: {
    label: "Checking the ad account against our records", area: "ads", item: { key: "connectionId", noun: "Ad account" },
    hint: `${ADS_CONNECTION_HINT} Nothing is changed by this check, so a failure only delays its alerts.`,
  },
  ads_daily_brief: { label: "Writing the morning ads brief", area: "ads", hint: "The brief did not arrive this morning. Spend and leads are still recorded; tomorrow's brief covers its own day." },
  lead_uncontacted: { label: "Finding leads nobody has called yet", area: "recruiting" },
  ads_render: {
    label: "Drawing an ad picture", area: "ads", item: { key: "creativeId", noun: "Ad" },
    hint: "The picture service failed or this month's picture credits ran out (Settings › Ads control, AI and pictures). The ad can be regenerated.",
  },
  storage_backup: { label: "Backing up stored files", area: "platform" },
} as const satisfies Record<string, JobKindEntry>;

export type CataloguedJobKind = keyof typeof JOB_KIND_CATALOGUE;

/** A kind's entry; a kind this build does not know (a newer server) is named by its own key, never hidden. */
export function jobKindEntry(kind: string): JobKindEntry {
  return (JOB_KIND_CATALOGUE as Record<string, JobKindEntry>)[kind] ?? { label: kind.replace(/_/g, " "), area: "platform" };
}

/** The one thing a job was for, when its kind names one and its payload holds it. */
export function jobItem(kind: string, payload: unknown): { noun: string; id: string } | null {
  const item = jobKindEntry(kind).item;
  if (!item || !payload || typeof payload !== "object") return null;
  const id = (payload as Record<string, unknown>)[item.key];
  return typeof id === "string" && id.trim() !== "" ? { noun: item.noun, id } : null;
}
