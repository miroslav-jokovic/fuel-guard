import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { InquiryAttempt, InquiryKind, InquiryOutcomeUpdate } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";

/** `/api/recruitment/inquiries` — the §391.23(c)(2) written record (E3). */

export interface EmployerInquiry {
  id: string;
  employment_id: string;
  kind: InquiryKind;
  employer_name: string;
  employer_address: string | null;
  method: string;
  sent_to: string;
  contacted_on: string;
  wording_version: string;
  outcome: string;
  outcome_on: string | null;
  outcome_note: string | null;
  document_id: string | null;
  created_at: string;
}

export interface InquiryPreview {
  title: string;
  version: string;
  citation: string;
  body: string;
  draft: boolean;
  sendTo: string | null;
}

const inquiriesKey = (driverId: string) => ["recruitment", "inquiries", driverId] as const;

export function useInquiriesQuery(driverId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => inquiriesKey(driverId.value)),
    enabled: computed(() => Boolean(driverId.value)),
    queryFn: async (): Promise<EmployerInquiry[]> => {
      const res = await apiFetch<{ inquiries: EmployerInquiry[] }>(
        `/api/recruitment/drivers/${driverId.value}/inquiries`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the inquiries.");
      return res.data.inquiries;
    },
  });
}

/**
 * The letter, composed server-side. Fetched fresh whenever the drawer opens rather than cached: it
 * carries the driver's and the carrier's names, and a preview left over from a different driver is
 * the one mistake this screen must never make.
 */
export function useInquiryPreview(employmentId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ["recruitment", "inquiry-preview", employmentId.value] as const),
    enabled: computed(() => Boolean(employmentId.value)),
    staleTime: 0,
    queryFn: async (): Promise<InquiryPreview> => {
      const res = await apiFetch<InquiryPreview>(
        `/api/recruitment/employment/${employmentId.value}/inquiry-preview`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not compose the letter.");
      return res.data;
    },
  });
}

/** Every mutation invalidates the driver's inquiries AND their employment list — `inquiry_status`
 *  is derived from these rows, so the two would otherwise disagree on screen. */
function useInvalidate() {
  const qc = useQueryClient();
  return (driverId: string) => {
    void qc.invalidateQueries({ queryKey: inquiriesKey(driverId) });
    void qc.invalidateQueries({ queryKey: ["recruitment", "employment", driverId] });
    void qc.invalidateQueries({ queryKey: ["recruitment", "pipeline"] });
  };
}

export function useRecordInquiry() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (payload: { driverId: string; input: InquiryAttempt }): Promise<{ id: string }> => {
      const res = await apiFetch<{ id: string }>("/api/recruitment/inquiries", {
        method: "POST",
        body: payload.input,
      });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not record the inquiry.");
      return res.data;
    },
    onSuccess: (_r, payload) => invalidate(payload.driverId),
  });
}

export function useRecordInquiryOutcome() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (payload: { id: string; driverId: string; input: InquiryOutcomeUpdate }): Promise<void> => {
      const res = await apiFetch(`/api/recruitment/inquiries/${payload.id}/outcome`, {
        method: "POST",
        body: payload.input,
      });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not record what came back.");
    },
    onSuccess: (_r, payload) => invalidate(payload.driverId),
  });
}
