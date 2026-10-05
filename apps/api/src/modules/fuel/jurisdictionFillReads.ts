import type { SupabaseClient } from "@supabase/supabase-js";
import type { IftaCardFillKey, IftaJurisdictionFillRaw } from "@silvicom/shared";

/**
 * The fuel module's answer to the IFTA drill-down's second question: **which fills were bought in
 * this jurisdiction this quarter, and on which truck?** The miles half comes from samsara's reader;
 * this is the purchases half, so `fuel_transactions` stays read through its owner (D-ARC3).
 *
 * ── THE PREDICATE IS THE LEDGER'S, ON PURPOSE ────────────────────────────────────────────────────
 * The ledger row this opens from is `ifta_period_jurisdictions`' fuel half (0256/0258): tractor tank
 * (a NULL tank counts as tractor), gallons > 0, upper-cased `state`, station-local business date
 * inside the quarter. The same predicate here is what makes the trucks' gallons add up to the row's
 * "Gallons bought". `business_date` is the stored column, not the function — measured on production
 * 2026-10-05 for 2026 Q3: 5,823 fills, the column and `fuel_business_date(fueled_at, state)` differ
 * on ZERO of them, and every one is canonical, so neither choice moves a total today.
 *
 * Fills with no truck are returned too (`vehicle_id` null — 87 of Q3's 5,823): they are in the
 * ledger's total, so dropping them would make the drill-down disagree with the row it came from.
 *
 * Paged by primary key, because PostgREST caps a response at 1,000 rows and the largest
 * jurisdiction-quarter (Texas) is well past that.
 */
export async function readJurisdictionFills(
  admin: SupabaseClient,
  orgId: string,
  jurisdiction: string,
  fromDay: string,
  toDayExclusive: string,
): Promise<IftaJurisdictionFillRaw[]> {
  const out: IftaJurisdictionFillRaw[] = [];
  const PAGE = 1000;
  // Widened a day each side on the instant, then filtered on the business date — 0256's shape, so
  // the read rides `idx_ftxn_org_time` rather than scanning every fill the org ever bought.
  const shift = (ymd: string, days: number) =>
    new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("fuel_transactions")
      .select("id, vehicle_id, fueled_at, business_date, gallons, price_per_gal, total_cost, location_text, tank_type")
      .eq("org_id", orgId)
      .ilike("state", jurisdiction)
      .gt("gallons", 0)
      .gte("fueled_at", shift(fromDay, -1))
      .lt("fueled_at", shift(toDayExclusive, 1))
      .gte("business_date", fromDay)
      .lt("business_date", toDayExclusive)
      .or("tank_type.is.null,tank_type.eq.tractor")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fuel_transactions read failed: ${error.message}`);
    const rows = (data ?? []) as Array<{
      id: string;
      vehicle_id: string | null;
      fueled_at: string;
      business_date: string | null;
      gallons: number | string;
      price_per_gal: number | string | null;
      total_cost: number | string | null;
      location_text: string | null;
    }>;
    for (const r of rows) {
      out.push({
        id: r.id,
        vehicleId: r.vehicle_id,
        fueledAt: r.fueled_at,
        businessDate: r.business_date,
        gallons: Number(r.gallons),
        pricePerGal: r.price_per_gal == null ? null : Number(r.price_per_gal),
        totalCost: r.total_cost == null ? null : Number(r.total_cost),
        location: r.location_text,
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * The same predicate, cut the other way: every tractor fill these trucks bought in the window, in
 * any state, reduced to the four facts the IFTA receipt duplicate rule compares (IP6,
 * `dropCardDuplicateReceipts`). The ledger needs it for the handful of trucks that have a hand-keyed
 * receipt in the quarter — reading every jurisdiction's fills to check ~30 receipts would be ~6,000
 * rows for nothing. Chunked by vehicle id because a PostgREST `in` list rides in the URL.
 */
export async function readVehicleTractorFillKeys(
  admin: SupabaseClient,
  orgId: string,
  vehicleIds: string[],
  fromDay: string,
  toDayExclusive: string,
): Promise<IftaCardFillKey[]> {
  const out: IftaCardFillKey[] = [];
  const PAGE = 1000;
  const shift = (ymd: string, days: number) =>
    new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString();
  for (let i = 0; i < vehicleIds.length; i += 200) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("fuel_transactions")
        .select("id, vehicle_id, state, business_date, gallons")
        .eq("org_id", orgId)
        .in("vehicle_id", vehicleIds.slice(i, i + 200))
        .gt("gallons", 0)
        .gte("fueled_at", shift(fromDay, -1))
        .lt("fueled_at", shift(toDayExclusive, 1))
        .gte("business_date", fromDay)
        .lt("business_date", toDayExclusive)
        .or("tank_type.is.null,tank_type.eq.tractor")
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`fuel_transactions read failed: ${error.message}`);
      const rows = (data ?? []) as Array<{
        id: string; vehicle_id: string | null; state: string | null;
        business_date: string | null; gallons: number | string;
      }>;
      for (const r of rows) {
        out.push({ id: r.id, vehicleId: r.vehicle_id, state: r.state, businessDate: r.business_date, gallons: Number(r.gallons) });
      }
      if (rows.length < PAGE) break;
    }
  }
  return out;
}
