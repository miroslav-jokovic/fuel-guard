import { useQuery } from "@tanstack/vue-query";
import type { RosterHeld } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

export const rosterHeldKey = ["roster-held"] as const;

/**
 * McLeod drivers the roster sweep held for a person (ROSTER-LIFECYCLE-PLAN RL3). The list moves at most
 * once per sweep (every 15 minutes), so it is re-asked every five, not every one like the freshness line.
 */
export function useRosterHeld() {
  return useQuery({
    queryKey: rosterHeldKey,
    queryFn: async (): Promise<RosterHeld | null> => {
      const res = await apiFetch<RosterHeld>("/api/integrations/mcleod/roster-held");
      return res.ok && res.data ? res.data : null;
    },
    refetchInterval: 5 * 60_000,
  });
}
