/**
 * The FMCSA feed's clock (INSPECTION-CHALLENGE-PLAN IC1; register: `docs/WORKER-DEPLOYMENT.md`).
 *
 * ── ⚠ ONE PROCESS FLEET-WIDE ──────────────────────────────────────────────────────────────────
 * Started from `startAllSchedulers`, so it runs wherever the schedulers run and nowhere else. Two
 * copies would not corrupt anything — a replayed snapshot is a no-op, every record version is keyed
 * — but each would add a run row a day per dataset and double our share of Socrata's anonymous pool.
 *
 * ── DUE BY THE LEDGER, NOT BY THE CLOCK ───────────────────────────────────────────────────────
 * It ticks hourly and runs an org when that org's last SUCCESSFUL inspection-file run is older than
 * `FMCSA_FEED_HOURS` (24): a deploy, a failed run or a day FMCSA was down is caught up on the next
 * tick instead of waiting a day. The inspection file is the clock because the other datasets hang
 * off it; `fmcsa_fetch_runs` is the ledger, so there is no jobs-ledger row (the boardEtaRecorder's
 * reasoning). An org with no `dot_number` has no FMCSA record to fetch and is skipped. After the
 * fetch, the typed `roadside_*` record is re-projected (0458, `project.ts`).
 *
 * Every tick then asks whether the org's record has gone stale (`staleAlert.ts`, IC1c) — due or not,
 * because a fetch that keeps failing is exactly the org whose run is always due.
 *
 * Last, it works a batch of the attribution backlog (IC5, `attribution/pass.ts`): who was driving at
 * each inspection, read from Samsara and frozen. It runs on Samsara's backfill lane, after the feed, and
 * its failure is logged on its own so it can never stop the fetch or the stale check.
 */
import { organizationTimezone } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { SocrataClient } from "./socrata.js";
import { lastSucceededAt } from "./store.js";
import { projectRoadside } from "./project.js";
import { syncFmcsaFeed } from "./sync.js";
import { alertIfFeedStale } from "./staleAlert.js";
import { loadSamsaraToken, makeSamsaraRawFetcher } from "../../samsara/index.js";
import { attributeBacklog } from "../attribution/pass.js";

const TICK_MS = 60 * 60_000;
/** After boot, behind the vendor feeds that are measured in minutes. */
const BOOT_DELAY_MS = 9 * 60_000;

export function isFmcsaFeedDue(lastFinishedAt: string | null, nowMs: number, intervalMs: number): boolean {
  if (!lastFinishedAt) return true;
  const finishedMs = Date.parse(lastFinishedAt);
  return !Number.isFinite(finishedMs) || nowMs - finishedMs >= intervalMs;
}

export function startFmcsaFeedScheduler(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  if (env.FMCSA_FEED_HOURS <= 0) return;
  const intervalMs = env.FMCSA_FEED_HOURS * 60 * 60_000;

  let inFlight = false;
  const run = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const admin = getSupabaseAdmin(env);
      const { data, error } = await admin.from("organizations").select("id, dot_number, operating_hours").not("dot_number", "is", null);
      if (error) throw new Error(error.message);
      for (const { id, dot_number, operating_hours } of (data ?? []) as { id: string; dot_number: string; operating_hours: unknown }[]) {
        const dot = dot_number.trim();
        if (!/^\d+$/.test(dot)) {
          console.error(`[fmcsa-feed] org ${id}: dot_number ${JSON.stringify(dot_number)} is not a USDOT number; skipped`);
          continue;
        }
        await tickOrg(admin, env, { id, dot, timeZone: organizationTimezone(operating_hours as Parameters<typeof organizationTimezone>[0]) }, intervalMs);
      }
    } catch (e) {
      console.error("[fmcsa-feed] tick failed:", e instanceof Error ? e.message : e);
    } finally {
      inFlight = false;
    }
  };

  const boot = setTimeout(() => void run(), BOOT_DELAY_MS);
  boot.unref?.();
  const timer = setInterval(() => void run(), TICK_MS);
  timer.unref?.();
}

/**
 * One org's turn of the tick: fetch when due, then — always, due or not, run or failed — ask whether
 * its record has gone stale. A fetch that keeps failing is the org whose run is always due and never
 * succeeds; putting the check inside the run would silence exactly that one.
 */
export async function tickOrg(
  admin: ReturnType<typeof getSupabaseAdmin>,
  env: Env,
  org: { id: string; dot: string; timeZone: string },
  intervalMs: number,
): Promise<void> {
  try {
    if (isFmcsaFeedDue(await lastSucceededAt(admin, org.id, "fx4q-ay7w"), Date.now(), intervalMs)) await runOrg(admin, env, org.id, org.dot);
  } catch (e) {
    console.error(`[fmcsa-feed] org ${org.id}: run failed —`, e instanceof Error ? e.message : e);
  }
  await alertIfFeedStale(admin, org.id, Date.now(), org.timeZone);
  try {
    await attributeOrg(admin, env, org.id);
  } catch (e) {
    console.error(`[inspection-attribution] org ${org.id}: pass failed —`, e instanceof Error ? e.message : e);
  }
}

/** One batch of the org's attribution backlog. An org with no Samsara token has nothing to ask. */
async function attributeOrg(admin: ReturnType<typeof getSupabaseAdmin>, env: Env, orgId: string): Promise<void> {
  const token = await loadSamsaraToken(admin, env, orgId);
  if (!token) return;
  const tally = await attributeBacklog(admin, orgId, makeSamsaraRawFetcher(env, token), Date.now());
  const read = Object.entries(tally).map(([k, n]) => `${n} ${k}`).join(", ");
  if (read) console.log(`[inspection-attribution] org ${orgId}: ${read}`);
}

/** One org's fetch and projection. Throws; the tick logs it and goes on to the stale check. */
async function runOrg(admin: ReturnType<typeof getSupabaseAdmin>, env: Env, id: string, dot: string): Promise<void> {
  const client = new SocrataClient({ appToken: env.FMCSA_SOCRATA_APP_TOKEN });
  const results = await syncFmcsaFeed(admin, id, dot, client);
  const summary = results
    .map((r) => (r.outcome === "succeeded" ? `${r.dataset} ${r.rowsSeen} seen/${r.rowsNew + r.rowsChanged + r.rowsReappeared} new/${r.rowsVanished} vanished` : `${r.dataset} FAILED`))
    .join(", ");
  // Projected whatever the feed's outcome: the typed record is a function of what is stored, and a
  // failed dataset leaves its last good versions current, so projecting them is still right.
  const p = await projectRoadside(admin, id);
  console.log(
    `[fmcsa-feed] org ${id}: ${summary} (${client.requestCount} requests); projected ${p.inspections} inspections, ${p.units} units, ${p.violations} violations, ${p.citations} citations changed`,
  );
}
