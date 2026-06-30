import { type Ref, toValue } from "vue";
import { useInfiniteQuery } from "@tanstack/vue-query";
import type { EfsTransactionRow, DeclinedTransactionRow } from "@fleetguard/shared";
import { supabase } from "@/lib/supabase";

const PAGE = 100;

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

/** Faithful EFS transaction rows, newest first, paginated (the system of record — docs/10). */
export function useEfsTransactions(filters: Ref<EfsFilters>) {
  return useInfiniteQuery({
    queryKey: ["efs_transactions", filters],
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<EfsTransactionRow[]> => {
      const f = toValue(filters);
      let q = supabase
        .from("efs_transactions")
        .select(EFS_COLS)
        .order("tran_date", { ascending: false })
        .order("line_number", { ascending: true })
        .range(pageParam, pageParam + PAGE - 1);
      if (f.unit) q = q.eq("unit", f.unit);
      if (f.from) q = q.gte("tran_date", f.from);
      if (f.to) q = q.lte("tran_date", f.to);
      if (f.search) q = q.or(ilikeOr(f.search, ["driver_name", "location_name", "item", "city"]));
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as EfsTransactionRow[];
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE ? allPages.length * PAGE : undefined,
  });
}

const DECLINED_COLS =
  "id, declined_at, card_ref, invoice, location_id, location_text, city, state, unit, driver_ext_id, driver_name, error_code, error_description, policy, policy_name";

/** Faithful declined (Reject Report) rows, newest first, paginated. */
export function useDeclinedTransactions(filters: Ref<EfsFilters>) {
  return useInfiniteQuery({
    queryKey: ["declined_transactions", filters],
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<DeclinedTransactionRow[]> => {
      const f = toValue(filters);
      let q = supabase
        .from("declined_transactions")
        .select(DECLINED_COLS)
        .order("declined_at", { ascending: false })
        .range(pageParam, pageParam + PAGE - 1);
      if (f.unit) q = q.eq("unit", f.unit);
      if (f.from) q = q.gte("declined_at", f.from);
      if (f.to) q = q.lte("declined_at", f.to);
      if (f.search) q = q.or(ilikeOr(f.search, ["driver_name", "error_description", "location_text", "error_code"]));
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as DeclinedTransactionRow[];
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE ? allPages.length * PAGE : undefined,
  });
}
