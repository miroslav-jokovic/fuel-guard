import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { openSftp } from "../../lib/sftpClient.js";
import { ingestPilotPrices } from "./pilotPriceIngest.js";
import { BUCKET, runPilotSftp } from "./pilotSftpFeed.js";

/**
 * Every 30 minutes, take any new file from Pilot's SFTP drop (PILOT-SFTP-FEED-PLAN §5).
 *
 * ── WHICH ORG, AND WHY NO NEW SETTING FOR IT ─────────────────────────────────────────────────────────
 * The SFTP account is Pilot's account 139445 — the same TCH/EFS account whose card reports `EFS_INGEST_ORG_ID`
 * already names the org for ("the org that reads the shared mailbox", envEfsIngest.ts), and whose emailed quotes
 * and bills the two mailbox feeds load into that org. One account, one org: a second setting naming the same org
 * would be a copy that can drift. Without it, or without the four PILOT_SFTP_* settings, the feed is off and says
 * so once at boot.
 *
 * ── WHY THIRTY MINUTES ───────────────────────────────────────────────────────────────────────────────
 * A run that finds nothing new costs one login and one directory listing (~0.5 s, measured 2026-11-26) and
 * downloads nothing. Pilot's emailed quote arrives about 20:20 UTC for the next day; half an hour puts an SFTP
 * quote in the system well before dispatch plans the next morning. Transaction files are daily.
 *
 * Runs in the scheduler lane "general" (schedulers.ts): one process fleet-wide holds that lane's lease, so two
 * servers never both take a file. Pilot allows our production and staging addresses only (2026-11-25), so a
 * developer machine that sets these settings is refused by Pilot, not by us.
 */
const INTERVAL_MS = 30 * 60_000;

export function startPilotSftpScheduler(env: Env): () => void {
  const orgId = env.EFS_INGEST_ORG_ID;
  const host = env.PILOT_SFTP_HOST;
  const user = env.PILOT_SFTP_USER;
  const password = env.PILOT_SFTP_PASSWORD;
  const pin = env.PILOT_SFTP_HOST_KEY;
  const missing = [
    !host && "PILOT_SFTP_HOST", !user && "PILOT_SFTP_USER", !password && "PILOT_SFTP_PASSWORD", !pin && "PILOT_SFTP_HOST_KEY",
    !orgId && "EFS_INGEST_ORG_ID", (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) && "Supabase",
  ].filter(Boolean);
  if (missing.length || !host || !user || !password || !pin || !orgId) {
    console.log(`[pilot-sftp] off — needs ${missing.join(", ")}`);
    return () => {};
  }
  const cfg = { host, port: env.PILOT_SFTP_PORT, username: user, password, hostKeySha256: pin };
  let running = false;
  const tick = async () => {
    if (running) return; // a first-time geocode of a quote's new sites must not overlap the next tick
    running = true;
    try {
      const admin = getSupabaseAdmin(env);
      const bucket = () => admin.storage.from(BUCKET);
      const r = await runPilotSftp(admin, orgId, {
        open: () => openSftp(cfg),
        store: async (path, bytes) => {
          const { error } = await bucket().upload(path, bytes, { contentType: "application/octet-stream", upsert: true });
          if (error) throw new Error(error.message);
        },
        fetchKept: async (path) => {
          const { data, error } = await bucket().download(path);
          if (error || !data) throw new Error(error?.message ?? "empty download");
          return Buffer.from(await data.arrayBuffer());
        },
        ingestPrices: (grid) => ingestPilotPrices(admin, env, orgId, grid),
        now: () => new Date(),
      });
      if (r.loaded || r.held || r.refused || r.duplicate || r.failed || r.deferred) {
        console.log(
          `[pilot-sftp] loaded ${r.loaded}, held ${r.held}, refused ${r.refused}, duplicate ${r.duplicate}, failed ${r.failed}, deferred ${r.deferred} (of ${r.listed} on the server)`,
        );
      }
      if (r.failed) console.error(`[pilot-sftp] ${r.failed} file(s) did not go through — see pilot_sftp_files.error`);
    } catch (e) {
      console.error("[pilot-sftp] run FAILED:", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  const boot = setTimeout(tick, 120_000);
  const timer = setInterval(tick, INTERVAL_MS);
  console.log(`[pilot-sftp] on — ${host}:${env.PILOT_SFTP_PORT}, every ${INTERVAL_MS / 60_000} min`);
  return () => {
    clearTimeout(boot);
    clearInterval(timer);
  };
}
