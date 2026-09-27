import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type {
  DrugTestAppointment,
  DrugTestAppointmentBooking,
  DrugTestAppointmentList,
  EmployerVerificationCall,
  EmployerVerificationCallInput,
  EmployerVerificationList,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { applicantChecklistKey } from "@/features/recruitment/useApplicantChecklist";

/**
 * The office's screening acts that are not evidence on their own (APPLICATION-FLOW-V2-PLAN §6.3, §6.5,
 * C2b3): the drug test's appointment (D-AW6), the driver's Clearinghouse portal consent (D-AW5), and the
 * phone calls to previous employers before filing (D-AW8).
 *
 * ⚠ Every write invalidates the CHECKLIST as well as its own list, for `useApplicantTravel.ts`'s reason:
 * the portal consent moves the Clearinghouse row from the driver's move to the office's, and a drawer
 * that showed the consent over a row still saying "Waiting on them" is the disagreement D-HM2 forbids.
 */
const applicant = (driverId: string) => `/api/recruitment/applicants/${encodeURIComponent(driverId)}`;

const drugTestKey = (driverId: string) => ["recruitment", "drug-test", driverId] as const;
const employerCallsKey = (driverId: string) => ["recruitment", "employer-calls", driverId] as const;

function listQuery<T>(key: (id: string) => readonly unknown[], path: string, what: string, driverId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => key(driverId.value)),
    enabled: computed(() => Boolean(driverId.value)),
    queryFn: async (): Promise<T> => {
      const res = await apiFetch<T>(`${applicant(driverId.value)}/${path}`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? `Could not load the ${what}.`);
      return res.data;
    },
  });
}

function useScreeningWrite<I extends { driverId: string }, R>(
  key: (id: string) => readonly unknown[],
  send: (input: I) => Promise<R>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: (_r, input) => {
      void qc.invalidateQueries({ queryKey: key(input.driverId) });
      void qc.invalidateQueries({ queryKey: applicantChecklistKey(input.driverId) });
    },
  });
}

export const useDrugTestAppointmentsQuery = (driverId: Ref<string>) =>
  listQuery<DrugTestAppointmentList>(drugTestKey, "drug-test-appointments", "appointments", driverId);

export function useArrangeDrugTest() {
  return useScreeningWrite(drugTestKey, async (input: { driverId: string; booking: DrugTestAppointmentBooking }) => {
    // ⚠ The object, never `JSON.stringify` — `apiFetch` serialises the body itself.
    const res = await apiFetch<{ appointment: DrugTestAppointment }>(
      `${applicant(input.driverId)}/drug-test-appointments`, { method: "POST", body: input.booking },
    );
    if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not record the appointment.");
    return res.data.appointment;
  });
}

export function useCancelDrugTest() {
  return useScreeningWrite(drugTestKey, async (input: { driverId: string; appointmentId: string }) => {
    const res = await apiFetch<{ appointment: DrugTestAppointment }>(
      `${applicant(input.driverId)}/drug-test-appointments/${encodeURIComponent(input.appointmentId)}`,
      { method: "DELETE" },
    );
    if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not cancel the appointment.");
    return res.data.appointment;
  });
}

/** D-AW5. Keyed on the checklist alone: the consent has no list of its own, the row is its reading. */
export function useRecordPortalConsent() {
  return useScreeningWrite(applicantChecklistKey, async (input: { driverId: string; occurredOn: string }) => {
    const res = await apiFetch<{ recordId: string; created: boolean }>(
      `${applicant(input.driverId)}/clearinghouse-portal-consent`,
      { method: "POST", body: { occurred_on: input.occurredOn } },
    );
    if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not record the consent.");
    return res.data;
  });
}

export const useEmployerCallsQuery = (driverId: Ref<string>) =>
  listQuery<EmployerVerificationList>(employerCallsKey, "employer-calls", "calls", driverId);

export function useRecordEmployerCall() {
  return useScreeningWrite(employerCallsKey, async (input: { driverId: string; call: EmployerVerificationCallInput }) => {
    const res = await apiFetch<{ call: EmployerVerificationCall }>(
      `${applicant(input.driverId)}/employer-calls`, { method: "POST", body: input.call },
    );
    if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not record the call.");
    return res.data.call;
  });
}
