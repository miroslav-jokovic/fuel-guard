import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { ApplicantIdentity, ApplicationCaptureView, ApplicationContactMove, ApplicationEdit, ApplicationPath, ApplicationReviewState, CarrierQuestionStamp, PartOneAnswer, PartOneAnswersView, PartOneCorrection, PartOneFactsView } from "@silvicom/shared";
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
  /** F3 (0586): the office's reason, on the driver's own statement. Optional: an API before F3 sends none. */
  note?: string | null;
  /** F3 (0586): recorded without its values — a replace-only answer. */
  withheld?: boolean;
  editedAt: string;
  editedBy: string | null;
}

export interface ApplicationReview {
  invitationId: string;
  driverId: string;
  state: ApplicationReviewState;
  /** From the office's send until filing — and refused by the API once the driver has marked the packet (§9 P5). */
  editable: boolean;
  payload: Record<string, unknown> | null;
  /**
   * The draft's revision as read (0376); every edit sends it back, so an edit made against an answer
   * the applicant has since changed is refused rather than written over it (§9 P5). Optional: an API
   * from before P5 sends none, and 0 is what the first draft is checked against.
   */
  revision?: number;
  /**
   * A v2 application's Part 1 facts (C3c2c2, Q-AW34), null for a legacy one — so the drawer reads the
   * document filing will compose, not the draft's copy. Optional: an API older than C3c2c2 sends none.
   */
  partOne?: PartOneFactsView | null;
  /** §15.3 D-CQ2: the carrier's own questions as stamped on this invitation. Optional: an API before CQ2 sends none. */
  carrierQuestions?: CarrierQuestionStamp;
  /** What the applicant has photographed (F0). Optional: an API from before F0 sends none. */
  captures?: ApplicationCaptureView[];
  /** F0b: when the applicant last opened it with a code because the date of birth on file did not match. */
  unlockedByCodeAt?: string | null;
  /** F3: the driver has made the first packet mark, so no correction lands. Optional: an API before F3 sends none. */
  signingStarted?: boolean;
  /** F3: Part 1's other answers; the donor gender only as whether it was given (Q-AM13). Null on a legacy link. */
  partOneAnswers?: PartOneAnswersView | null;
  /** E3: the invitation's email, and whether the phone on file is texted. Optional: an API before E3 sends none. */
  contact?: { email: string | null; phoneTexted: boolean };
  edits: ApplicationEditRow[];
}

/** What one office write left behind: the draft's new revision and the payload as written. */
export interface AppliedOfficeEdit {
  revision: number | null;
  payload: Record<string, unknown> | null;
  /** E3: what the correction moved — the invitation's email, the texts to the old number. */
  contact: ApplicationContactMove;
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
    /**
     * Resolves to the draft's NEW revision and payload (the API has always returned both). The one employer form
     * (HW5b) changes a job as one `set` per changed answer — one `application_edits` line each, as every
     * office correction is logged — and each `set` must name the revision the previous one produced, or
     * the second would be refused as somebody else's change; and a job from before AW1 is given its key by
     * the first write, which the payload says. `null` revision from an API that sent none.
     */
    mutationFn: async (input: ApplicationEdit): Promise<AppliedOfficeEdit> => {
      const res = await apiFetch<{ revision?: number | null; payload?: Record<string, unknown>; contact?: ApplicationContactMove }>(
        `/api/recruitment/applications/${encodeURIComponent(invitationId.value ?? "")}/answer`,
        { method: "PATCH", body: input },
      );
      if (!res.ok) throw new Error(res.error?.message ?? "That change could not be saved.");
      return {
        revision: typeof res.data?.revision === "number" ? res.data.revision : null,
        payload: res.data?.payload ?? null,
        contact: res.data?.contact ?? {},
      };
    },
    // Settled, not only on success: a refusal for a stale revision (the applicant saved since this
    // was read) is answered by reading the application again, so the next try is made on what is there.
    onSettled: () => void qc.invalidateQueries({ queryKey: key(invitationId.value ?? "") }),
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
    mutationFn: async (input: PartOneCorrection): Promise<ApplicationContactMove> => {
      const res = await apiFetch<{ contact?: ApplicationContactMove }>(
        `/api/recruitment/applications/${encodeURIComponent(invitationId.value ?? "")}/part-one`,
        { method: "POST", body: input },
      );
      if (!res.ok) throw new Error(res.error?.message ?? "That correction could not be saved.");
      return res.data?.contact ?? {};
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key(invitationId.value ?? "") }),
  });
}

/**
 * The office correcting the date of birth or the current licence from the "Applicant facts" card (F3).
 * The same route the Permissions and Road-test drawers use (`useCorrectApplicantIdentity` in
 * recruitment); here because this feature may not import recruitment's internals (`lint:boundaries`).
 *
 * ⚠ Invalidates every `recruitment` query, not only this review: the checklist reads the same three
 * values (the licence state picks the MVR), and naming its key here would be a copy of recruitment's.
 */
export function useCorrectIdentityFromReview(invitationId: Ref<string | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ApplicantIdentity): Promise<void> => {
      const res = await apiFetch(
        `/api/recruitment/applications/${encodeURIComponent(invitationId.value ?? "")}/identity`,
        { method: "POST", body: input },
      );
      if (!res.ok) throw new Error(res.error?.message ?? "That correction could not be saved.");
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["recruitment"] }),
  });
}

/** F3 (Q-AM13): one Part 1 answer the whole-set correction does not carry — a statement with its reason, or a blind replace. */
export function useCorrectPartOneAnswer(invitationId: Ref<string | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PartOneAnswer): Promise<void> => {
      const res = await apiFetch(
        `/api/recruitment/applications/${encodeURIComponent(invitationId.value ?? "")}/part-one/answer`,
        { method: "POST", body: input },
      );
      if (!res.ok) throw new Error(res.error?.message ?? "That correction could not be saved.");
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["recruitment"] }),
  });
}
