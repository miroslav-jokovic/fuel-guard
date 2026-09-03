import { computed, type Ref, toValue } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import {
  describeRowCoverage,
  type CoverageSurface,
  type RowCoverage,
  type EfsTransactionRow,
  type DeclinedTransactionRow,
} from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { efsRejectDayWindow } from "@/lib/stationTime";

export const EFS_PAGE_SIZE = 20;

export interface Page<T> {
  rows: T[];
  total: number;
}

const EFS_COLS =
  "id, line_number, card_num, tran_date, fueled_at, tran_time, invoice, unit, driver_name, odometer, location_name, city, state, fees, item, unit_price, qty, amt, db, currency";

export interface EfsFilters {
  unit?: string;
  from?: string; // YYYY-MM-DD
  to?: string;
  search?: string; // free text (driver / location / item or error)
  suspicion?: string; // declined only: clear | review | alert
  item?: string; // transactions only: product (ULSD, DEF, …)
  state?: string;
  driver?: string; // exact driver_name
  errorCode?: string; // declined only
  policy?: string; // declined only: policy_name
  sortKey?: string; // server-side column ordering
  sortDir?: "asc" | "desc";
}

const ilikeOr = (term: string, cols: string[]) =>
  cols.map((c) => `${c}.ilike.%${term.replace(/[%,()]/g, "")}%`).join(",");

/**
 * The five builder methods the filter helpers below reach for.
 *
 * Structural rather than the real `PostgrestFilterBuilder`, because the two callers of each helper
 * select DIFFERENT columns — the list asks for twenty and the coverage count asks for none at all
 * (`head: true`) — so their builders differ in a result type these filters never touch. Naming the
 * five methods is narrower and more honest than `any`, and it fails to compile if PostgREST's
 * chaining ever stops returning a builder.
 */
interface EfsFilterable {
  eq(column: string, value: unknown): EfsFilterable;
  gte(column: string, value: unknown): EfsFilterable;
  lte(column: string, value: unknown): EfsFilterable;
  lt(column: string, value: unknown): EfsFilterable;
  or(filters: string): EfsFilterable;
}

/**
 * Every `efs_transactions` filter, applied once, for every caller.
 *
 * FUEL-T5 needs a SECOND read of this table — how many of the matching rows name a truck — and the
 * only way that figure can be wrong is by counting a different set than the list beneath it. The same
 * argument `searchTerm` makes in `useFuelLog` ("one sanitiser, one term, two callers"), one level up:
 * one filter definition, two callers, and no way for a caveat to describe rows the reader is not
 * looking at.
 */
function applyEfsTxnFilters<Q>(query: Q, f: EfsFilters): Q {
  let q = query as unknown as EfsFilterable;
  if (f.unit) q = q.eq("unit", f.unit);
  if (f.item) q = q.eq("item", f.item);
  if (f.state) q = q.eq("state", f.state);
  if (f.driver) q = q.eq("driver_name", f.driver);
  if (f.from) q = q.gte("tran_date", f.from);
  if (f.to) q = q.lte("tran_date", f.to);
  if (f.search) q = q.or(ilikeOr(f.search, ["unit", "driver_name", "card_num", "invoice", "location_name", "item", "city"]));
  return q as unknown as Q;
}

/** Faithful EFS transaction rows, newest first, one page (20) with total count for navigation. */
export function useEfsTransactions(filters: Ref<EfsFilters>, page: Ref<number>) {
  return useQuery({
    queryKey: ["efs_transactions", filters, page],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Page<EfsTransactionRow>> => {
      const f = toValue(filters);
      const start = (toValue(page) - 1) * EFS_PAGE_SIZE;
      const q = applyEfsTxnFilters(
        supabase
          .from("efs_transactions")
          .select(EFS_COLS, { count: "exact" })
          // nullsFirst:false — undated lines (fee/DEF/footer rows with no Tran Date) must sort to the BOTTOM,
          // not float to the top of a DESC sort (Postgres defaults to NULLS FIRST on descending).
          .order(f.sortKey ?? "fueled_at", { ascending: f.sortKey ? f.sortDir !== "desc" : false, nullsFirst: false })
          .order("line_number", { ascending: true })
          .range(start, start + EFS_PAGE_SIZE - 1),
        f,
      );
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as EfsTransactionRow[], total: count ?? 0 };
    },
  });
}

const DECLINED_COLS =
  "id, import_id, declined_at, card_ref, invoice, location_id, location_text, city, state, unit, driver_ext_id, driver_name, driver_name_source, error_code, error_description, policy, policy_name, suspicion_level, suspicion_reasons";

/** Every `declined_transactions` filter, applied once, for every caller. See `applyEfsTxnFilters`. */
function applyDeclinedFilters<Q>(query: Q, f: EfsFilters): Q {
  let q = query as unknown as EfsFilterable;
  if (f.unit) q = q.eq("unit", f.unit);
  if (f.suspicion) q = q.eq("suspicion_level", f.suspicion);
  if (f.errorCode) q = q.eq("error_code", f.errorCode);
  if (f.state) q = q.eq("state", f.state);
  if (f.driver) q = q.eq("driver_name", f.driver);
  if (f.policy) q = q.eq("policy_name", f.policy);
  // FUEL-T1 / D-FUI11. `declined_at` is a correct UTC instant, and the page renders it in CENTRAL
  // because that is the zone EFS prints rejects in whatever the station's own zone is. Filtering
  // the raw instant against bare date strings therefore asked a UTC question of a Central answer:
  // a decline at 19:00 CT on 31 August is 2026-09-01T00:00Z and fell outside an August window
  // while the row above it read "Aug 31". `efsRejectDayWindow` converts the picked DAYS into the
  // instants that bound them in Central — no column needed, because unlike a fill's station zone,
  // this one does not vary row to row.
  if (f.from && f.to) {
    const w = efsRejectDayWindow(f.from, f.to);
    q = q.gte("declined_at", w.gte).lt("declined_at", w.lt);
  } else if (f.from) {
    q = q.gte("declined_at", efsRejectDayWindow(f.from, f.from).gte);
  } else if (f.to) {
    q = q.lt("declined_at", efsRejectDayWindow(f.to, f.to).lt);
  }
  if (f.search) {
    const t = f.search.replace(/[%,()]/g, "");
    q = q.or(
      [`unit.ilike.${t}%`, `driver_name.ilike.%${t}%`, `location_text.ilike.%${t}%`, `city.ilike.%${t}%`, `error_description.ilike.%${t}%`].join(
        ",",
      ),
    );
  }
  return q as unknown as Q;
}

/** Faithful declined (Reject Report) rows, newest first, one page (20) with total count. */
export function useDeclinedTransactions(filters: Ref<EfsFilters>, page: Ref<number>) {
  return useQuery({
    queryKey: ["declined_transactions", filters, page],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Page<DeclinedTransactionRow>> => {
      const f = toValue(filters);
      const start = (toValue(page) - 1) * EFS_PAGE_SIZE;
      const q = applyDeclinedFilters(
        supabase
          .from("declined_transactions")
          .select(DECLINED_COLS, { count: "exact" })
          .order(f.sortKey ?? "declined_at", { ascending: f.sortKey ? f.sortDir !== "desc" : false, nullsFirst: false })
          .range(start, start + EFS_PAGE_SIZE - 1),
        f,
      );
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as DeclinedTransactionRow[], total: count ?? 0 };
    },
  });
}

/* ── facet values for the filter dropdowns ──────────────────────────────────
   Distinct values pulled once and cached; fleet-scale row counts make the
   client-side dedupe cheap, and RLS scopes the scan to the org. */

export interface EfsFacets {
  txnItems: string[];
  txnStates: string[];
  txnDrivers: string[];
  rejErrorCodes: { code: string; label: string }[];
  rejStates: string[];
  rejDrivers: string[];
  rejPolicies: string[];
}

const uniq = (vals: (string | null | undefined)[]): string[] =>
  [...new Set(vals.filter((v): v is string => !!v && v.trim() !== ""))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );

export function useEfsFacets() {
  return useQuery({
    queryKey: ["efs_facets"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<EfsFacets> => {
      const [t, d] = await Promise.all([
        supabase.from("efs_transactions").select("item, state, driver_name").limit(10_000),
        supabase
          .from("declined_transactions")
          .select("error_code, error_description, state, driver_name, policy_name")
          .limit(10_000),
      ]);
      if (t.error) throw new Error(t.error.message);
      if (d.error) throw new Error(d.error.message);
      const txn = t.data ?? [];
      const rej = d.data ?? [];
      // One label per error code — first non-empty description, truncated for the menu.
      const codeLabels = new Map<string, string>();
      for (const r of rej) {
        if (r.error_code && !codeLabels.has(r.error_code)) {
          const desc = (r.error_description ?? "").trim();
          codeLabels.set(r.error_code, desc ? `${r.error_code} — ${desc.slice(0, 40)}` : r.error_code);
        }
      }
      return {
        txnItems: uniq(txn.map((r) => r.item)),
        txnStates: uniq(txn.map((r) => r.state)),
        txnDrivers: uniq(txn.map((r) => r.driver_name)),
        rejErrorCodes: [...codeLabels.entries()]
          .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
          .map(([code, label]) => ({ code, label })),
        rejStates: uniq(rej.map((r) => r.state)),
        rejDrivers: uniq(rej.map((r) => r.driver_name)),
        rejPolicies: uniq(rej.map((r) => r.policy_name)),
      };
    },
  });
}

/* ── FUEL-T5: how much of the list on screen reaches a truck ─────────────────
   The count in the filter bar and the feed-freshness line above it answer "how many rows" and "when
   did they arrive". Neither answers the question a unit filter or a per-truck total silently depends
   on: how many of these rows name a truck at all. Measured in production 2026-09-02, that is 339 of
   28,620 transaction lines and 696 of 3,445 declines — one decline in five, on the page whose only
   job is a fraud signal. */

/**
 * The attributed share for one of the two raw-feed lists.
 *
 * ── TWO TABLES, TWO DIFFERENT FACTS, AND THE PLAN EXPECTED ONE ─────────────────────────────────
 * The plan (T5's own note) says both pages "key on a text `unit` rather than a `vehicle_id`, so both
 * need a migration". That is true of `efs_transactions` and **false of `declined_transactions`**,
 * which has carried a `vehicle_id` since its scoring work. Measured 2026-09-02: 2,749 declines carry
 * one, and they are exactly the 2,749 whose `unit` matches a vehicle — so the column already IS the
 * attribution fact and no migration is needed to read it.
 *
 * `efs_transactions` has no vehicle column, so its attribution is a match against this fleet's unit
 * numbers. Those come from `vehicles` — the same query that already fills this page's Unit filter —
 * rather than from a list written down anywhere: a copy of the fleet is a workaround with a delay
 * fuse (CLAUDE.md). Passing the units the browser already holds is what lets this stay one PostgREST
 * count instead of a second SQL function restating seven filters in a second language, which is the
 * drift `fuelSpendReport.ts` carries a scar about.
 *
 * ── BOTH COUNTS COME FROM THE SAME FILTERS, AND FROM EACH OTHER'S MOMENT ────────────────────────
 * The denominator is NOT taken from the list query's `total`: two queries with independent cache
 * lifetimes can be one poll apart, and "28,300 of 28,620" quietly becomes "28,300 of 28,041" with no
 * error anywhere. Both counts are issued here, together, through the same `applyEfsTxnFilters` /
 * `applyDeclinedFilters` the list itself uses.
 */
/** The counts are the whole answer, so no row crosses the wire for either of them. */
const COUNT_ONLY = { count: "exact", head: true } as const;

interface CountResult {
  count: number | null;
  error: { message: string } | null;
}

/** Both counts, or the first error — never a share built from one half of a failed pair. */
function toCoverage(surface: CoverageSurface, all: CountResult, named: CountResult): RowCoverage {
  if (all.error) throw new Error(all.error.message);
  if (named.error) throw new Error(named.error.message);
  return describeRowCoverage(surface, all.count ?? 0, named.count ?? 0);
}

export function useEfsRowCoverage(surface: CoverageSurface, filters: Ref<EfsFilters>) {
  const { data: vehicles } = useVehiclesQuery();
  const unitNumbers = computed(() => uniq((vehicles.value ?? []).map((v) => v.unit_number)));

  return useQuery({
    queryKey: ["efs_row_coverage", surface, filters, unitNumbers],
    placeholderData: keepPreviousData,
    // ⚠ Transactions ONLY. An empty unit list makes `.in("unit", [])` match nothing, and the line
    // would read "0% of the 28,620 transactions in this list name a truck" — the most confidently
    // wrong sentence on the page, produced by the fleet query merely not having landed yet. There is
    // no equivalent hazard for rejections: `vehicle_id is not null` needs nothing from the browser.
    enabled: computed(() => surface === "rejections" || unitNumbers.value.length > 0),
    queryFn: async (): Promise<RowCoverage> => {
      const f = toValue(filters);
      // The two branches name their table LITERALLY rather than sharing one `.from(table)`: a dynamic
      // table expression is invisible to every table gate in `scripts/` (`lint:table-access` refuses
      // it by name), and the ownership of `efs_transactions` and `declined_transactions` is exactly
      // what those gates exist to keep readable.
      if (surface === "rejections") {
        const head = () =>
          applyDeclinedFilters(supabase.from("declined_transactions").select("id", COUNT_ONLY), f);
        const [all, named] = await Promise.all([head(), head().not("vehicle_id", "is", null)]);
        return toCoverage("rejections", all, named);
      }
      const head = () => applyEfsTxnFilters(supabase.from("efs_transactions").select("id", COUNT_ONLY), f);
      const [all, named] = await Promise.all([head(), head().in("unit", unitNumbers.value)]);
      return toCoverage("transactions", all, named);
    },
  });
}
