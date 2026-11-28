/**
 * A maintenance follow-up's truck codes (OUT-OF-ROUTE-MAP-ANALYSIS-2026-11-27 §7; Q-ORM6–8 ruled (a)
 * 2026-11-27). The owner: "add codes from Samsara in the maintenance tab on Follow-up pages for trucks
 * we got notifications for". Every maintenance follow-up on a truck shows them (Q-ORM6) — a battery or
 * a tire follow-up is often explained by a code — read from Samsara when the drawer opens, never stored.
 *
 * ── WHEN SAMSARA DOES NOT ANSWER (D-ORM10) ───────────────────────────────────────────────────────
 * The collector keeps the codes behind a truck's lamp on the lamp's warning row (`truckLamps`). Those
 * are shown instead, with the time they were kept: written when the lamp came on, so they are older and
 * fewer than a live read, and the screen says so. A lamp row from before 2026-11-27 holds descriptions
 * only, with no SPN to look up, and is passed over. No Samsara token is not an outage: it is answered
 * as one (`NoSamsaraTokenError` rethrown), like the video.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { faultCodeWindow, faultCodesCameAndWent, followUpHasTruckCodes, truckFaultCodeSchema, type FollowUpTruckCodes, type TruckFaultCode } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { listSubjectWarnings, NoSamsaraTokenError, readTruckFaultCodes } from "../samsara/index.js";
import type { FollowUpRow } from "./lines.js";

/** The lamp kinds the collector writes (`syncEngineLamps`), each carrying the codes behind it. */
const LAMP_KINDS = ["lamp_stop", "lamp_amber"] as const;
/** As far back as a lamp row is kept (0653's 90-day retention). */
const STORED_LOOKBACK_MS = 90 * 86_400_000;

export const hasTruckCodes = (f: Pick<FollowUpRow, "category" | "subject_kind">): boolean =>
  followUpHasTruckCodes({ category: f.category, subjectKind: f.subject_kind });

export async function readFollowUpTruckCodes(admin: SupabaseClient, env: Env, orgId: string, f: FollowUpRow, nowMs: number): Promise<FollowUpTruckCodes> {
  const untilMs = f.closed_at ? Math.min(Date.parse(f.closed_at), nowMs) : nowMs;
  const window = faultCodeWindow(f.first_at, untilMs);
  try {
    const read = await readTruckFaultCodes(admin, env, orgId, f.subject_samsara_id, { sinceIso: window.sinceIso, untilIso: new Date(untilMs).toISOString() });
    return {
      source: "samsara",
      asOf: read.asOf,
      lamps: read.lamps,
      now: read.now,
      cameAndWent: faultCodesCameAndWent(read.history, read.now),
      since: window.sinceIso,
      sinceCapped: window.capped,
    };
  } catch (e) {
    if (e instanceof NoSamsaraTokenError) throw e;
    const stored = await storedLampCodes(admin, orgId, f.subject_samsara_id, nowMs);
    if (!stored) throw e;
    console.warn("[follow-ups] Samsara fault codes unavailable, showing the lamp row's:", e instanceof Error ? e.message : e);
    return { source: "stored", asOf: stored.asOf, now: stored.codes };
  }
}

async function storedLampCodes(admin: SupabaseClient, orgId: string, vehicleSamsaraId: string, nowMs: number): Promise<{ asOf: string; codes: TruckFaultCode[] } | null> {
  const sinceIso = new Date(nowMs - STORED_LOOKBACK_MS).toISOString();
  const rows = (
    await Promise.all(LAMP_KINDS.map((kind) => listSubjectWarnings(admin, orgId, { kind, subjectKind: "truck", subjectIds: [vehicleSamsaraId], sinceIso })))
  ).flat();
  let best: { asOf: string; codes: TruckFaultCode[] } | null = null;
  for (const w of rows) {
    const raw = Array.isArray(w.detail.codes) ? w.detail.codes : [];
    const codes = raw.map((c) => truckFaultCodeSchema.safeParse(c)).flatMap((p) => (p.success ? [p.data] : []));
    if (codes.length === 0) continue;
    const asOf = new Date(Date.parse(w.updatedAt)).toISOString();
    if (!best || asOf > best.asOf) best = { asOf, codes };
  }
  return best;
}
