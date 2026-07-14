import { type Ref, toValue } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import type { EfsTransactionRow, DeclinedTransactionRow } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";

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

/** Faithful EFS transaction rows, newest first, one page (20) with total count for navigation. */
export function useEfsTransactions(filters: Ref<EfsFilters>, page: Ref<number>) {
  return useQuery({
    queryKey: ["efs_transactions", filters, page],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Page<EfsTransactionRow>> => {
      const f = toValue(filters);
      const start = (toValue(page) - 1) * EFS_PAGE_SIZE;
      let q = supabase
        .from("efs_transactions")
        .select(EFS_COLS, { count: "exact" })
        // nullsFirst:false — undated lines (fee/DEF/footer rows with no Tran Date) must sort to the BOTTOM,
        // not float to the top of a DESC sort (Postgres defaults to NULLS FIRST on descending).
        .order(f.sortKey ?? "tran_date", { ascending: f.sortKey ? f.sortDir !== "desc" : false, nullsFirst: false })
        .order("line_number", { ascending: true })
        .range(start, start + EFS_PAGE_SIZE - 1);
      if (f.unit) q = q.eq("unit", f.unit);
      if (f.item) q = q.eq("item", f.item);
      if (f.state) q = q.eq("state", f.state);
      if (f.driver) q = q.eq("driver_name", f.driver);
      if (f.from) q = q.gte("tran_date", f.from);
      if (f.to) q = q.lte("tran_date", f.to);
      if (f.search) q = q.or(ilikeOr(f.search, ["unit", "driver_name", "card_num", "invoice", "location_name", "item", "city"]));
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as EfsTransactionRow[], total: count ?? 0 };
    },
  });
}

const DECLINED_COLS =
  "id, declined_at, card_ref, invoice, location_id, location_text, city, state, unit, driver_ext_id, driver_name, error_code, error_description, policy, policy_name, suspicion_level, suspicion_reasons";

/** Faithful declined (Reject Report) rows, newest first, one page (20) with total count. */
export function useDeclinedTransactions(filters: Ref<EfsFilters>, page: Ref<number>) {
  return useQuery({
    queryKey: ["declined_transactions", filters, page],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Page<DeclinedTransactionRow>> => {
      const f = toValue(filters);
      const start = (toValue(page) - 1) * EFS_PAGE_SIZE;
      let q = supabase
        .from("declined_transactions")
        .select(DECLINED_COLS, { count: "exact" })
        .order(f.sortKey ?? "declined_at", { ascending: f.sortKey ? f.sortDir !== "desc" : false, nullsFirst: false })
        .range(start, start + EFS_PAGE_SIZE - 1);
      if (f.unit) q = q.eq("unit", f.unit);
      if (f.suspicion) q = q.eq("suspicion_level", f.suspicion);
      if (f.errorCode) q = q.eq("error_code", f.errorCode);
      if (f.state) q = q.eq("state", f.state);
      if (f.driver) q = q.eq("driver_name", f.driver);
      if (f.policy) q = q.eq("policy_name", f.policy);
      if (f.from) q = q.gte("declined_at", f.from);
      if (f.to) q = q.lte("declined_at", f.to);
      if (f.search) {
        const t = f.search.replace(/[%,()]/g, "");
        q = q.or(
          [`unit.ilike.${t}%`, `driver_name.ilike.%${t}%`, `location_text.ilike.%${t}%`, `city.ilike.%${t}%`, `error_description.ilike.%${t}%`].join(
            ",",
          ),
        );
      }
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
