import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type {
  CarrierStep,
  CarrierStepCreate,
  CarrierStepLatest,
  CarrierStepRecordInput,
  CarrierStepUpdate,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { applicantChecklistKey } from "@/features/recruitment/useApplicantChecklist";
import { pipelineKey } from "@/features/recruitment/useEmployment";

/**
 * The carrier's own hiring steps (HIRING-WORKFLOW-AUDIT §10 CE2, 0545): the list in Settings →
 * Recruiting, and the office's done / undone on one applicant's checklist.
 *
 * A change to the list changes every applicant's checklist (a new step shows on all of them; one that
 * holds the hire holds every hire), so it invalidates the board and every checklist, not only the list —
 * `useOrientationVideos`' rule.
 */

export const carrierStepsKey = ["recruitment", "carrier-steps"] as const;

export function useCarrierSteps() {
  return useQuery({
    queryKey: carrierStepsKey,
    queryFn: async (): Promise<CarrierStep[]> => {
      const res = await apiFetch<{ steps: CarrierStep[] }>("/api/recruitment/carrier-steps");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load your hiring steps.");
      return res.data.steps;
    },
  });
}

function useInvalidateSteps() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: carrierStepsKey });
    void qc.invalidateQueries({ queryKey: ["recruitment", "checklist"] });
    void qc.invalidateQueries({ queryKey: pipelineKey });
  };
}

export function useAddCarrierStep() {
  const invalidate = useInvalidateSteps();
  return useMutation({
    mutationFn: async (input: CarrierStepCreate): Promise<CarrierStep> => {
      const res = await apiFetch<{ step: CarrierStep }>("/api/recruitment/carrier-steps", { method: "POST", body: input });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not add the step.");
      return res.data.step;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateCarrierStep() {
  const invalidate = useInvalidateSteps();
  return useMutation({
    mutationFn: async (v: { id: string; patch: CarrierStepUpdate }): Promise<CarrierStep> => {
      const res = await apiFetch<{ step: CarrierStep }>(`/api/recruitment/carrier-steps/${v.id}`, { method: "PATCH", body: v.patch });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not change the step.");
      return res.data.step;
    },
    onSuccess: invalidate,
  });
}

export function useRecordCarrierStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { driverId: string; stepId: string; input: CarrierStepRecordInput }): Promise<CarrierStepLatest> => {
      const res = await apiFetch<{ latest: CarrierStepLatest }>(
        `/api/recruitment/applicants/${v.driverId}/carrier-steps/${v.stepId}`, { method: "POST", body: v.input },
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not record the step.");
      return res.data.latest;
    },
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: applicantChecklistKey(v.driverId) });
      void qc.invalidateQueries({ queryKey: pipelineKey });
    },
  });
}
