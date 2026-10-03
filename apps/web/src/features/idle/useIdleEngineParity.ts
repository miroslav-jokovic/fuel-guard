import { useQuery } from "@tanstack/vue-query";
import type { IdleParityReport, IdleParityTruck } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/** `GET /api/idle/engine/parity` (IE5, D-IE9): the server's report, units attached. */
export interface IdleEngineParityView extends Omit<IdleParityReport, "disagreements"> {
  timezone: string;
  disagreements: (IdleParityTruck & { unit: string })[];
}

/**
 * Has the new idle engine agreed with the trucks' own computers on enough days to be switched on? The
 * gate is the server's; this composable only reads it.
 */
export function useIdleEngineParity() {
  return useQuery({
    queryKey: ["idle_engine_parity"],
    queryFn: async (): Promise<IdleEngineParityView> => {
      const res = await apiFetch<{ ok: boolean; data?: IdleEngineParityView; error?: { message?: string } }>(
        "/api/idle/engine/parity",
      );
      if (!res.ok || !res.data?.ok || !res.data.data) {
        throw new Error(res.data?.error?.message ?? res.error?.message ?? "Could not read the idle engine check");
      }
      return res.data.data;
    },
    // The verdict moves once a night, when the nightly run finishes a day.
    staleTime: 600_000,
  });
}
