import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { AdsConnectionReport, AdsConnectionView, AdsMetaConnect } from "@silvicom/shared";
import { apiFetch, type ApiResult } from "@/lib/api";
import { apiRefusal } from "@/composables/useStepUpRetry";

/**
 * Settings › Ads control's ad accounts (E1b) — wraps `/api/ads/connections` (routes/connections.ts, B1b).
 * Connect, connect the simulator and disconnect are `ads.connection` with a fresh sign-in, so their
 * refusals keep the API's `code` for `useStepUpRetry`; Test is the same capability without the prompt.
 *
 * A connect Meta refuses (422 `token_refused`) stores nothing, so its report exists only in that answer:
 * the error carries it, for the form to show which check failed.
 */
export const ADS_CONNECTIONS_KEY = ["ads", "connections"] as const;

export type ConnectionRefusal = Error & { code: string; report?: AdsConnectionReport };

export function useAdsConnections() {
  return useQuery({
    queryKey: ADS_CONNECTIONS_KEY,
    queryFn: async (): Promise<AdsConnectionView[]> => {
      const res = await apiFetch<{ connections: AdsConnectionView[] }>("/api/ads/connections");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the ad accounts");
      return res.data.connections;
    },
  });
}

export type ConnectionAct = { kind: "meta"; ask: AdsMetaConnect } | { kind: "simulator" } | { kind: "test"; id: string } | { kind: "disconnect"; id: string };

/** The door each act knocks on (routes/connections.ts) and what it sends: only a Meta connect has a body. */
export function connectionRequest(act: ConnectionAct): { path: string; body: object } {
  switch (act.kind) {
    case "meta": return { path: "/api/ads/connections/meta", body: act.ask };
    case "simulator": return { path: "/api/ads/connections/simulator", body: {} };
    case "test": return { path: `/api/ads/connections/${act.id}/test`, body: {} };
    case "disconnect": return { path: `/api/ads/connections/${act.id}/disconnect`, body: {} };
  }
}

const FAILED: Record<ConnectionAct["kind"], string> = {
  meta: "Could not connect the Meta account", simulator: "Could not connect the simulator",
  test: "Could not test the connection", disconnect: "Could not disconnect",
};

/** A refused act as an Error with the API's `code` (for `useStepUpRetry`) and, from a refused connect, its report. */
export function connectionRefusal(res: Pick<ApiResult<unknown>, "error" | "detail">, kind: ConnectionAct["kind"]): ConnectionRefusal {
  const refusal = apiRefusal(res.error, FAILED[kind]) as ConnectionRefusal;
  const report = res.detail?.report as AdsConnectionReport | undefined;
  if (report) refusal.report = report;
  return refusal;
}

/** One mutation for the four acts: each answers the stored connection, and each refreshes the list. */
export function useConnectionAct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (act: ConnectionAct): Promise<{ connection: AdsConnectionView; report?: AdsConnectionReport }> => {
      const { path, body } = connectionRequest(act);
      const res = await apiFetch<{ connection: AdsConnectionView; report?: AdsConnectionReport }>(path, { method: "POST", body });
      if (!res.ok || !res.data) throw connectionRefusal(res, act.kind);
      return res.data;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ADS_CONNECTIONS_KEY }),
  });
}
