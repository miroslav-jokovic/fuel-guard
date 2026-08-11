import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { CardControlScope } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";
import { CardControlApiError } from "./useCardControl";

/**
 * Who, in this company, may change a fuel card.
 *
 * Every mutation here needs a sign-in from the last five minutes — the API enforces it and answers
 * `step_up_required`, which the page turns into a password prompt rather than an error. These rows
 * decide who may spend money at a pump, so changing them costing a password is the design, not
 * friction to work around.
 */

const settingsKey = ["efs_card_control_settings"] as const;

export interface CardControlSettings {
  enabled: boolean;
  requireApprover: boolean;
  writeEntitlement: "unknown" | "confirmed" | "denied";
  probedAt: string | null;
  probeVerdict: string | null;
  probeRecommendation: string | null;
  probeWasReadOnly: boolean | null;
}

export interface CardApproverRow {
  userId: string;
  email: string | null;
  role: string | null;
  scopes: CardControlScope[];
  grantedBy: string | null;
  grantedAt: string | null;
  /** False when the person's ROLE changed after they were named — a stale grant the gate refuses. */
  eligible: boolean;
}

export interface EligibleMember {
  userId: string;
  email: string | null;
  role: string;
}

export interface CardControlSettingsResponse {
  settings: CardControlSettings;
  approvers: CardApproverRow[];
  eligible: EligibleMember[];
  scopes: CardControlScope[];
  eligibleRoles: string[];
}

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await apiFetch<T>(path, { method, ...(body === undefined ? {} : { body }) });
  if (!res.ok) {
    // Same typed error as the card writes: the page branches on `step_up_required` and
    // `card_control_not_entitled` by CODE, never by reading a sentence.
    throw new CardControlApiError(
      res.error?.message ?? "That did not work",
      res.error?.code ?? "unknown",
      res.status,
      res.detail ?? {},
    );
  }
  return res.data as T;
}

export function useCardControlSettings() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: (): Promise<CardControlSettingsResponse> => call("/api/fuel-cards/settings"),
  });
}

function useSettingsInvalidation() {
  const qc = useQueryClient();
  // Both keys: changing who may act changes the `capabilities` every card page renders from.
  return () => {
    void qc.invalidateQueries({ queryKey: settingsKey });
    void qc.invalidateQueries({ queryKey: ["efs_cards"] });
  };
}

/** The two switches. Sent one at a time, so neither reverts the other. */
export function useUpdateCardControlSettings() {
  const invalidate = useSettingsInvalidation();
  return useMutation({
    mutationFn: (patch: { enabled?: boolean; requireApprover?: boolean }) =>
      call<{ ok: true; settings: { enabled: boolean; requireApprover: boolean } }>(
        "/api/fuel-cards/settings", "PATCH", patch,
      ),
    onSuccess: invalidate,
  });
}

/** Name someone, or change what they are trusted with. The request states the FULL scope set. */
export function useGrantCardApprover() {
  const invalidate = useSettingsInvalidation();
  return useMutation({
    mutationFn: (args: { userId: string; scopes: CardControlScope[] }) =>
      call<{ ok: true; userId: string; scopes: CardControlScope[] }>(
        `/api/fuel-cards/approvers/${args.userId}`, "PUT", { scopes: args.scopes },
      ),
    onSuccess: invalidate,
  });
}

export function useRevokeCardApprover() {
  const invalidate = useSettingsInvalidation();
  return useMutation({
    mutationFn: (userId: string) =>
      call<{ ok: true; userId: string }>(`/api/fuel-cards/approvers/${userId}`, "DELETE"),
    onSuccess: invalidate,
  });
}
