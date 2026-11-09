import type { Ref } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { LeadCloseReason, LeadContactInput, LeadStatus, ManualLead } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { apiRefusal } from "@/composables/useStepUpRetry";

/** The convert form's answer for "a new record", beside the driver ids it can also answer. */
export const NEW_APPLICANT = "new";

/** What each act answers (`routes/leads.ts`). A refusal is thrown with the api's own sentence, for the toast. */
export interface LeadConversion {
  conversion_id: string;
  driver_id: string;
  created_applicant: boolean;
}
export type LeadHoldAnswer =
  | { kind: "held"; newly: boolean; applicant_id: string | null }
  | { kind: "lifted"; lifted: number; stop_remains: boolean };
/** What close, qualify and reopen answer (`routes/leads.ts`, LQ5b1): the status the lead is left in. */
export interface LeadActAnswer {
  kind: "done";
  closure_id: string | null;
  status: LeadStatus;
  already: boolean;
  verdict_written: boolean;
}
export interface LeadPurgeAnswer {
  purged: string[];
  already: string[];
  /** Other leads of the same person that became applicants, left in place. */
  skipped_applicants: string[];
}

/**
 * Working a lead (E4b3, E4b4): log a contact, make them an applicant, hold or lift do-not-contact, delete details.
 *
 * Each refreshes on settling, not on success: a refusal such as `lead_purged` or `already_converted` means the
 * drawer was showing something out of date, and the fresh read is what takes the buttons away.
 */
export function useLeadActions(leadId: Ref<string>) {
  const qc = useQueryClient();
  const path = (rest: string) => `/api/recruitment/leads/${encodeURIComponent(leadId.value)}/${rest}`;
  const refresh = (...prefixes: string[][]) => {
    for (const queryKey of [["recruitment", "leads"], ...prefixes]) void qc.invalidateQueries({ queryKey });
  };

  const logContact = useMutation({
    mutationFn: async (input: LeadContactInput): Promise<void> => {
      const res = await apiFetch(path("contacts"), { method: "POST", body: input });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not log the contact.");
    },
    onSettled: () => refresh(),
  });

  // `null` creates an applicant; an id attaches the lead to one already on the board.
  const convert = useMutation({
    mutationFn: async (driverId: string | null): Promise<LeadConversion> => {
      const res = await apiFetch<LeadConversion>(path("convert"), { method: "POST", body: { driver_id: driverId } });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not make this lead an applicant.");
      return res.data;
    },
    onSettled: () => refresh(["recruitment", "pipeline"], ["drivers"]),
  });

  const setHold = useMutation({
    mutationFn: async (hold: boolean): Promise<LeadHoldAnswer> => {
      const res = await apiFetch<LeadHoldAnswer>(path("do-not-contact"), { method: hold ? "POST" : "DELETE" });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not change do not contact.");
      return res.data;
    },
    onSettled: () => refresh(),
  });

  // Thrown as `apiRefusal` so the drawer can tell the password prompt from a refusal (`useStepUpRetry`).
  const purge = useMutation({
    mutationFn: async (samePerson: boolean): Promise<LeadPurgeAnswer> => {
      const res = await apiFetch<LeadPurgeAnswer>(path("purge"), { method: "POST", body: { same_person: samePerson } });
      if (!res.ok || !res.data) throw apiRefusal(res.error, "Could not delete the details.");
      return res.data;
    },
    onSettled: () => refresh(),
  });

  // The recruiter's verdict (LQ5c over 0578): the database checks the evidence each reason needs and refuses in
  // words; the drawer greys a reason out with the same words first (`closeReasonUnavailable`), and the refusal
  // still reaches the toast when the record changed under it.
  const actOn = (rest: "close" | "qualify" | "reopen", failed: string) =>
    useMutation({
      mutationFn: async (body: { reason?: LeadCloseReason; note: string | null }): Promise<LeadActAnswer> => {
        const res = await apiFetch<LeadActAnswer>(path(rest), { method: "POST", body });
        if (!res.ok || !res.data) throw new Error(res.error?.message ?? failed);
        return res.data;
      },
      onSettled: () => refresh(),
    });
  const close = actOn("close", "Could not close the lead.");
  const qualify = actOn("qualify", "Could not mark the lead qualified.");
  const reopen = actOn("reopen", "Could not reopen the lead.");

  return { logContact, convert, setHold, purge, close, qualify, reopen };
}

/** A lead typed in by hand. It rings nobody, by design (`recruitingLeadSink.accept` is the only ringer). */
export function useAddLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ManualLead): Promise<{ lead_id: string }> => {
      const res = await apiFetch<{ lead_id: string }>("/api/recruitment/leads", { method: "POST", body: input });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not add the lead.");
      return res.data;
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["recruitment", "leads"] }),
  });
}
