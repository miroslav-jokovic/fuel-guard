import { computed, type Ref } from "vue";
import { keepPreviousData, useQuery } from "@tanstack/vue-query";
import { exclusiveEndYmd, lastPrintableRun, type CoverageMonth, type RollupAnswer, type RollupBucket, type RollupKind } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { ymd } from "@/lib/dateWindow";

/**
 * The Shop's Repair cost tab, client side (FLEETPAL-INTEGRATION-PLAN.md F9d). Two reads, both behind
 * the maintenance section's view gate on the API.
 *
 * ── WHY THE COVERAGE IS READ FIRST ────────────────────────────────────────────────────────────
 * The roll-up refuses (409) any window that touches a month the ledger has not been swept for, and
 * the current month is ALWAYS such a month. A tab that opened on "the last twelve months to today"
 * would open on a refusal every single day. So the tab's default window is the newest run of months
 * the coverage endpoint says is printable (`lastPrintableRun`), and the roll-up waits for it.
 */

/** Unit rows per page. The API caps `limit` at 200; 25 is a screenful at 834 px. */
export const REPAIR_COST_PAGE_SIZE = 25;

/** Thirteen months back from today's: twelve full ones and the current, which is the one that refuses. */
function coverageProbeWindow(today = new Date()): { from: string; to: string } {
  return { from: ymd(new Date(today.getFullYear(), today.getMonth() - 12, 1)), to: ymd(new Date(today.getFullYear(), today.getMonth() + 1, 1)) };
}

/** The window the tab opens on — inclusive days — or null when no month in the last year is printable. */
export function useRepairCostDefaultWindow() {
  const probe = coverageProbeWindow();
  const q = useQuery({
    queryKey: ["maintenance", "fleetpal-coverage", probe] as const,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<CoverageMonth[]> => {
      const r = await apiFetch<{ months: CoverageMonth[] }>(`/api/maintenance/fleetpal/coverage?from=${probe.from}&to=${probe.to}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not read which months can be shown");
      return r.data.months;
    },
  });
  const window = computed(() => (q.data.value ? lastPrintableRun(q.data.value) : undefined));
  return { query: q, window };
}

export interface RepairCostFilter {
  /** Inclusive calendar days, as the date picker holds them. */
  from: string;
  to: string;
  bucket: RollupBucket;
  kind: RollupKind;
  page: number;
}

/** Either the answer, or the API's own sentence saying which months the ledger has not swept. */
export type RepairCostResult = { answer: RollupAnswer; unavailable: null } | { answer: null; unavailable: string };

export function useRepairCostQuery(filter: Ref<RepairCostFilter | null>) {
  return useQuery({
    queryKey: ["maintenance", "fleetpal-rollup", filter] as const,
    staleTime: 5 * 60_000,
    enabled: computed(() => filter.value !== null),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<RepairCostResult> => {
      const f = filter.value!;
      const params = new URLSearchParams({
        from: f.from,
        to: exclusiveEndYmd(f.to),
        bucket: f.bucket,
        kind: f.kind,
        limit: String(REPAIR_COST_PAGE_SIZE),
        offset: String((f.page - 1) * REPAIR_COST_PAGE_SIZE),
      });
      const r = await apiFetch<RollupAnswer>(`/api/maintenance/fleetpal/rollup?${params}`);
      // A refusal is an answer, not a failure: it names the months, and the reader can move the window.
      if (!r.ok && r.error?.code === "coverage_unavailable") return { answer: null, unavailable: r.error.message };
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the repair cost");
      return { answer: r.data, unavailable: null };
    },
  });
}
