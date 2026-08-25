/**
 * The statements we have kept, read back (WP6).
 *
 * Until this existed, an upload rendered once and was gone on refresh, so the analytics had nowhere to
 * read from and the discount, ONE9 and California findings lived in test output rather than on a
 * screen. These queries are what make the surface survive a page load.
 *
 * Reads go straight to PostgREST: `fuel_statements` and `fuel_statement_lines` each carry an org-scoped
 * SELECT policy and no client write policy at all (0243), so a browser can read its own carrier's
 * statements and cannot assert one.
 */
import { computed, type Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import type { SpendLine } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";

export interface StatementSummary {
  id: string;
  invoiceNo: string;
  periodStart: string;
  periodEnd: string;
  billingDate: string | null;
  totalGallons: number;
  fuelAmount: number;
  invoiceTotal: number;
  retailTotal: number;
  savings: number;
  lineCount: number;
  sourceFilename: string | null;
  hasSource: boolean;
  createdAt: string;
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const str = (v: unknown): string | null => (v == null ? null : String(v));

/**
 * Live statements only — a superseded one is history, not a week to read totals from — and only the
 * ones OVERLAPPING the window the page is set to.
 *
 * ── WHY THE WINDOW IS AN ARGUMENT AND NOT AN AFTERTHOUGHT ───────────────────────────────────────
 * This query used to take no window at all and return every statement ever kept, while the filter bar
 * above it rendered a date range, a truck picker and a fill count — none of which reached it. The page
 * carried a `scope` selector to compensate, and that selector was never rendered, so it was pinned to
 * "all" and the two dead branches beside it could not be reached. The visible effect was a tab whose
 * controls did nothing.
 *
 * `useSpendFilters` exists to end exactly this: one period, read by every tab, so a figure quoted off
 * one is the same weeks as a figure quoted off the next. A statement is a week-long period, so it is
 * selected by OVERLAP rather than containment — a statement running Mon–Sun belongs in a window that
 * starts on the Wednesday, because part of its spend happened inside.
 */
export function useStatementsQuery(window: Ref<{ from: string; to: string }>) {
  return useQuery({
    queryKey: ["fuel_statements", window],
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: async (): Promise<StatementSummary[]> => {
      const w = window.value;
      const { data, error } = await supabase
        .from("fuel_statements")
        .select(
          "id, invoice_no, period_start, period_end, billing_date, total_gallons, fuel_amount, invoice_total, retail_total, savings, line_count, source_filename, source_path, created_at",
        )
        .is("superseded_by", null)
        // Overlap, not containment: starts on or before the window ends, ends on or after it starts.
        .lte("period_start", w.to)
        .gte("period_end", w.from)
        .order("period_start", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        invoiceNo: String(r.invoice_no ?? ""),
        periodStart: String(r.period_start ?? ""),
        periodEnd: String(r.period_end ?? ""),
        billingDate: str(r.billing_date),
        totalGallons: num(r.total_gallons),
        fuelAmount: num(r.fuel_amount),
        invoiceTotal: num(r.invoice_total),
        retailTotal: num(r.retail_total),
        savings: num(r.savings),
        lineCount: Number(r.line_count ?? 0),
        sourceFilename: str(r.source_filename),
        hasSource: r.source_path != null,
        createdAt: String(r.created_at ?? ""),
      }));
    },
  });
}

/**
 * Every line of the given statements, as the analytics' `SpendLine`.
 *
 * Paged deliberately: a week is ~800 lines, so a year is ~40,000 and PostgREST caps a response anyway.
 * Same 1,000-row page the recorded-fills query already uses.
 */
export function useStatementLinesQuery(statementIds: Ref<string[]>) {
  return useQuery({
    queryKey: ["fuel_statement_lines", statementIds],
    enabled: computed(() => statementIds.value.length > 0),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: async (): Promise<SpendLine[]> => {
      const ids = statementIds.value;
      if (ids.length === 0) return [];
      const PAGE = 1000;
      const out: SpendLine[] = [];
      for (let start = 0; ; start += PAGE) {
        const { data, error } = await supabase
          .from("fuel_statement_lines")
          .select(
            "tran_date, brand, state, site_number, city, unit_number, po_name, product, tank_type, gallons, fuel_amount, retail_total, misc_amount, sales_tax",
          )
          .in("statement_id", ids)
          .order("tran_date", { ascending: true })
          .range(start, start + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as Record<string, unknown>[];
        for (const r of batch) {
          out.push({
            tranDate: str(r.tran_date),
            brand: str(r.brand),
            state: str(r.state),
            site: str(r.site_number),
            city: str(r.city),
            unit: str(r.unit_number),
            driver: str(r.po_name),
            product: (str(r.product) ?? "other") as SpendLine["product"],
            tank: str(r.tank_type) as SpendLine["tank"],
            gallons: num(r.gallons),
            netAmount: r.fuel_amount == null ? null : num(r.fuel_amount),
            retailAmount: r.retail_total == null ? null : num(r.retail_total),
            miscAmount: r.misc_amount == null ? null : num(r.misc_amount),
            salesTax: r.sales_tax == null ? null : num(r.sales_tax),
          });
        }
        if (batch.length < PAGE) break;
      }
      return out;
    },
  });
}

/** A signed URL for a statement's original PDF — the evidence behind every figure on the page. */
export async function statementSourceUrl(statementId: string): Promise<string> {
  const { apiFetch } = await import("@/lib/api");
  const res = await apiFetch<{ url: string }>(`/api/fueling/statements/${statementId}/source`);
  if (!res.ok || !res.data?.url) throw new Error(res.error?.message ?? "Could not open the statement");
  return res.data.url;
}
