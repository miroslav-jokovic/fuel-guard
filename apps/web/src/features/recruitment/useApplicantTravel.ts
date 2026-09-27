import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { ApplicantTravel, ApplicantTravelBooking, ApplicantTravelList } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { applicantChecklistKey } from "@/features/recruitment/useApplicantChecklist";

/**
 * The applicant's trip to the office (D-AW7, APPLICATION-FLOW-V2-PLAN §7, C2b2).
 *
 * ⚠ Booking and cancelling both invalidate the CHECKLIST as well as the list: "Travel booked" is a
 * row the fold reads from these rows, and a drawer showing a trip over a row still saying "Waiting on
 * you" is the disagreement D-HM2 exists to prevent.
 */
const travelKey = (driverId: string) => ["recruitment", "travel", driverId] as const;

const base = (driverId: string) => `/api/recruitment/applicants/${encodeURIComponent(driverId)}/travel`;

export function useApplicantTravelQuery(driverId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => travelKey(driverId.value)),
    enabled: computed(() => Boolean(driverId.value)),
    queryFn: async (): Promise<ApplicantTravelList> => {
      const res = await apiFetch<ApplicantTravelList>(base(driverId.value));
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the trips.");
      return res.data;
    },
  });
}

function useTravelWrite<I extends { driverId: string }>(send: (input: I) => Promise<ApplicantTravel>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: (_r, input) => {
      void qc.invalidateQueries({ queryKey: travelKey(input.driverId) });
      void qc.invalidateQueries({ queryKey: applicantChecklistKey(input.driverId) });
    },
  });
}

/** The server's refusal carries its own words (`Travel waits for: …`), which is what the office reads. */
export function useBookTravel() {
  return useTravelWrite(async (input: { driverId: string; booking: ApplicantTravelBooking }) => {
    // ⚠ The object, never `JSON.stringify` — `apiFetch` serialises the body itself.
    const res = await apiFetch<{ trip: ApplicantTravel }>(base(input.driverId), { method: "POST", body: input.booking });
    if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not record the trip.");
    return res.data.trip;
  });
}

export function useCancelTravel() {
  return useTravelWrite(async (input: { driverId: string; travelId: string }) => {
    const res = await apiFetch<{ trip: ApplicantTravel }>(
      `${base(input.driverId)}/${encodeURIComponent(input.travelId)}`,
      { method: "DELETE" },
    );
    if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not cancel the trip.");
    return res.data.trip;
  });
}
