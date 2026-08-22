import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { canViewSection, type DashboardComplianceCounts } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";
import { useSessionStore } from "@/stores/session";

/**
 * The dashboard's three §391 numbers (UI plan U2, D-UI2).
 *
 * ⚠ The query is DISABLED for a role that may see neither section, rather than being fetched and
 * hidden. The dashboard is ungated so drivers keep it, and a driver's browser should not be making
 * a request whose entire answer would be three nulls.
 */
export function useComplianceCountsQuery() {
  const session = useSessionStore();
  const relevant = computed(
    () => canViewSection(session.role, "fleet") || canViewSection(session.role, "recruitment"),
  );
  return useQuery({
    queryKey: ["dashboard", "compliance-counts"] as const,
    enabled: relevant,
    // The same reasoning `useComplianceOverviewQuery` gives for its own five minutes: expiry dates
    // move once a day at most, and polling a fleet-wide rollup re-answers a question nobody asked.
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<DashboardComplianceCounts> => {
      const res = await apiFetch<DashboardComplianceCounts>("/api/dashboard/compliance-counts");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the compliance counts.");
      return res.data;
    },
  });
}
