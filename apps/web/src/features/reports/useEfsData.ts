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
  "id, line_number, card_num, tran_date, invoice, unit, driver_name, odometer, location_name, city, state, fees, item, unit_price, qty, amt, db, currency";

export interface EfsFilters {
  unit?: string;
  from?: string; // YYYY-MM-DD
  to?: string;
  search?: string; // free text (driver / location / item or error)
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
        .order("tran_date", { ascending: false })
        .order("line_number", { ascending: true })
        .range(start, start + EFS_PAGE_SIZE - 1);
      if (f.unit) q = q.eq("unit", f.unit);
      if (f.from) q = q.gte("tran_date", f.from);
      if (f.to) q = q.lte("tran_date", f.to);
      if (f.search) q = q.or(ilikeOr(f.search, ["driver_name", "location_name", "item", "city"]));
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as EfsTransactionRow[], total: count ?? 0 };
    },
  });
}

const DECLINED_COLS =
  "id, declined_at, card_ref, invoice, location_id, location_text, city, state, unit, driver_ext_id, driver_name, error_code, error_description, policy, policy_name";

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
        .order("declined_at", { ascending: false })
        .range(start, start + EFS_PAGE_SIZE - 1);
      if (f.unit) q = q.eq("unit", f.unit);
      if (f.from) q = q.gte("declined_at", f.from);
      if (f.to) q = q.lte("declined_at", f.to);
      if (f.search) q = q.or(ilikeOr(f.search, ["driver_name", "error_description", "location_text", "error_code"]));
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as DeclinedTransactionRow[], total: count ?? 0 };
    },
  });
}
