import type { SupabaseClient } from "@supabase/supabase-js";
import type { DispatchBoardHos } from "@silvicom/shared";

/**
 * samsara's read interface for every driver's remaining HOS clocks (DISPATCH-BOARD-PLAN DB3/DB4).
 *
 * `driver_hos_clocks` is layer=raw and sealed to this module (`check-table-access.mjs`), so the board
 * reads it through here. The table is keyed by SAMSARA's driver id with no foreign key (0450 says why),
 * so this resolves each row to our driver through `drivers.samsara_driver_id` — the same lookup
 * `syncHosCurrentStatus` makes — and returns clocks keyed by OUR driver id, which is what a board row has.
 *
 * Freshness is the caller's ruling (`freshHos` in `@silvicom/shared`), not this reader's: it returns what
 * is stored with its stamp, and `newestAt` for the board's "HOS as of …" header.
 *
 * Org-scoped on both reads — the service role bypasses RLS, so these filters are the tenant boundary.
 */
const PAGE_CAP = 2000;

type ClockRow = {
  samsara_driver_id: string;
  duty_status: string;
  drive_remaining_ms: number | string | null;
  shift_remaining_ms: number | string | null;
  cycle_remaining_ms: number | string | null;
  break_remaining_ms: number | string | null;
  fetched_at: string;
};

/** `bigint` arrives from PostgREST as a number below 2^53 and a string above; a clock is always below. */
const ms = (v: number | string | null): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function readHosClocks(
  admin: SupabaseClient,
  orgId: string,
): Promise<{ byDriverId: Map<string, DispatchBoardHos>; newestAt: string | null }> {
  const { data, error } = await admin
    .from("driver_hos_clocks")
    .select("samsara_driver_id, duty_status, drive_remaining_ms, shift_remaining_ms, cycle_remaining_ms, break_remaining_ms, fetched_at")
    .eq("org_id", orgId)
    .limit(PAGE_CAP);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as ClockRow[];
  const byDriverId = new Map<string, DispatchBoardHos>();
  if (rows.length === 0) return { byDriverId, newestAt: null };

  const { data: ds, error: dErr } = await admin
    .from("drivers")
    .select("id, samsara_driver_id")
    .eq("org_id", orgId)
    .not("samsara_driver_id", "is", null)
    .limit(PAGE_CAP);
  if (dErr) throw new Error(dErr.message);
  const ours = new Map(((ds ?? []) as Array<{ id: string; samsara_driver_id: string }>).map((d) => [d.samsara_driver_id, d.id]));

  let newestAt: string | null = null;
  for (const r of rows) {
    if (!newestAt || r.fetched_at > newestAt) newestAt = r.fetched_at;
    const id = ours.get(r.samsara_driver_id);
    if (!id) continue;
    byDriverId.set(id, {
      status: r.duty_status,
      driveRemainingMs: ms(r.drive_remaining_ms),
      shiftRemainingMs: ms(r.shift_remaining_ms),
      cycleRemainingMs: ms(r.cycle_remaining_ms),
      breakRemainingMs: ms(r.break_remaining_ms),
      fetchedAt: r.fetched_at,
    });
  }
  return { byDriverId, newestAt };
}
