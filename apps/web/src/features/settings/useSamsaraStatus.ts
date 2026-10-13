import { useQuery } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";

/**
 * The Data & sync page's two Samsara status reads, as queries (F5, US6b). They were `onMounted`
 * fetches into refs with a red line on failure and no Retry; a query keeps the failure as state the
 * card draws through `QueryState`, and its `refetch` is the Retry.
 */
async function read<T>(path: string): Promise<T> {
  const res = await apiFetch<T>(path);
  if (!res.ok || res.data == null) throw new Error(res.error?.message ?? `Could not read ${path}`);
  return res.data;
}

/**
 * Samsara webhook readiness (SAMSARA-COLLECTION-PLAN S1).
 *
 * The sudden-fuel-drop receiver had been unreachable since it was built — the vendor console pointed
 * at the mount prefix rather than the route, and the signing secret was never set, so it answered 401
 * to anything that did arrive. Neither end complained, and `fuel_events` sat at 0 rows for six months
 * looking exactly like a fleet with no siphoning. Both fixes are console/Railway settings; what
 * belongs here is the part that was actually missing, which is any way to SEE it from the product.
 *
 * The counts are all-time on purpose (D-SAM7): a windowed zero reads as a quiet week, and the state
 * worth catching is a receiver that has never been reachable at all.
 */
export interface WebhookStatus {
  secretConfigured: boolean;
  endpointPath: string;
  endpointUrl: string | null;
  eventCount: number;
  /** Drops that arrived but are not believed, because the truck's fuel sensor is not trusted yet. */
  unverifiedCount: number;
  lastEventAt: string | null;
}
export const useWebhookStatusQuery = () =>
  useQuery({
    queryKey: ["samsara", "webhook-status"],
    queryFn: () => read<WebhookStatus>("/api/integrations/samsara/webhook"),
  });

/**
 * Telematics history coverage (SAMSARA-COLLECTION-PLAN S4, D-SAM7).
 *
 * ⚠ ALL-TIME, and it has no window control ON PURPOSE. The Coverage page shows the same idea over 90
 * days and reads ~95%; across the whole history the figure was 23%, because 76.8% of fills had never
 * had telematics fetched at all. Both were true and one was useless — a coverage figure whose scope
 * hides the gap turns an unanswered question into a reassuring answer.
 *
 * The three states are shown apart because they need different actions and only one of them improves
 * by waiting: **corroborated**, **no history at Samsara** (a permanent answer), and **not fetched yet**
 * (the collector tier is still working through these, oldest first).
 */
export interface CoverageMonth {
  month: string;
  fills: number;
  reconciled: number;
  noData: number;
  pending: number;
  coveragePct: number;
}
export interface TelematicsCoverage {
  fills: number;
  reconciled: number;
  noData: number;
  pending: number;
  coveragePct: number;
  attainablePct: number | null;
  byMonth: CoverageMonth[];
}
export const useTelematicsCoverageQuery = () =>
  useQuery({
    queryKey: ["samsara", "telematics-coverage"],
    queryFn: () => read<TelematicsCoverage>("/api/integrations/samsara/telematics-coverage"),
  });
