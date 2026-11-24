/**
 * A recorded weekly Pilot bill, rebuilt in the old statement's columns — `GET
 * /api/fueling/statements/:id/weekly-bill`. The server builds it (`weeklyBillRead.ts`); the page only shows
 * it, so the page and the Excel download are the same figures.
 */
import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { WeeklyBillReport } from "@silvicom/shared";
import { recordOrThrow } from "@silvicom/ui";
import { apiFetch } from "@/lib/api";

export interface WeeklyBillStatement {
  id: string;
  invoiceNo: string;
  accountNo: string | null;
  periodStart: string;
  periodEnd: string;
  billingDate: string | null;
  sourceFilename: string | null;
  printed: { amount: number | null; retail: number | null; savings: number | null };
  supersededBy: string | null;
}

export interface WeeklyBill {
  statement: WeeklyBillStatement;
  report: WeeklyBillReport;
}

export function useWeeklyBillQuery(statementId: Ref<string>) {
  return useQuery({
    queryKey: ["fuel_statements", "weekly-bill", statementId],
    enabled: computed(() => statementId.value !== ""),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<WeeklyBill> => {
      const data = recordOrThrow(
        await apiFetch<{ ok: boolean } & WeeklyBill>(`/api/fueling/statements/${encodeURIComponent(statementId.value)}/weekly-bill`),
        "Could not load the statement",
      );
      return { statement: data.statement, report: data.report };
    },
  });
}
