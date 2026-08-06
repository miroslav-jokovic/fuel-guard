import { computed, type Ref } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { CertificationCreateRequest, CertificationRow } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";

/**
 * Compliance (certifications) data layer for the web. Everything goes through /api/compliance/* :
 * the create path uses the insert_certification RPC (auto-supersede) and is role-gated + audited
 * server-side, so the web never writes certifications via PostgREST directly. The list query is
 * reactive to the selected subject so a driver/carrier picker refetches on change.
 */
const CERTS_KEY = ["compliance", "certs"] as const;

export function useCertificationsQuery(subjectType: Ref<string>, subjectId: Ref<string | null>) {
  return useQuery({
    queryKey: [...CERTS_KEY, subjectType, subjectId] as const,
    enabled: computed(() => !!subjectId.value),
    queryFn: async (): Promise<CertificationRow[]> => {
      const id = subjectId.value;
      if (!id) return [];
      const res = await apiFetch<{ certifications: CertificationRow[] }>(
        `/api/compliance/certifications?subjectType=${subjectType.value}&subjectId=${id}`,
      );
      if (!res.ok) throw new Error(res.error?.message ?? "Failed to load certifications.");
      return res.data?.certifications ?? [];
    },
  });
}

export function useCreateCertification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CertificationCreateRequest): Promise<{ id: string; supersededId: string | null }> => {
      const res = await apiFetch<{ id: string; supersededId: string | null }>(
        "/api/compliance/certifications",
        { method: "POST", body: input },
      );
      if (!res.ok) throw new Error(res.error?.message ?? "Failed to save the certification.");
      return res.data as { id: string; supersededId: string | null };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: CERTS_KEY }),
  });
}
