import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { projectFinancialWindow } from "./projection.js";

/**
 * Nightly re-projection of the trailing financial window (P3.4/P3.5).
 *
 * Trailing 75 days, not yesterday: the agent's financial sweep re-sends a rolling 75
 * (accrual posting lag), and the projection must cover at least what staging can still change,
 * plus padding. Idempotent — the 0257 source-row index makes a re-projection converge — so the
 * window costs seconds and cannot double-count. The FULL 2024-01-01 backfill (D-FS3) is the
 * `financial_projection` job with `payload.full`, dispatched once, on purpose, by a person.
 *
 * Run in EXACTLY ONE process (see `startAllSchedulers`).
 */
const DAILY_MS = 24 * 60 * 60 * 1000;
// 75 since D-FIN7: never shorter than the agent's sweep window (75, D-FIN4), or a row the sweep can
// still change lands in staging and waits for a manual full run before it is projected.
const PROJECTION_DAYS = 75;

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

export function startFinancialProjectionScheduler(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  let inFlight = false;
  const run = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const admin = getSupabaseAdmin(env);
      const { data, error } = await admin.from("organizations").select("id");
      if (error) throw new Error(error.message);
      const to = ymd(new Date(Date.now() + DAILY_MS));
      const from = ymd(new Date(Date.now() - PROJECTION_DAYS * DAILY_MS));
      // Sequential and independently guarded — one carrier's bad staging must not stop the next.
      for (const org of (data ?? []) as { id: string }[]) {
        try {
          const r = await projectFinancialWindow(admin, org.id, from, to);
          if (r.entriesUpserted > 0) {
            console.log(
              `[financial] org ${org.id}: projected ${r.entriesUpserted} entr(ies) — ` +
                `${r.settlements} settlement(s), ${r.vouchers} voucher(s), ${r.billing} invoice(s), ` +
                `${r.fuelFills} fill(s)${r.skippedFuelNoCost ? `, ${r.skippedFuelNoCost} fill(s) skipped with no cost` : ""}`,
            );
          }
        } catch (e) {
          console.error(`[financial] org ${org.id} projection failed: ${e instanceof Error ? e.message : e}`);
        }
      }
    } catch (e) {
      console.error(`[financial] projection sweep failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      inFlight = false;
    }
  };

  setTimeout(() => void run(), 90_000); // after boot settles; nightly thereafter
  setInterval(() => void run(), DAILY_MS);
}
