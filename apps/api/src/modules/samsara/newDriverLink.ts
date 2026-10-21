import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import type { SamsaraDriverLister } from "./lib/samsara.js";
import { syncDriversFromSamsara } from "./samsaraDriverSync.js";

/**
 * A driver in a truck whom we cannot name gets linked within five minutes, not twelve hours.
 *
 * ── WHY (2026-10-21) ─────────────────────────────────────────────────────────────────────────────
 * Truck 797 was assigned that morning; by 20:36Z Samsara's HOS clocks had driver 61252434 in it and
 * McLeod had a preplanned load on it, and our 797 still showed nobody. The five-minute seat pass was
 * healthy — 157 of the 168 trucks Samsara had a driver in agreed with ours — but `planDriverSeats`
 * leaves a truck alone when the Samsara driver id matches no row, and `samsara_driver_id` was only
 * ever written by the driver sync inside the 12-hour identity tier. Hector Rivera shows the gap
 * end to end: his row existed from 10/16 23:38Z and got its Samsara link at 10/17 07:18Z.
 *
 * So the clocks tier, which already holds every driver's current truck, asks one question of it:
 * is anybody in a truck whose Samsara id we have not linked? Only then does it run the driver sync —
 * the same sync, with its link-only rules and its name/phone/licence matching, not a second matcher.
 *
 * ── WHY IT REMEMBERS WHAT IT TRIED ───────────────────────────────────────────────────────────────
 * Some of these ids stay unknown: on 10/21 a team truck's second driver had been unmatched since 09/15
 * and a shop truck's since April. Re-running the whole driver sync every five minutes for them would
 * rewrite ~180 rows 288 times a day to learn nothing. A new id is tried at once; an id already tried
 * waits `RETRY_MS`. The memory is per process, which is enough: a restart costs one extra run.
 *
 * It links; it does not create. Under McLeod mastery a Samsara driver with no roster row stays
 * unlinked and reported — creating employees is the McLeod sweep's job (MCLEOD-ROSTER-SYNC-PLAN M5).
 */
export const RETRY_MS = 6 * 60 * 60_000;

const tried = new Map<string, number>();

/** Test seam: forget what was tried, so each case starts from a fresh process. */
export function forgetTriedDrivers(): void {
  tried.clear();
}

export interface NewDriverLinkResult {
  /** Samsara driver ids in a truck that no row of ours carries. */
  unknown: number;
  /** Whether the driver sync ran this tick. */
  ran: boolean;
  /** Of the ids it ran for, how many a row now carries. */
  linked: number;
}

export async function linkNewDriversInTrucks(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  driverIdsInTrucks: readonly string[],
  opts: { now?: number; driverLister?: SamsaraDriverLister } = {},
): Promise<NewDriverLinkResult> {
  const now = opts.now ?? Date.now();
  const ids = [...new Set(driverIdsInTrucks)];
  if (ids.length === 0) return { unknown: 0, ran: false, linked: 0 };

  const known = await knownIds(admin, orgId, ids);
  const unknown = ids.filter((id) => !known.has(id));
  const due = unknown.filter((id) => now - (tried.get(`${orgId}|${id}`) ?? -Infinity) >= RETRY_MS);
  if (due.length === 0) return { unknown: unknown.length, ran: false, linked: 0 };

  for (const id of due) tried.set(`${orgId}|${id}`, now);
  await syncDriversFromSamsara(admin, env, orgId, opts.driverLister);
  const after = await knownIds(admin, orgId, due);
  console.log(`[samsara-sched] org ${orgId}: ${due.length} driver(s) in a truck had no Samsara link — linked ${after.size}`);
  return { unknown: unknown.length, ran: true, linked: after.size };
}

async function knownIds(admin: SupabaseClient, orgId: string, ids: readonly string[]): Promise<Set<string>> {
  const { data, error } = await admin
    .from("drivers")
    .select("samsara_driver_id")
    .eq("org_id", orgId)
    .in("samsara_driver_id", [...ids]);
  if (error) throw new Error(`drivers read failed: ${error.message}`);
  return new Set(((data ?? []) as { samsara_driver_id: string | null }[]).map((r) => r.samsara_driver_id!).filter(Boolean));
}
