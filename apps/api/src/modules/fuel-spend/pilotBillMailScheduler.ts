import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { graphConfigFromEnv, graphRequester } from "../../lib/graphMail.js";
import { graphFolderReader } from "../../lib/graphFolder.js";
import { readPdfWords } from "../../lib/pdfWords.js";
import { ingestFuelStatement, STATEMENT_BUCKET } from "./fuelStatementIngest.js";
import { runFuelReconciliation } from "./fuelReconRun.js";
import { PILOT_BILL_FOLDER, refusedPdfPath, runPilotBillMail } from "./pilotBillMail.js";

/**
 * Every hour, read the `Pilot-Bills` folder and record any new weekly bill (PILOT-INVOICE-FORMAT-ANALYSIS §4).
 *
 * ── WHICH SETTINGS, AND WHY NO NEW ONES ──────────────────────────────────────────────────────────────
 * The same mailbox and org as the Pilot price pull (`pilotPriceMailScheduler.ts` has the argument): `EFS_GRAPH_*`
 * for miki@ and `EFS_INGEST_ORG_ID` for the org that owns it, both already set on production and staging.
 * Without either the pull is off and says so once at boot. Only reading is used; the mailbox is never changed.
 *
 * One bill a week, arriving Monday afternoons, so an hour is plenty: the folder listing is one Graph call per
 * tick, and nothing is downloaded unless an email has work left (`billNeedsWork`).
 *
 * Runs in the scheduler lane "general" (schedulers.ts): one process fleet-wide holds that lane's lease, so two
 * servers never both record — and a second recording of the same bytes would settle as `duplicate` anyway.
 */
const INTERVAL_MS = 60 * 60_000;

export function startPilotBillMailScheduler(env: Env): () => void {
  const graph = graphConfigFromEnv(env);
  const orgId = env.EFS_INGEST_ORG_ID;
  if (!graph || !orgId || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log(
      `[pilot-bill-mail] off — needs ${[!graph && "EFS_GRAPH_*", !orgId && "EFS_INGEST_ORG_ID", (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) && "Supabase"].filter(Boolean).join(", ")}`,
    );
    return () => {};
  }
  const reader = graphFolderReader(graphRequester(graph));
  let running = false;
  const tick = async () => {
    if (running) return; // an 88-page bill takes seconds to read; never overlap the next tick
    running = true;
    try {
      const admin = getSupabaseAdmin(env);
      const r = await runPilotBillMail(admin, orgId, {
        reader,
        readWords: (bytes) => readPdfWords(bytes),
        // No user: the uploader is the pull. `uploaded_by` and `created_by` stay null, which is what they mean.
        ingest: (words, filename, bytes) =>
          ingestFuelStatement(admin, orgId, null, { words, filename, sourceBase64: bytes.toString("base64") }),
        check: async (words, filename, statementId) => {
          const c = await runFuelReconciliation(admin, orgId, null, { words, grid: null, pivotGrid: null, filename, statementId });
          return c.ok ? { runId: c.runId } : { error: [c.error, ...(c.tieOutFailures ?? [])].filter(Boolean).join(" ") };
        },
        keepRefused: async (sha, bytes) => {
          const { error } = await admin.storage
            .from(STATEMENT_BUCKET)
            .upload(refusedPdfPath(orgId, sha), bytes, { contentType: "application/pdf", upsert: true });
          if (error) throw new Error(error.message);
        },
        now: () => new Date(),
      });
      if (r.recorded || r.duplicate || r.refused || r.failed || r.noPdf) {
        console.log(
          `[pilot-bill-mail] recorded ${r.recorded}, duplicate ${r.duplicate}, refused ${r.refused}, failed ${r.failed}, no pdf ${r.noPdf} (of ${r.listed} in the folder)`,
        );
      }
      if (r.refused || r.failed) console.error(`[pilot-bill-mail] ${r.refused + r.failed} bill email(s) not recorded — see pilot_bill_mails.error`);
    } catch (e) {
      console.error("[pilot-bill-mail] run FAILED:", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  const boot = setTimeout(tick, 120_000);
  const timer = setInterval(tick, INTERVAL_MS);
  console.log(`[pilot-bill-mail] on — folder "${PILOT_BILL_FOLDER}", every ${INTERVAL_MS / 60_000} min`);
  return () => {
    clearTimeout(boot);
    clearInterval(timer);
  };
}
