import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { graphConfigFromEnv, graphRequester } from "../../lib/graphMail.js";
import { graphFolderReader } from "../../lib/graphFolder.js";
import { ingestPilotPrices } from "./pilotPriceIngest.js";
import { downloadPilotQuote } from "./pilotQuoteDownload.js";
import { PILOT_PRICE_FOLDER, runPilotPriceMail } from "./pilotPriceMail.js";

/**
 * Every 20 minutes, read the Pilot price folder and load any new quote (PILOT-PRICE-MAIL-PLAN §5).
 *
 * ── WHICH SETTINGS, AND WHY NO NEW ONES ──────────────────────────────────────────────────────────────
 * The mailbox is the one the EFS report source already reads (`EFS_GRAPH_*`, miki@ — the owner granted the
 * app Mail.ReadWrite on 2026-11-17, and only reading is used here). The org the mailbox belongs to is
 * `EFS_INGEST_ORG_ID`, whose own definition is "the org that reads the shared mailbox" (envEfsIngest.ts).
 * Both are set on production AND staging (Parameter Store names checked 2026-11-18), so the feed runs on both
 * without anybody adding a setting; staging loads the same quotes into its own database, which is how a merge
 * is checked before a release. Without either, the feed is off and says so once at boot.
 *
 * Pilot sends the next day's quote at about 20:20 UTC (measured 11/11–11/18). Twenty minutes puts it in the
 * system within half an hour of arrival, at the cost of one Graph folder read per tick — no download unless
 * there is an email with work left (pilotPriceMail.ts `needsWork`).
 *
 * Runs in the scheduler lane "general" (schedulers.ts): one process fleet-wide holds that lane's lease, so two
 * servers never both load. Loads are idempotent anyway (the quote's Effective Date is the price key).
 */
const INTERVAL_MS = 20 * 60_000;

export function startPilotPriceMailScheduler(env: Env): () => void {
  const graph = graphConfigFromEnv(env);
  const orgId = env.EFS_INGEST_ORG_ID;
  if (!graph || !orgId || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log(
      `[pilot-price-mail] off — needs ${[!graph && "EFS_GRAPH_*", !orgId && "EFS_INGEST_ORG_ID", (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) && "Supabase"].filter(Boolean).join(", ")}`,
    );
    return () => {};
  }
  const reader = graphFolderReader(graphRequester(graph));
  let running = false;
  const tick = async () => {
    if (running) return; // a slow first-time geocode must not overlap the next tick
    running = true;
    try {
      const admin = getSupabaseAdmin(env);
      const r = await runPilotPriceMail(admin, orgId, {
        reader,
        download: (link) => downloadPilotQuote(link),
        ingest: (grid) => ingestPilotPrices(admin, env, orgId, grid),
        now: () => new Date(),
      });
      if (r.loaded || r.failed || r.expired || r.noLink) {
        console.log(`[pilot-price-mail] loaded ${r.loaded}, failed ${r.failed}, expired ${r.expired}, no link ${r.noLink} (of ${r.listed} in the folder)`);
      }
      if (r.failed) console.error(`[pilot-price-mail] ${r.failed} quote(s) did not load — see pilot_price_mails.error`);
    } catch (e) {
      console.error("[pilot-price-mail] run FAILED:", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  const boot = setTimeout(tick, 90_000);
  const timer = setInterval(tick, INTERVAL_MS);
  console.log(`[pilot-price-mail] on — folder "${PILOT_PRICE_FOLDER}", every ${INTERVAL_MS / 60_000} min`);
  return () => {
    clearTimeout(boot);
    clearInterval(timer);
  };
}
