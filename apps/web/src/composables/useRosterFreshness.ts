import { useQuery } from "@tanstack/vue-query";
import type { RosterFreshness } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

export const rosterFreshnessKey = ["roster-freshness"] as const;

/**
 * When McLeod's roster was last read (E6, D-MR2). Re-asked every minute, because the question it
 * answers is "has the agent stopped?", and a page left open is exactly where that goes unnoticed.
 */
export function useRosterFreshness() {
  return useQuery({
    queryKey: rosterFreshnessKey,
    queryFn: async (): Promise<RosterFreshness | null> => {
      const res = await apiFetch<RosterFreshness>("/api/integrations/mcleod/roster-freshness");
      return res.ok && res.data ? res.data : null;
    },
    refetchInterval: 60_000,
  });
}
