import type { Ref } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { LeadContactInput } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

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

/**
 * Working a lead (E4b3): log a contact, make them an applicant, hold or lift do-not-contact.
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

  return { logContact, convert, setHold };
}
