import type { SupabaseClient } from "@supabase/supabase-js";
import type { TmsTractorPeriodsPayload, TractorPeriod } from "@silvicom/shared";

/**
 * McLeod's tractor service dates and owners (0510, TRUCK-DRIVER-PNL-PLAN P2) — the landing and the
 * one read.
 *
 * Its own file, like `glControl.ts`: it is not a ledger amount and not the roster. It is the census a
 * month's spread is divided over, and the one reader is the financial module's `getTruckDays`.
 */

const CHUNK = 500;
const PAGE = 1000;

/**
 * Every tractor the sweep read, upserted whole on (org, company, tractor) — every column in the
 * payload, so no partial upsert (`lint:upserts`). A tractor McLeod stops returning keeps its last
 * row: McLeod does not delete tractors, it marks them out of service, and a row that vanished from
 * one read is more likely a narrowed query than a truck that never existed.
 */
export async function ingestTractorPeriods(
  admin: SupabaseClient,
  orgId: string,
  payload: TmsTractorPeriodsPayload,
): Promise<{ received: number; upserted: number }> {
  const sweptAt = new Date().toISOString();
  let upserted = 0;
  for (let i = 0; i < payload.tractors.length; i += CHUNK) {
    const rows = payload.tractors.slice(i, i + CHUNK).map((t) => ({
      org_id: orgId,
      company_id: t.company_id,
      tractor_id: t.tractor_id,
      in_service_on: t.in_service_on ?? null,
      out_of_service_on: t.out_of_service_on ?? null,
      purchased_on: t.purchased_on ?? null,
      model_year: t.model_year ?? null,
      service_status: t.service_status ?? null,
      tractor_status: t.tractor_status ?? null,
      owner_id: t.owner_id ?? null,
      pay_owner: t.pay_owner ?? null,
      swept_at: sweptAt,
    }));
    const { data, error } = await admin
      .from("mcleod_tractor_periods")
      .upsert(rows, { onConflict: "org_id,company_id,tractor_id" })
      .select("id");
    if (error) throw new Error(`mcleod_tractor_periods upsert failed: ${error.message}`);
    upserted += data?.length ?? rows.length;
  }
  return { received: payload.tractors.length, upserted };
}

const COLUMNS =
  "tractor_id, company_id, in_service_on, out_of_service_on, purchased_on, model_year, service_status, tractor_status, owner_id, pay_owner";

/**
 * Every staged tractor for the org. Paged, because PostgREST caps a response at 1,000 rows and this
 * carrier has ~700 tractors today — the cap is a growth away, and a census that silently stopped at
 * 1,000 would spread a month over the wrong fleet. Ordered on the identity so the pages are a total
 * order.
 */
export async function readTractorPeriods(admin: SupabaseClient, orgId: string): Promise<TractorPeriod[]> {
  const out: TractorPeriod[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("mcleod_tractor_periods")
      .select(COLUMNS)
      .eq("org_id", orgId)
      .order("company_id", { ascending: true })
      .order("tractor_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`mcleod_tractor_periods read failed: ${error.message}`);
    const rows = (data ?? []) as TractorPeriod[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
