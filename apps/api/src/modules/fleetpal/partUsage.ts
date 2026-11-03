import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PART_HISTORY_PAGE_SIZE,
  PART_USAGE_WINDOW_DAYS,
  typicalPriceOf,
  type PartUsageDetailDto,
  type PartUsageListDto,
  type PartUsageRowDto,
  type PartUsageShow,
  type PartUsageSort,
  type PartUsageSummaryDto,
  type PartUseDto,
  type UnitOfMeasure,
} from "@silvicom/shared";

/**
 * What the shop goes through, part by part (SHOP-PARTS-USAGE-PLAN.md SP-U2) — fleetpal's readers over
 * its own staged repair record, through migration 0557's three functions. Maintenance's Shop parts
 * routes reach these through fleetpal's index (the `maintenance -> fleetpal` edge); nothing else calls
 * the functions (0557's raw-access waiver says so).
 *
 * ── ORG SCOPE ────────────────────────────────────────────────────────────────────────────────────
 * The functions take the org as their first argument and filter every table by it inside; the
 * service role bypasses RLS, so that argument is the tenant boundary. The tests assert every call
 * passes the caller's org.
 *
 * ── NUMBERS ARRIVE AS STRINGS OR NUMBERS ─────────────────────────────────────────────────────────
 * `numeric` and `bigint` may come back from PostgREST as JSON strings ("12.000"). `num` reads both and
 * keeps null as null — a missing price is "no price", never 0.
 *
 * ── UNIT PRICES YES, SUMS NO (D-SPU10) ───────────────────────────────────────────────────────────
 * The owner ruled Q-SPU1 on 2026-11-03 ("we can show everything"): unit prices pass through. No money
 * is ever summed here — a per-part spend total is still the figure D-FP4 guards.
 */

type Failure = { ok: false; error: { message: string; code?: string } };

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const count = (v: unknown): number => num(v) ?? 0;
const iso = (v: unknown): string | null => (v ? new Date(String(v)).toISOString() : null);

const DAY_MS = 86_400_000;

interface ListRow {
  part_id: string;
  part_number: string;
  description: string;
  unit_of_measure: UnitOfMeasure;
  fleetpal_id: string | null;
  used_quantity: unknown;
  used_repairs: unknown;
  last_used_at: string | null;
  last_price: unknown;
  total_count: unknown;
}

export interface PartUsageListQuery {
  search?: string;
  show: PartUsageShow;
  sort: PartUsageSort;
  descending: boolean;
  limit: number;
  offset: number;
}

export async function readPartUsageList(
  admin: SupabaseClient,
  orgId: string,
  q: PartUsageListQuery,
  now: Date,
): Promise<{ ok: true; data: PartUsageListDto } | Failure> {
  const { data, error } = await admin.rpc("shop_parts_list", {
    p_org_id: orgId,
    p_since: new Date(now.getTime() - PART_USAGE_WINDOW_DAYS * DAY_MS).toISOString(),
    p_search: q.search?.trim() || null,
    p_used_only: q.show === "used",
    p_sort: q.sort,
    p_descending: q.descending,
    p_limit: q.limit,
    p_offset: q.offset,
  });
  if (error) return { ok: false, error };
  const rows = (data ?? []) as ListRow[];
  return {
    ok: true,
    data: {
      rows: rows.map(
        (r): PartUsageRowDto => ({
          id: r.part_id,
          partNumber: r.part_number,
          description: r.description,
          unitOfMeasure: r.unit_of_measure,
          fleetpalId: r.fleetpal_id,
          usedQuantity: count(r.used_quantity),
          usedRepairs: count(r.used_repairs),
          lastUsedAt: iso(r.last_used_at),
          lastPrice: num(r.last_price),
        }),
      ),
      // Every row carries the whole count; an empty page (past the end) has none, and its total is 0
      // only when the filter matched nothing — the page asks for page 1 again when that happens.
      total: rows.length ? count(rows[0]!.total_count) : 0,
      windowDays: PART_USAGE_WINDOW_DAYS,
    },
  };
}

interface SummaryRow {
  quantity_90d: unknown;
  repairs_90d: unknown;
  quantity_365d: unknown;
  repairs_365d: unknown;
  units_365d: unknown;
  first_used_at: string | null;
  last_used_at: string | null;
  last_price: unknown;
  typical_price_365d: unknown;
  low_price_365d: unknown;
  high_price_365d: unknown;
  priced_repairs_365d: unknown;
}

interface HistoryRow {
  work_order_number: unknown;
  work_order_status: string | null;
  used_at: string | null;
  unit_number: string | null;
  vehicle_id: string | null;
  trailer_id: string | null;
  quantity: unknown;
  unit_price: unknown;
  days_since_previous_on_unit: unknown;
  total_count: unknown;
}

/**
 * One part's figures and one page of where it went. The caller has already answered 404 for a part
 * that is not this org's; the functions answer that case with zeros and no rows regardless.
 */
export async function readPartUsageDetail(
  admin: SupabaseClient,
  orgId: string,
  partId: string,
  page: number,
  now: Date,
): Promise<{ ok: true; data: PartUsageDetailDto } | Failure> {
  const [summary, history] = await Promise.all([
    admin.rpc("shop_part_summary", { p_org_id: orgId, p_part_id: partId, p_now: now.toISOString() }),
    admin.rpc("shop_part_history", {
      p_org_id: orgId,
      p_part_id: partId,
      p_limit: PART_HISTORY_PAGE_SIZE,
      p_offset: (Math.max(page, 1) - 1) * PART_HISTORY_PAGE_SIZE,
    }),
  ]);
  if (summary.error) return { ok: false, error: summary.error };
  if (history.error) return { ok: false, error: history.error };

  const s = ((summary.data ?? []) as SummaryRow[])[0];
  const pricedRepairs = count(s?.priced_repairs_365d);
  const summaryDto: PartUsageSummaryDto = {
    quantity90d: count(s?.quantity_90d),
    repairs90d: count(s?.repairs_90d),
    quantity365d: count(s?.quantity_365d),
    repairs365d: count(s?.repairs_365d),
    units365d: count(s?.units_365d),
    firstUsedAt: iso(s?.first_used_at),
    lastUsedAt: iso(s?.last_used_at),
    lastPrice: num(s?.last_price),
    typicalPrice: typicalPriceOf(num(s?.typical_price_365d), pricedRepairs),
    lowPrice365d: num(s?.low_price_365d),
    highPrice365d: num(s?.high_price_365d),
    pricedRepairs365d: pricedRepairs,
  };

  const rows = (history.data ?? []) as HistoryRow[];
  const uses = rows.map(
    (r): PartUseDto => ({
      workOrderNumber: num(r.work_order_number),
      workOrderStatus: r.work_order_status,
      usedAt: iso(r.used_at),
      unit: {
        kind: r.vehicle_id ? "tractor" : r.trailer_id ? "trailer" : null,
        id: r.vehicle_id ?? r.trailer_id ?? null,
        number: r.unit_number,
      },
      quantity: count(r.quantity),
      unitPrice: num(r.unit_price),
      daysSincePreviousOnUnit: num(r.days_since_previous_on_unit),
    }),
  );
  return {
    ok: true,
    data: { summary: summaryDto, uses, total: rows.length ? count(rows[0]!.total_count) : 0 },
  };
}
