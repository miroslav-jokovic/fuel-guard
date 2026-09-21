import { computed, type ComputedRef } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { supabase } from "@/lib/supabase";

/**
 * The carrier's operating timezone — the zone in which "a day" means what the office means by it
 * (DATA-PRECISION-AUDIT-2026-09-20 queue item 4, D-PREC5).
 *
 * ── WHY THIS IS A COMPOSABLE AND NOT FOUR `?? "America/Chicago"`s ──────────────────────────────
 * It was four. `useDashboard.ts`, `useDriverPerformance.ts` and `useAnomalyDetail.ts` each read
 * `organizations.operating_hours->>'tz'` inline with their own fallback, and `useOrgSettings.ts`
 * reads it as part of the whole settings row. Four reads of one fact is four chances for a surface
 * to default differently from the one beside it — and the audit's finding was precisely that two
 * tiles on the same card answered about different days without either saying which.
 *
 * ── WHY IT IS THE ORG'S ZONE AND NEVER THE VIEWER'S ────────────────────────────────────────────
 * A dispatcher in Chicago and an accountant travelling in Berlin must see the same number for
 * "08/09". The browser's zone is a property of who is looking, and a figure that changes with who is
 * looking is not a figure. Every surface here filtered on the BROWSER's midnight until 2026-09-21.
 *
 * ⚠ The fallback is `America/Chicago` because that is the column's own default
 * (`organizations.operating_hours` defaults to `{"tz": "America/Chicago", …}`), not because it is a
 * sensible guess. `isResolved` is exported so a caller that would rather render nothing than guess
 * can — **no caller does so today**, which is a real and stated limitation: a carrier whose zone is
 * not Central sees one frame computed against the fallback before the org row lands. Every query
 * that depends on the zone carries it in its KEY, so the correction is a refetch rather than a stale
 * number, but a reader watching closely will see the figure move once. Fixing that properly means
 * the zone arriving with the session rather than as a query, which is a change to `init()`'s
 * contract and belongs with queue item 5, not here.
 *
 * ⚠ It does NOT yet replace all four inline reads. `useDashboard.ts` and `useDriverPerformance.ts`
 * still read `operating_hours` themselves — both are inside the browser-side aggregation that queue
 * item 5 (D-PREC8) moves behind the API, and converting them here would be work done twice.
 * `useAnomalyDetail.ts` reads the whole org row for other fields as well.
 */
const FALLBACK_ZONE = "America/Chicago";

export function useOrgTimezoneQuery() {
  return useQuery({
    queryKey: ["org_timezone"],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("organizations")
        .select("operating_hours")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { operating_hours?: { tz?: string } } | null)?.operating_hours?.tz ?? null;
    },
    // The office does not move. Re-reading this on every window focus would be a query per surface
    // per tab-switch for a string that changes when somebody edits Settings.
    staleTime: 60 * 60_000,
  });
}

export interface OrgTimezone {
  /** The zone to reason about days in. Falls back to the column's own default before it loads. */
  zone: ComputedRef<string>;
  /** False until the org row has answered — a caller may prefer to render nothing over guessing. */
  isResolved: ComputedRef<boolean>;
}

export function useOrgTimezone(): OrgTimezone {
  const { data, isSuccess } = useOrgTimezoneQuery();
  return {
    zone: computed(() => data.value ?? FALLBACK_ZONE),
    isResolved: computed(() => isSuccess.value),
  };
}
