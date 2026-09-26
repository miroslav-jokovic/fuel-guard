import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { CarrierRepresentative, CarrierRepresentativeCreate, OfficeHandbookStatus } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { applicantChecklistKey } from "@/features/recruitment/useApplicantChecklist";

/**
 * The driver handbook's office reads and writes (HANDBOOK-SIGNING-PLAN.md HB4), on the recruitment
 * section's own door like the road test's (`useRoadTest.ts`).
 */
export const representativesKey = ["recruitment", "representatives"] as const;
export const handbookKey = (driverId: string) => ["recruitment", "handbook", driverId] as const;

export function useRepresentatives() {
  return useQuery({
    queryKey: representativesKey,
    queryFn: async (): Promise<CarrierRepresentative[]> => {
      const res = await apiFetch<{ representatives: CarrierRepresentative[] }>("/api/recruitment/representatives");
      if (!res.ok) throw new Error(res.error?.message ?? "Could not load the representatives.");
      return res.data?.representatives ?? [];
    },
  });
}

export function useAddRepresentative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CarrierRepresentativeCreate): Promise<CarrierRepresentative> => {
      const res = await apiFetch<{ representative: CarrierRepresentative }>("/api/recruitment/representatives", {
        method: "POST",
        body: input,
      });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not add the representative.");
      return res.data.representative;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: representativesKey }),
  });
}

export function useDeleteRepresentative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const res = await apiFetch(`/api/recruitment/representatives/${encodeURIComponent(id)}`, { method: "DELETE" });
      // The server's sentence for one who has signed a handbook is the one to show (409 `has_signed`).
      if (!res.ok) throw new Error(res.error?.message ?? "Could not remove the representative.");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: representativesKey }),
  });
}

export function useHandbookStatus(driverId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => handbookKey(driverId.value)),
    enabled: computed(() => Boolean(driverId.value)),
    // The driver signs on their own device while the office watches this drawer, so it keeps up.
    refetchInterval: 5_000,
    queryFn: async (): Promise<OfficeHandbookStatus> => {
      const res = await apiFetch<{ handbook: OfficeHandbookStatus }>(
        `/api/recruitment/applicants/${encodeURIComponent(driverId.value)}/handbook`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the handbook.");
      return res.data.handbook;
    },
  });
}

function useHandbookAct<T>(driverId: Ref<string>, path: string, fallback: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body?: T): Promise<void> => {
      const res = await apiFetch(`/api/recruitment/applicants/${encodeURIComponent(driverId.value)}/handbook/${path}`, {
        method: "POST",
        body: body ?? {},
      });
      if (!res.ok) throw new Error(res.error?.message ?? fallback);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: handbookKey(driverId.value) });
      // The filed handbook is evidence in the file AND what turns the step green.
      void qc.invalidateQueries({ queryKey: ["compliance"] });
      void qc.invalidateQueries({ queryKey: applicantChecklistKey(driverId.value) });
    },
  });
}

export const useOpenHandbook = (driverId: Ref<string>) =>
  useHandbookAct<never>(driverId, "open", "Could not open handbook signing.");

export const useCountersignHandbook = (driverId: Ref<string>) =>
  useHandbookAct<{ representative_id: string }>(driverId, "countersign", "Could not countersign the handbook.");
