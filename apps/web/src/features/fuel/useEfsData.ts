import { computed, type Ref, toValue } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import {
  describeRowCoverage,
  applyEfsTxnFilters,
  applyDeclinedFilters,
  type EfsListFilters,
  type CoverageSurface,
  type RowCoverage,
  type EfsTransactionRow,
  type DeclinedTransactionRow,
} from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import { useVehiclesQuery } from "@/composables/useVehicles";

export const EFS_PAGE_SIZE = 20;

export interface Page<T> {
  rows: T[];
  total: number;
}

const EFS_COLS =
  "id, line_number, card_num, tran_date, fueled_at, tran_time, invoice, unit, driver_name, odometer, location_name, city, state, fees, item, unit_price, qty, amt, db, currency";

/**
 * What narrows these two lists — defined in `@silvicom/shared` since FUEL-P2, because the EXPORT has
 * to apply the identical set (D-FUI15: "server-rendered from the same pure functions the screen
 * uses"). Re-exported under the name every caller here already imports.
 */
export type EfsFilters = EfsListFilters;

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

/* ── facet values for the filter dropdowns ──────────────────────────────────────────────────────
   ── WHY THESE COME FROM SQL NOW, AND WHY IT IS A CORRECTNESS FIX (FUEL-P1, D-FUI16) ────────────
   This selected rows and deduplicated them in the browser, under `.limit(10_000)`. That limit was
   never in force: **the hosted PostgREST caps every response at 1,000 rows** — measured against the
   live project on 2026-09-04, `select=id&limit=5000` on `efs_transactions` returns exactly 1,000. So
   nine menus over 28,638 transaction lines and 3,479 declines were built from the first thousand of
   each, and offered 133 of 190 units, 133 of 249 drivers, 9 of 13 items, 42 of 47 states and 17 of 19
   error codes.

   A value missing from a menu while its rows sit in the list is not a cosmetic gap: the reader can see
   the rows and cannot isolate them, and nothing says why. It is also the same shape as the A4 finding
   — correctness resting on a server row cap this code does not control — and it gets 0289's answer:
   DISTINCT belongs where the rows are (migrations 0313/0314).

   The two functions are called in parallel because they read two different collectors' tables
   (D-SEP1); each is org-scoped by `auth_org_id()` and neither takes an argument from here. */

export interface EfsFacets {
  txnItems: string[];
  txnStates: string[];
  txnDrivers: string[];
  /** The units the TRANSACTION feed actually printed — not the fleet roster. See `unitFilter.ts`. */
  txnUnits: string[];
  rejErrorCodes: { code: string; label: string }[];
  rejStates: string[];
  rejDrivers: string[];
  rejPolicies: string[];
  /** The units the REJECT feed actually printed. */
  rejUnits: string[];
}

/**
 * The readable half of a decline's description.
 *
 * ── MEASURED ON PRODUCTION, 2026-09-04, AFTER 0314 LANDED ───────────────────────────────────────
 * EFS does not send a reason, it sends a pipe-delimited trace with the reason in front of it:
 *
 *     ITEM NOT ALLOWED|ADDITIVES IN48808|CheckItems|
 *     NO SECUREFUEL DATA IN0037110997|No Carrier SecureFuel Event|
 *     LIMIT EXCEEDED IN1744180676|CheckItems|ULSR |
 *
 * The menu truncated that at 40 characters, so the Error filter offered rows like
 * "18 — ITEM NOT ALLOWED|ADDITIVES IN48808|C" — the internal context winning the space the reason
 * needed. Taking the first segment and dropping the trailing `IN<digits>` transaction id gives
 * "ITEM NOT ALLOWED", "NO SECUREFUEL DATA", "LIMIT EXCEEDED", which is what somebody scanning
 * seventeen codes is looking for.
 *
 * ⚠ Only the MENU is shortened. The Description column on the table still shows the vendor's text in
 * full, because that trace is what an operator needs when they open the row it belongs to — the rule
 * here is about a dropdown's width, not about what a decline says.
 */
const readableReason = (raw: string): string => {
  const head = raw.split("|")[0]!.replace(/\s+IN\d+$/, "").trim();
  // A first segment that is ONLY a transaction id says nothing a person can act on. The whole
  // description at least has words in it, so that is the honest fallback rather than an id in a menu.
  return head === "" || /^IN\d+$/.test(head) ? raw : head;
};

/** One `(facet, value, label)` row as 0313/0314 return it. */
interface FacetRow {
  facet: string;
  value: string;
  label: string | null;
}

/**
 * The values for one facet, ordered the way a human reads a truck number.
 *
 * The sort stays HERE rather than in SQL on purpose: `localeCompare(..., { numeric: true })` puts unit
 * 9 before unit 10, and no collation available to those functions reproduces that. The functions
 * return values; the menu decides their order.
 */
const valuesFor = (rows: FacetRow[], facet: string): string[] =>
  rows
    .filter((r) => r.facet === facet && r.value.trim() !== "")
    .map((r) => r.value)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

export function useEfsFacets() {
  return useQuery({
    queryKey: ["efs_facets"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<EfsFacets> => {
      const [t, d] = await Promise.all([
        supabase.rpc("efs_transaction_facets"),
        supabase.rpc("decline_facets"),
      ]);
      if (t.error) throw new Error(t.error.message);
      if (d.error) throw new Error(d.error.message);
      const txn = (t.data ?? []) as FacetRow[];
      const rej = (d.data ?? []) as FacetRow[];
      return {
        txnItems: valuesFor(txn, "item"),
        txnStates: valuesFor(txn, "state"),
        txnDrivers: valuesFor(txn, "driver"),
        txnUnits: valuesFor(txn, "unit"),
        // The code is the value and the description is what makes it readable — "51" means nothing in
        // a menu and "51 — INVALID DRIVER ID" means something. Truncated here, where the menu's width
        // lives; 0314 decides WHICH description, deterministically, which "the first row we saw" was
        // not once the read was capped.
        rejErrorCodes: rej
          .filter((r) => r.facet === "error_code")
          .sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }))
          .map((r) => ({
            code: r.value,
            label: r.label ? `${r.value} — ${readableReason(r.label).slice(0, 40)}` : r.value,
          })),
        rejStates: valuesFor(rej, "state"),
        rejDrivers: valuesFor(rej, "driver"),
        rejPolicies: valuesFor(rej, "policy"),
        rejUnits: valuesFor(rej, "unit"),
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
  const unitNumbers = computed(() =>
    [...new Set((vehicles.value ?? []).map((v) => v.unit_number).filter((u) => u && u.trim() !== ""))],
  );

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
