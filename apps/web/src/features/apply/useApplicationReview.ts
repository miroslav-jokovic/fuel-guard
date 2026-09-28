import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { ApplicationPath, ApplicationReviewState, PartOneCorrection, PartOneFactsView } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The office's side of an application — reading it, correcting it, approving it (F4).
 *
 * ⚠ It lives in `features/apply` rather than in `features/recruitment`, and that is the boundary rule
 * working rather than being dodged. `lint:boundaries` forbids one feature importing another's
 * internals; this composable and the drawer beside it need the application's own vocabulary — the
 * contract paths, the field labels, the draft shape — all of which belong to the application. The
 * recruiter's PAGE mounts the drawer, and a page may import any feature.
 */

export interface ApplicationEditRow {
  path: ApplicationPath;
  before: unknown;
  after: unknown;
  editedAt: string;
  editedBy: string | null;
}

export interface ApplicationReview {
  invitationId: string;
  driverId: string;
  state: ApplicationReviewState;
  /** Only while it is waiting for review. Approval is what tells the driver to sign THAT document. */
  editable: boolean;
  payload: Record<string, unknown> | null;
  /**
   * A v2 application's Part 1 facts (C3c2c2, Q-AW34), null for a legacy one — so the drawer reads the
   * document filing will compose, not the draft's copy. Optional: an API older than C3c2c2 sends none.
   */
  partOne?: PartOneFactsView | null;
  edits: ApplicationEditRow[];
}

const key = (invitationId: string) => ["recruitment", "application-review", invitationId] as const;

export function useApplicationReviewQuery(invitationId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => key(invitationId.value ?? "")),
    enabled: computed(() => Boolean(invitationId.value)),
    queryFn: async (): Promise<ApplicationReview> => {
      const res = await apiFetch<ApplicationReview>(
        `/api/recruitment/applications/${encodeURIComponent(invitationId.value ?? "")}/review`,
      );
      if (!res.ok) throw new Error(res.error?.message ?? "Could not load the application.");
      return res.data!;
    },
  });
}

export function useEditApplicationAnswer(invitationId: Ref<string | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { path: ApplicationPath; value: unknown }): Promise<void> => {
      const res = await apiFetch(
        `/api/recruitment/applications/${encodeURIComponent(invitationId.value ?? "")}/answer`,
        { method: "PATCH", body: input },
      );
      if (!res.ok) throw new Error(res.error?.message ?? "That change could not be saved.");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key(invitationId.value ?? "") }),
  });
}

/**
 * What became of the message to the applicant (Q-AX4).
 *
 * ⚠ Reported, never thrown. The approval is committed before the notice is attempted, so a refused
 * send is a sentence the recruiter reads and acts on — not a reason to tell them the approval failed,
 * which would send them to press the button again on something that already happened.
 */
export interface ApprovalNotice {
  sent: boolean;
  email: string | null;
  /** `no_address` | `mail_disabled` | `send_failed` | `already_notified`. null when it went. */
  reason: string | null;
  texted: boolean;
}

export function useApproveApplication(invitationId: Ref<string | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<ApprovalNotice> => {
      const res = await apiFetch<{ approvedAt: string; notice: ApprovalNotice }>(
        `/api/recruitment/applications/${encodeURIComponent(invitationId.value ?? "")}/approve`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(res.error?.message ?? "That could not be approved.");
      return res.data!.notice;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key(invitationId.value ?? "") }),
  });
}

/**
 * The office correcting Part 1 (Q-AW36 (a)). The review is refetched, so the summary above the form —
 * composed from Part 1's facts — shows what the application will now say.
 */
export function useCorrectPartOne(invitationId: Ref<string | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PartOneCorrection): Promise<void> => {
      const res = await apiFetch(
        `/api/recruitment/applications/${encodeURIComponent(invitationId.value ?? "")}/part-one`,
        { method: "POST", body: input },
      );
      if (!res.ok) throw new Error(res.error?.message ?? "That correction could not be saved.");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key(invitationId.value ?? "") }),
  });
}
