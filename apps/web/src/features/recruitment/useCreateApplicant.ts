import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { DriverListItem } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";
import { pipelineKey } from "@/features/recruitment/useEmployment";

/**
 * Creating the applicant (U1).
 *
 * ── WHY THIS GOES THROUGH THE API AND NOT POSTGREST ────────────────────────────────────────────
 * `useCreateDriver` (composables/useDrivers.ts) inserts straight into `drivers` through the client,
 * which is what the fleet's own New-driver drawer has always done. 0212 grants the recruiter that
 * INSERT, so the shortcut would work. It would also skip `driverCreateSchema`, skip the
 * `driver.created` audit row, and skip `identity_source: 'manual'` — and the last one matters most
 * here: a row the Samsara sync believes it owns has its name and phone overwritten on the next poll,
 * and an applicant is by definition not in anybody's telematics yet. `POST /api/roster/drivers`
 * does all three (routes/roster/drivers.ts), and 0212's own header says the route admits
 * `rolesThatManage("recruitment")` for exactly this reason.
 *
 * ── AN APPLICANT IS A `drivers` ROW WITH `status = 'applicant'` ────────────────────────────────
 * D-HIRE2's boundary, and the pipeline reads it literally: `GET /api/recruitment/pipeline` selects
 * `.eq("status", "applicant")`. Nothing else makes somebody appear on the board, so `status` is sent
 * explicitly rather than left to the contract's `"active"` default — which would create a driver on
 * the roster and an applicant nowhere.
 */
export interface NewApplicant {
  first_name: string;
  last_name: string;
  email: string | null;
}

export function useCreateApplicant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewApplicant): Promise<DriverListItem> => {
      const res = await apiFetch<{ driver: DriverListItem }>("/api/roster/drivers", {
        method: "POST",
        body: {
          first_name: input.first_name,
          last_name: input.last_name,
          email: input.email,
          status: "applicant",
        },
      });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not create the applicant.");
      return res.data.driver;
    },
    // The board and the roster both gained a row; neither is derived from the other.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pipelineKey });
      void qc.invalidateQueries({ queryKey: ["drivers"] });
    },
  });
}
